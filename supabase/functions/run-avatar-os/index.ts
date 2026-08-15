// Phase 2A-B — one-button Avatar OS orchestration.
//
// One UI action drives prepare -> bounded research steps -> finalize. Each
// provider call is isolated so the workflow can resume after navigation,
// provider failure, or an Edge Function wall-clock interruption. Human review
// remains a separate database-controlled decision.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";
import {
  AVATAR_CONDITIONAL_MODULES,
  AVATAR_CORE_MODULES,
  AVATAR_RESEARCH_MODULES,
  runAvatarResearchAgent,
  type AvatarModuleFinding,
  type AvatarConditionalModuleKey,
} from "../_shared/intelligence/avatar-research-provider.ts";

type Action = "prepare" | "step" | "finalize" | "retry_step";
type ServiceClient = ReturnType<typeof svc>;

interface ContextFileRow {
  id: string;
  file_number: number;
  file_name: string;
  content_md: string;
  status: string;
  version: number;
}

interface ResearchStepRow {
  id: string;
  client_id: string;
  research_run_id: string;
  step_key: string;
  step_order: number;
  title: string;
  status: string;
  attempt_count: number;
  maximum_attempts: number;
  failure_code: string | null;
  failure_message: string | null;
  output_summary: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface AvatarAuthority {
  client: { id: string; name: string; stage1_status: string };
  files: ContextFileRow[];
  marketRelease: {
    id: string;
    version: number;
    title: string;
    summary: string;
    content: Record<string, unknown>;
    approved_at: string;
  };
  marketRecords: Array<{
    record_type: string;
    record_key: string;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
  }>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeFailureCode(error: unknown): string {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("not configured")) return "PROVIDER_NOT_CONFIGURED";
  if (message.includes("timed out") || message.includes("timeout")) return "PROVIDER_TIMEOUT";
  if (message.includes("http 429")) return "PROVIDER_RATE_LIMITED";
  if (message.includes("invalid json") || message.includes("invalid identity")) return "PROVIDER_INVALID_RESPONSE";
  return "PROVIDER_ERROR";
}

function isRetryableProviderError(error: unknown): boolean {
  const code = safeFailureCode(error);
  return !new Set(["PROVIDER_NOT_CONFIGURED", "PROVIDER_INVALID_RESPONSE"]).has(code);
}

function compact(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n[truncated]`;
}

function normaliseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function renderAuthority(files: ContextFileRow[]): string {
  return files.map((file) =>
    `\n## Context file ${file.file_number}: ${file.file_name} (approved v${file.version})\n${compact(file.content_md, 3000)}`
  ).join("\n");
}

/** Renders this module's slice of cross-run agent memory (unresolved unknowns from the prior run) as prompt text. */
function renderMemoryNote(
  memory: { summary: string; unresolved_notes: unknown } | null | undefined,
  moduleKey: string,
): string | undefined {
  if (!memory) return undefined;
  const notes = Array.isArray(memory.unresolved_notes) ? memory.unresolved_notes : [];
  const relevant = notes
    .filter((note): note is { module_key?: unknown; claim?: unknown } => Boolean(note) && typeof note === "object")
    .filter((note) => note.module_key === moduleKey && typeof note.claim === "string")
    .map((note) => `- ${note.claim as string}`);
  const parts: string[] = [];
  if (memory.summary) parts.push(memory.summary);
  if (relevant.length > 0) parts.push(`Unresolved from last run:\n${relevant.join("\n")}`);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

// Each record is capped individually, before joining, so every record gets
// guaranteed complete coverage within its own budget — the previous design
// only capped the joined string's total length, which meant whichever
// records happened to render last could get silently truncated mid-sentence
// or dropped entirely once earlier records had already used up the budget.
const MARKET_AUTHORITY_RECORD_CAP = 500;
const MARKET_AUTHORITY_TOTAL_CAP = 18000;
const AVATAR_MODEL_RECORD_CAP = 500;
const AVATAR_MODEL_TOTAL_CAP = 16000;

function renderRecordBlock(record: { title: string; record_type: string; record_key: string; summary: string; payload: Record<string, unknown> }, cap: number): string {
  const details = Array.isArray(record.payload?.details)
    ? record.payload.details
        .filter((detail): detail is { label: string; value: string } =>
          Boolean(detail) && typeof detail === "object" &&
          typeof (detail as { label?: unknown }).label === "string" &&
          typeof (detail as { value?: unknown }).value === "string"
        )
        .map((detail) => `- ${detail.label}: ${detail.value}`)
        .join("\n")
    : "";
  const block = `## ${record.title} [${record.record_type}/${record.record_key}]\n${record.summary}${details ? `\n${details}` : ""}`;
  return compact(block, cap);
}

function renderMarketAuthority(authority: AvatarAuthority): string {
  const release = authority.marketRelease;
  const records = authority.marketRecords
    .map((record) => renderRecordBlock(record, MARKET_AUTHORITY_RECORD_CAP))
    .join("\n\n");
  return `# ${release.title} (approved v${release.version})\n${release.summary}\n\n${compact(records, MARKET_AUTHORITY_TOTAL_CAP)}`;
}

function renderAvatarModel(records: Array<{ record_type: string; record_key: string; title: string; summary: string; payload: Record<string, unknown> }>): string {
  return records
    .map((record) => renderRecordBlock(record, AVATAR_MODEL_RECORD_CAP))
    .join("\n\n");
}

async function loadAvatarAuthority(sb: ServiceClient, clientId: string): Promise<
  | { ok: true; authority: AvatarAuthority }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }
> {
  const [clientResult, contextResult, marketPointerResult] = await Promise.all([
    sb.from("clients").select("id,name,stage1_status").eq("id", clientId).maybeSingle(),
    sb.from("client_context_files")
      .select("id,file_number,file_name,content_md,status,version")
      .eq("client_id", clientId).order("file_number"),
    sb.from("client_intelligence_active_releases")
      .select("release_id").eq("client_id", clientId).eq("intelligence_domain", "market_os").maybeSingle(),
  ]);
  if (clientResult.error || !clientResult.data) {
    return { ok: false, status: 404, code: "CLIENT_NOT_FOUND", message: "Client not found." };
  }
  if (contextResult.error) {
    return { ok: false, status: 500, code: "CONTEXT_QUERY_FAILED", message: contextResult.error.message };
  }
  if (marketPointerResult.error || !marketPointerResult.data?.release_id) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_MARKET_OS_REQUIRED",
      message: "Avatar OS requires an active approved Market OS release.",
    };
  }
  const allFiles = (contextResult.data ?? []) as ContextFileRow[];
  const approved = allFiles.filter((file) => file.status === "approved" && file.content_md.trim().length > 0);
  const expected = new Set(Array.from({ length: 21 }, (_, index) => index));
  approved.forEach((file) => expected.delete(file.file_number));
  if (clientResult.data.stage1_status !== "complete" || approved.length !== 21 || expected.size > 0) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_CONTEXT_REQUIRED",
      message: "Avatar OS requires all 21 approved, non-empty Context Files.",
      details: { stage1_status: clientResult.data.stage1_status, approved: approved.length, missing_file_numbers: [...expected] },
    };
  }
  const [marketReleaseResult, marketRecordsResult] = await Promise.all([
    sb.from("client_intelligence_releases")
      .select("id,version,title,summary,content,approved_at")
      .eq("id", marketPointerResult.data.release_id)
      .eq("client_id", clientId)
      .eq("intelligence_domain", "market_os")
      .eq("status", "approved")
      .maybeSingle(),
    sb.from("client_intelligence_records")
      .select("record_type,record_key,title,summary,payload")
      .eq("client_id", clientId)
      .eq("release_id", marketPointerResult.data.release_id)
      .order("display_order"),
  ]);
  if (marketReleaseResult.error || !marketReleaseResult.data?.approved_at) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_MARKET_OS_REQUIRED",
      message: "The active Market OS pointer does not reference an approved release.",
    };
  }
  if (marketRecordsResult.error || (marketRecordsResult.data ?? []).length === 0) {
    return {
      ok: false,
      status: 409,
      code: "MARKET_OS_RECORDS_REQUIRED",
      message: "The active Market OS release has no structured market records.",
    };
  }
  return {
    ok: true,
    authority: {
      client: clientResult.data,
      files: approved,
      marketRelease: marketReleaseResult.data,
      marketRecords: marketRecordsResult.data ?? [],
    },
  };
}

async function stepProgress(sb: ServiceClient, researchRunId: string) {
  const { data, error } = await sb.from("client_research_steps")
    .select("status,attempt_count,maximum_attempts").eq("research_run_id", researchRunId);
  if (error) throw new Error(error.message);
  const steps = data ?? [];
  const completed = steps.filter((step) => step.status === "completed").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const recoverable = steps.some((step) =>
    step.status === "queued" ||
    step.status === "running" ||
    step.status === "waiting_provider" ||
    (step.status === "failed" && step.attempt_count < step.maximum_attempts)
  );
  return { completed, failed, total: steps.length, terminal: !recoverable };
}

async function ensureAvatarFollowupSteps(
  sb: ServiceClient,
  clientId: string,
  researchRunId: string,
  selectedConditionalKeys: AvatarConditionalModuleKey[],
) {
  const allowedConditional = new Set(AVATAR_CONDITIONAL_MODULES.map((module) => module.key));
  const selected = new Set(selectedConditionalKeys.filter((key) => allowedConditional.has(key)));
  const modules = [
    ...AVATAR_CORE_MODULES.slice(1),
    ...AVATAR_CONDITIONAL_MODULES.filter((module) => selected.has(module.key)),
  ];
  const { data: existing, error: existingError } = await sb.from("client_research_steps")
    .select("step_key").eq("research_run_id", researchRunId);
  if (existingError) throw new Error(existingError.message);
  const existingKeys = new Set((existing ?? []).map((step) => step.step_key));
  const rows = modules.filter((module) => !existingKeys.has(module.key)).map((module) => ({
    client_id: clientId,
    research_run_id: researchRunId,
    step_key: module.key,
    step_order: AVATAR_RESEARCH_MODULES.findIndex((candidate) => candidate.key === module.key) + 1,
    title: module.title,
  }));
  if (rows.length === 0) return;
  const { error } = await sb.from("client_research_steps").insert(rows);
  if (error) throw new Error(error.message);
}

async function prepare(sb: ServiceClient, clientId: string, userId: string) {
  const authorityResult = await loadAvatarAuthority(sb, clientId);
  if (!authorityResult.ok) {
    return json({ ok: false, mode: "blocked", ...authorityResult.details, message: authorityResult.message, code: authorityResult.code }, authorityResult.status);
  }
  const { authority } = authorityResult;
  const authoritySnapshot = {
    context: authority.files.map((file) => ({ id: file.id, file_number: file.file_number, version: file.version })),
    market_os: {
      release_id: authority.marketRelease.id,
      version: authority.marketRelease.version,
      approved_at: authority.marketRelease.approved_at,
    },
  };
  const authorityHash = await sha256(JSON.stringify(authoritySnapshot));

  const { data: openRuns, error: openRunError } = await sb.from("client_research_runs")
    .select("*").eq("client_id", clientId).eq("intelligence_domain", "avatar_os")
    .in("status", ["queued", "running", "waiting_provider", "failed"])
    .order("created_at", { ascending: false }).limit(5);
  if (openRunError) return json({ ok: false, mode: "blocked", message: openRunError.message }, 500);

  for (const run of openRuns ?? []) {
    const { data: release } = await sb.from("client_intelligence_releases")
      .select("id,status").eq("client_id", clientId).eq("research_run_id", run.id)
      .in("status", ["draft", "needs_review"]).maybeSingle();
    if (!release || release.status === "needs_review") continue;
    const { data: steps, error: stepsError } = await sb.from("client_research_steps")
      .select("*").eq("research_run_id", run.id).order("step_order");
    if (stepsError) return json({ ok: false, mode: "blocked", message: stepsError.message }, 500);
    const canResume = (steps ?? []).some((step) =>
      step.status === "queued" || step.status === "running" || step.status === "waiting_provider" ||
      (step.status === "failed" && step.attempt_count < step.maximum_attempts)
    );
    if (!canResume) continue;
    await sb.from("client_research_runs").update({ status: "queued", retryable: false, failure_code: null, failure_message: null })
      .eq("id", run.id);
    return json({
      ok: true,
      mode: "resumed",
      message: "Resuming the existing Avatar OS build.",
      research_run_id: run.id,
      release_id: release.id,
      steps: steps ?? [],
    });
  }

  const { data: latestRelease, error: versionError } = await sb.from("client_intelligence_releases")
    .select("version").eq("client_id", clientId).eq("intelligence_domain", "avatar_os")
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (versionError) return json({ ok: false, mode: "blocked", message: versionError.message }, 500);
  const version = (latestRelease?.version ?? 0) + 1;
  const model = (Deno.env.get("ANTHROPIC_AVATAR_RESEARCH_MODEL") ?? "claude-sonnet-5").trim();
  const timeBucket = Math.floor(Date.now() / 600_000);
  const idempotencyKey = `avatar_os:${authorityHash.slice(0, 40)}:v${version}:${timeBucket}`;

  const { data: run, error: runError } = await sb.from("client_research_runs").insert({
    client_id: clientId,
    research_domain: "avatar",
    intelligence_domain: "avatar_os",
    status: "queued",
    idempotency_key: idempotencyKey,
    provider: "anthropic",
    model,
    prompt_digest: authorityHash,
    configuration_snapshot: {
      authority: authoritySnapshot,
      authority_hash: authorityHash,
      core_module_manifest: AVATAR_CORE_MODULES,
      conditional_module_manifest: AVATAR_CONDITIONAL_MODULES,
    },
    created_by: userId,
  }).select("*").single();
  if (runError) {
    if (runError.code === "23505") {
      const { data: duplicate } = await sb.from("client_research_runs")
        .select("*").eq("client_id", clientId).eq("idempotency_key", idempotencyKey).maybeSingle();
      if (duplicate) {
        const { data: release } = await sb.from("client_intelligence_releases")
          .select("id").eq("research_run_id", duplicate.id).maybeSingle();
        const { data: steps } = await sb.from("client_research_steps")
          .select("*").eq("research_run_id", duplicate.id).order("step_order");
        return json({ ok: true, mode: "resumed", message: "Resuming the existing Avatar OS build.", research_run_id: duplicate.id, release_id: release?.id, steps: steps ?? [] });
      }
    }
    return json({ ok: false, mode: "blocked", message: runError.message }, 500);
  }

  const { data: release, error: releaseError } = await sb.from("client_intelligence_releases").insert({
    client_id: clientId,
    intelligence_domain: "avatar_os",
    version,
    status: "draft",
    research_run_id: run.id,
    title: `Avatar OS v${version}`,
    authority_snapshot: { ...authoritySnapshot, authority_hash: authorityHash },
    created_by: userId,
  }).select("*").single();
  if (releaseError) {
    await sb.from("client_research_runs").update({ status: "failed", failure_code: "RELEASE_CREATE_FAILED", failure_message: releaseError.message, retryable: false }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
  }

  const stepRows = AVATAR_CORE_MODULES.slice(0, 1).map((module) => ({
    client_id: clientId,
    research_run_id: run.id,
    step_key: module.key,
    step_order: 1,
    title: module.title,
  }));
  const { data: steps, error: stepError } = await sb.from("client_research_steps")
    .insert(stepRows).select("*").order("step_order");
  if (stepError) {
    await sb.from("client_research_runs").update({ status: "failed", failure_code: "STEP_CREATE_FAILED", failure_message: stepError.message, retryable: false }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: stepError.message }, 500);
  }

  await sb.from("client_intelligence_refresh_policies").upsert({
    client_id: clientId,
    intelligence_domain: "avatar_os",
    refresh_interval_days: 180,
    due_warning_days: 30,
    scheduled_refresh_enabled: false,
    policy_reason: "Buyer-role assumptions generally move slowly and should be reviewed intentionally or when material market evidence changes.",
    updated_by: userId,
  }, { onConflict: "client_id,intelligence_domain" });
  await audit(sb, "avatar_os.prepared", "client_intelligence_releases", release.id, {
    client_id: clientId, research_run_id: run.id, version, authority_hash: authorityHash,
  });
  return json({
    ok: true,
    mode: "prepared",
    message: "Avatar OS research workflow prepared.",
    research_run_id: run.id,
    release_id: release.id,
    steps: steps ?? [],
  }, 201);
}

async function cleanupStepArtifacts(sb: ServiceClient, clientId: string, releaseId: string, stepId: string, stepKey: string) {
  const { data: findings } = await sb.from("client_intelligence_findings")
    .select("id").eq("client_id", clientId).contains("metadata", { research_step_id: stepId });
  const findingIds = (findings ?? []).map((finding) => finding.id);
  if (findingIds.length > 0) {
    await sb.from("client_intelligence_release_findings").delete().eq("client_id", clientId).eq("release_id", releaseId).in("finding_id", findingIds);
    await sb.from("client_intelligence_finding_evidence").delete().eq("client_id", clientId).in("finding_id", findingIds);
    await sb.from("client_intelligence_findings").delete().eq("client_id", clientId).in("id", findingIds);
  }
  await sb.from("client_evidence_records").delete().eq("client_id", clientId).contains("metadata", { research_step_id: stepId });
  await sb.from("client_intelligence_records").delete().eq("client_id", clientId).eq("release_id", releaseId).eq("record_type", stepKey);
  await sb.from("client_agent_turns").delete().eq("client_id", clientId).eq("research_step_id", stepId);
}

async function persistModule(input: {
  sb: ServiceClient;
  clientId: string;
  runId: string;
  releaseId: string;
  step: ResearchStepRow;
  authority: AvatarAuthority;
  result: Awaited<ReturnType<typeof runAvatarResearchAgent>>;
}) {
  const { sb, clientId, runId, releaseId, step, authority, result } = input;
  await cleanupStepArtifacts(sb, clientId, releaseId, step.id, step.step_key);

  // Persist the transcript first, before any check that can throw below — a
  // module that fails a downstream integrity check (e.g. no records) still
  // leaves an inspectable audit trail of what the agent actually did.
  if (result.transcript.length > 0) {
    const turnRows = result.transcript.map((turn) => ({
      client_id: clientId,
      research_run_id: runId,
      research_step_id: step.id,
      intelligence_domain: "avatar_os",
      turn_order: turn.turnOrder,
      role: turn.role,
      content: turn.content,
      tool_name: turn.toolName,
      tool_input: turn.toolInput,
      tool_output: turn.toolOutput,
      stop_reason: turn.stopReason,
      input_tokens: turn.inputTokens,
      output_tokens: turn.outputTokens,
    }));
    const { error: turnError } = await sb.from("client_agent_turns").insert(turnRows);
    if (turnError) throw new Error(turnError.message);
  }

  const sourceRows = result.sources.map((source) => ({
    client_id: clientId,
    research_run_id: runId,
    url: source.url,
    canonical_url: source.url,
    title: compact(source.title, 500),
    publisher: new URL(source.url).hostname,
    retrieved_at: result.retrievedAt,
    evidence_kind: "paraphrased",
    evidence_text: `Source consulted during the ${step.title} Avatar OS module.`,
    confidence: "medium",
    use_restriction: "review_required",
    source_type: "web_page",
    source_quality: "unrated",
    inspectable: true,
  }));
  let persistedSources: Array<{ id: string; url: string }> = [];
  if (sourceRows.length > 0) {
    const urls = sourceRows.map((source) => source.url);
    const { data: existing, error: existingError } = await sb.from("client_research_sources")
      .select("id,url").eq("research_run_id", runId).in("url", urls);
    if (existingError) throw new Error(existingError.message);
    const existingUrls = new Set((existing ?? []).map((source) => source.url));
    const missingRows = sourceRows.filter((source) => !existingUrls.has(source.url));
    let inserted: Array<{ id: string; url: string }> = [];
    if (missingRows.length > 0) {
      const { data, error } = await sb.from("client_research_sources").insert(missingRows).select("id,url");
      if (error) throw new Error(error.message);
      inserted = data ?? [];
    }
    persistedSources = [...(existing ?? []), ...inserted];
  }
  const sourceByUrl = new Map(persistedSources.map((source) => [normaliseUrl(source.url), source]));
  const contextByNumber = new Map(authority.files.map((file) => [file.file_number, file]));
  const marketByKey = new Map(authority.marketRecords.map((record) => [record.record_key, record]));
  const recordRows: Array<Record<string, unknown>> = [];
  let findingCount = 0;

  for (const [recordIndex, record] of result.output.records.entries()) {
    const recordFindingIds: string[] = [];
    for (const providerFinding of record.findings) {
      const matchedSources = providerFinding.source_urls
        .map((url) => sourceByUrl.get(normaliseUrl(url)))
        .filter((source): source is { id: string; url: string } => Boolean(source));
      const matchedContext = providerFinding.context_file_numbers
        .map((fileNumber) => contextByNumber.get(fileNumber))
        .filter((file): file is ContextFileRow => Boolean(file));
      const matchedMarketRecords = providerFinding.market_record_keys
        .map((recordKey) => marketByKey.get(recordKey))
        .filter((record): record is AvatarAuthority["marketRecords"][number] => Boolean(record));
      const hasEvidence = matchedSources.length > 0 || matchedContext.length > 0 || matchedMarketRecords.length > 0;
      const normalised = normaliseFinding(providerFinding, hasEvidence);
      const { data: finding, error: findingError } = await sb.from("client_intelligence_findings").insert({
        client_id: clientId,
        intelligence_domain: "avatar_os",
        subject_key: record.record_key,
        claim: compact(normalised.claim, 5000),
        disposition: normalised.disposition,
        confidence_level: normalised.confidence,
        rationale: compact(normalised.rationale, 5000),
        contradiction_status: "none",
        metadata: {
          research_step_id: step.id,
          module_key: step.step_key,
          provider_request_id: result.providerRequestId,
          requested_source_urls: providerFinding.source_urls,
          requested_context_file_numbers: providerFinding.context_file_numbers,
          requested_market_record_keys: providerFinding.market_record_keys,
        },
        created_by: "anthropic_avatar_research",
      }).select("id").single();
      if (findingError) throw new Error(findingError.message);
      recordFindingIds.push(finding.id);
      findingCount += 1;

      const { error: releaseLinkError } = await sb.from("client_intelligence_release_findings").insert({
        client_id: clientId, release_id: releaseId, finding_id: finding.id,
      });
      if (releaseLinkError) throw new Error(releaseLinkError.message);

      const evidenceRows = [
        ...matchedSources.map((source) => ({
          client_id: clientId,
          research_run_id: runId,
          source_type: "structured_observation",
          research_source_id: source.id,
          evidence_kind: "structured_observation",
          evidence_text: compact(normalised.claim, 30000),
          locator: { url: source.url },
          observed_at: result.retrievedAt,
          source_quality: "unrated",
          inspectable: true,
          metadata: { research_step_id: step.id, module_key: step.step_key, provider_request_id: result.providerRequestId },
        })),
        ...matchedContext.map((file) => ({
          client_id: clientId,
          research_run_id: runId,
          source_type: "context_file",
          context_file_id: file.id,
          evidence_kind: "structured_observation",
          evidence_text: compact(normalised.claim, 30000),
          locator: { file_number: file.file_number, file_name: file.file_name, version: file.version },
          observed_at: result.retrievedAt,
          source_quality: "primary",
          inspectable: true,
          metadata: { research_step_id: step.id, module_key: step.step_key, provider_request_id: result.providerRequestId },
        })),
        ...matchedMarketRecords.map((record) => ({
          client_id: clientId,
          research_run_id: runId,
          source_type: "structured_observation",
          evidence_kind: "structured_observation",
          evidence_text: compact(`${record.title}: ${record.summary}`, 30000),
          locator: {
            upstream_domain: "market_os",
            release_id: authority.marketRelease.id,
            release_version: authority.marketRelease.version,
            record_key: record.record_key,
          },
          observed_at: result.retrievedAt,
          source_quality: "authoritative",
          inspectable: true,
          metadata: { research_step_id: step.id, module_key: step.step_key, provider_request_id: result.providerRequestId },
        })),
      ];
      if (evidenceRows.length > 0) {
        const { data: evidence, error: evidenceError } = await sb.from("client_evidence_records")
          .insert(evidenceRows).select("id");
        if (evidenceError) throw new Error(evidenceError.message);
        const { error: evidenceLinkError } = await sb.from("client_intelligence_finding_evidence").insert(
          (evidence ?? []).map((row) => ({ client_id: clientId, finding_id: finding.id, evidence_id: row.id, relationship: "supports" })),
        );
        if (evidenceLinkError) throw new Error(evidenceLinkError.message);
      }
    }
    recordRows.push({
      client_id: clientId,
      release_id: releaseId,
      record_type: step.step_key,
      record_key: compact(record.record_key, 160),
      title: compact(record.title, 500),
      summary: compact(record.summary, 5000),
      payload: { details: record.details, finding_ids: recordFindingIds, module_key: step.step_key },
      display_order: (step.step_order * 100) + recordIndex,
    });
  }
  if (recordRows.length === 0) throw new Error("Avatar OS module returned no structured domain records.");
  const { error: recordError } = await sb.from("client_intelligence_records").insert(recordRows);
  if (recordError) throw new Error(recordError.message);

  const { data: receipt, error: receiptError } = await sb.from("client_provider_operation_receipts").insert({
    client_id: clientId,
    research_run_id: runId,
    research_step_id: step.id,
    capability: "web_research_and_structured_synthesis",
    provider: result.provider,
    model: result.model,
    provider_request_id: result.providerRequestId,
    status: "completed",
    result_reference: result.providerRequestId,
    retrieved_at: result.retrievedAt,
    usage: result.usage,
    cost: {},
    raw_payload_hash: result.rawPayloadHash,
  }).select("id").single();
  if (receiptError) throw new Error(receiptError.message);
  const { error: costError } = await sb.from("client_research_cost_events").insert({
    client_id: clientId,
    research_run_id: runId,
    provider_operation_id: receipt.id,
    provider: result.provider,
    model: result.model,
    input_units: result.usage.input_tokens,
    output_units: result.usage.output_tokens,
    tool_calls: result.usage.web_search_calls,
    pricing_snapshot: { amount_unavailable: true, reason: "No versioned provider price snapshot is configured." },
  });
  if (costError) throw new Error(costError.message);

  const { error: completeError } = await sb.from("client_research_steps").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    lease_owner: null,
    lease_expires_at: null,
    output_summary: {
      summary: result.output.summary,
      unknowns: result.output.unknowns,
      contradictions: result.output.contradictions,
      conditional_module_keys: result.output.conditional_module_keys,
      record_count: recordRows.length,
      finding_count: findingCount,
      provider_request_id: result.providerRequestId,
    },
  }).eq("id", step.id);
  if (completeError) throw new Error(completeError.message);
}

function normaliseFinding(finding: AvatarModuleFinding, hasEvidence: boolean): AvatarModuleFinding {
  if (finding.disposition !== "asserted") return { ...finding, confidence: null };
  if (!hasEvidence) {
    return {
      ...finding,
      disposition: "unknown",
      confidence: null,
      rationale: `${finding.rationale} No inspectable source or approved Context origin matched this claim, so it was stored as unknown.`,
    };
  }
  return { ...finding, confidence: finding.confidence ?? "weakly_inferred" };
}

async function runStep(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data: run, error: runError } = await sb.from("client_research_runs")
    .select("*").eq("id", researchRunId).eq("client_id", clientId).eq("intelligence_domain", "avatar_os").maybeSingle();
  if (runError || !run) return json({ ok: false, terminal: true, message: runError?.message ?? "Avatar OS research run not found." }, 404);
  if (run.status === "completed" || run.status === "completed_partial" || run.status === "cancelled") {
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: true, terminal: true, message: "Avatar OS research is already terminal.", research_run_id: researchRunId, progress });
  }
  const { data: release, error: releaseError } = await sb.from("client_intelligence_releases")
    .select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).eq("status", "draft").maybeSingle();
  if (releaseError || !release) return json({ ok: false, terminal: true, message: releaseError?.message ?? "Draft Avatar OS release not found." }, 409);

  const leaseOwner = `avatar-os:${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await sb.rpc("claim_client_research_step", {
    p_research_run_id: researchRunId,
    p_lease_owner: leaseOwner,
        p_lease_seconds: 300,
  });
  if (claimError) return json({ ok: false, terminal: true, message: claimError.message, research_run_id: researchRunId }, 500);
  if (!claimed) {
    const progress = await stepProgress(sb, researchRunId);
    return json({
      ok: progress.completed > 0 && progress.terminal,
      terminal: progress.terminal,
      message: progress.terminal ? "No recoverable Avatar OS steps remain." : "Another worker currently owns the next Avatar OS step.",
      research_run_id: researchRunId,
      release_id: release.id,
      progress,
    });
  }
  const step = claimed as ResearchStepRow;
  await sb.from("client_research_runs").update({
    status: "running", started_at: run.started_at ?? new Date().toISOString(), retryable: false, failure_code: null, failure_message: null,
  }).eq("id", researchRunId);

  const authorityResult = await loadAvatarAuthority(sb, clientId);
  if (!authorityResult.ok) {
    await sb.from("client_research_steps").update({ status: "failed", failure_code: authorityResult.code, failure_message: authorityResult.message, lease_owner: null, lease_expires_at: null }).eq("id", step.id);
    await sb.from("client_research_runs").update({ status: "failed", failure_code: authorityResult.code, failure_message: authorityResult.message, retryable: false }).eq("id", researchRunId);
    return json({ ok: false, terminal: true, message: authorityResult.message, research_run_id: researchRunId, release_id: release.id, progress: await stepProgress(sb, researchRunId) }, authorityResult.status);
  }
  const expectedAuthority = release.authority_snapshot?.context as Array<{ id: string; version: number }> | undefined;
  const expectedMarketAuthority = release.authority_snapshot?.market_os as { release_id?: string; version?: number } | undefined;
  const currentById = new Map(authorityResult.authority.files.map((file) => [file.id, file.version]));
  const authorityChanged = !expectedAuthority ||
    expectedAuthority.some((file) => currentById.get(file.id) !== file.version) ||
    !expectedMarketAuthority ||
    expectedMarketAuthority.release_id !== authorityResult.authority.marketRelease.id ||
    expectedMarketAuthority.version !== authorityResult.authority.marketRelease.version;
  if (authorityChanged) {
    const message = "Approved Context or the active Market OS changed after this Avatar OS run began. Start a new run from the new authority.";
    await sb.from("client_research_steps").update({ status: "failed", attempt_count: step.maximum_attempts, failure_code: "AUTHORITY_CHANGED", failure_message: message, lease_owner: null, lease_expires_at: null }).eq("id", step.id);
    await sb.from("client_research_runs").update({ status: "failed", failure_code: "AUTHORITY_CHANGED", failure_message: message, retryable: false }).eq("id", researchRunId);
    return json({ ok: false, terminal: true, message, research_run_id: researchRunId, release_id: release.id, progress: await stepProgress(sb, researchRunId) }, 409);
  }
  const module = AVATAR_RESEARCH_MODULES.find((candidate) => candidate.key === step.step_key);
  if (!module) return json({ ok: false, terminal: true, message: `Unknown Avatar OS step ${step.step_key}.` }, 500);

  try {
    const { data: existingRecords, error: existingRecordsError } = await sb.from("client_intelligence_records")
      .select("record_type,record_key,title,summary,payload")
      .eq("client_id", clientId)
      .eq("release_id", release.id)
      .order("display_order");
    if (existingRecordsError) throw new Error(existingRecordsError.message);
    const { data: memory } = await sb.from("client_agent_memory")
      .select("summary,unresolved_notes").eq("client_id", clientId).eq("intelligence_domain", "avatar_os").maybeSingle();
    const memoryNote = renderMemoryNote(memory, step.step_key);
    const providerResult = await runAvatarResearchAgent({
      module,
      clientName: authorityResult.authority.client.name,
      approvedContext: renderAuthority(authorityResult.authority.files),
      approvedMarketOS: renderMarketAuthority(authorityResult.authority),
      existingAvatarModel: compact(renderAvatarModel(existingRecords ?? []), AVATAR_MODEL_TOTAL_CAP),
      memoryNote,
      model: run.model ?? undefined,
    });
    if (step.step_key === "buyer_role_system") {
      await ensureAvatarFollowupSteps(
        sb,
        clientId,
        researchRunId,
        providerResult.output.conditional_module_keys,
      );
    }
    await persistModule({
      sb, clientId, runId: researchRunId, releaseId: release.id, step,
      authority: authorityResult.authority, result: providerResult,
    });
    const { count: sourceCount } = await sb.from("client_research_sources")
      .select("id", { count: "exact", head: true }).eq("research_run_id", researchRunId);
    await sb.from("client_research_runs").update({ source_count: sourceCount ?? 0 }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({
      ok: true,
      terminal: progress.terminal,
      message: `${step.title} completed.`,
      research_run_id: researchRunId,
      release_id: release.id,
      step: { ...step, status: "completed", completed_at: new Date().toISOString() },
      progress,
    });
  } catch (error) {
    const message = compact(errorMessage(error), 2000);
    const code = safeFailureCode(error);
    const retryable = isRetryableProviderError(error) && step.attempt_count < step.maximum_attempts;
    await sb.from("client_provider_operation_receipts").insert({
      client_id: clientId,
      research_run_id: researchRunId,
      research_step_id: step.id,
      capability: "web_research_and_structured_synthesis",
      provider: "anthropic",
      model: run.model,
      status: "failed",
      error_class: code,
      error_message: message,
    });
    await sb.from("client_research_steps").update({
      status: "failed",
      attempt_count: retryable ? step.attempt_count : step.maximum_attempts,
      failure_code: code,
      failure_message: message,
      lease_owner: null,
      lease_expires_at: null,
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({
      status: "failed", failure_code: code, failure_message: message, retryable,
    }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({
      ok: retryable || (progress.completed > 0 && progress.terminal),
      terminal: progress.terminal,
      message: retryable ? `${step.title} failed and can be retried: ${message}` : `${step.title} failed: ${message}`,
      research_run_id: researchRunId,
      release_id: release.id,
      step: { ...step, status: "failed", failure_code: code, failure_message: message },
      progress,
    });
  }
}

async function finalize(sb: ServiceClient, clientId: string, researchRunId: string) {
  const [runResult, releaseResult, stepsResult, recordsResult, findingsResult, sourceCountResult] = await Promise.all([
    sb.from("client_research_runs").select("*").eq("id", researchRunId).eq("client_id", clientId).maybeSingle(),
    sb.from("client_intelligence_releases").select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).maybeSingle(),
    sb.from("client_research_steps").select("*").eq("research_run_id", researchRunId).order("step_order"),
    sb.from("client_intelligence_records").select("*").eq("client_id", clientId).order("display_order"),
    sb.from("client_intelligence_release_findings").select("release_id,finding_id").eq("client_id", clientId),
    sb.from("client_research_sources").select("id", { count: "exact", head: true }).eq("research_run_id", researchRunId),
  ]);
  const error = runResult.error ?? releaseResult.error ?? stepsResult.error ?? recordsResult.error ?? findingsResult.error ?? sourceCountResult.error;
  if (error || !runResult.data || !releaseResult.data) return json({ ok: false, message: error?.message ?? "Avatar OS run or release not found." }, 404);
  const run = runResult.data;
  const release = releaseResult.data;
  if (release.status === "needs_review" || release.status === "approved") {
    return json({ ok: true, message: "Avatar OS release is already finalised.", release, run });
  }
  const steps = (stepsResult.data ?? []) as ResearchStepRow[];
  const progress = await stepProgress(sb, researchRunId);
  if (!progress.terminal || progress.completed === 0) {
    return json({ ok: false, message: "Avatar OS cannot be finalised while recoverable research remains or no module completed.", progress }, 409);
  }
  const records = (recordsResult.data ?? []).filter((record) => record.release_id === release.id);
  const findingIds = (findingsResult.data ?? []).filter((link) => link.release_id === release.id).map((link) => link.finding_id);
  if (records.length === 0) return json({ ok: false, message: "Avatar OS has no structured domain records." }, 409);
  const summaries = steps.filter((step) => step.status === "completed")
    .map((step) => ({
      module_key: step.step_key,
      title: step.title,
      summary: typeof step.output_summary?.summary === "string" ? step.output_summary.summary : "",
      unknowns: Array.isArray(step.output_summary?.unknowns) ? step.output_summary.unknowns : [],
      contradictions: Array.isArray(step.output_summary?.contradictions) ? step.output_summary.contradictions : [],
    }));
  const summary = compact(summaries.map((module) => module.summary).filter(Boolean).join(" "), 8000);
  const generatedAt = new Date().toISOString();
  const { data: updatedRelease, error: updateReleaseError } = await sb.from("client_intelligence_releases").update({
    status: "needs_review",
    summary,
    content: {
      schema_version: 1,
      intelligence_domain: "avatar_os",
      modules: summaries,
      record_count: records.length,
      finding_count: findingIds.length,
      source_count: sourceCountResult.count ?? 0,
      completed_modules: progress.completed,
      failed_modules: progress.failed,
    },
    generated_at: generatedAt,
    submitted_at: generatedAt,
  }).eq("id", release.id).eq("status", "draft").select("*").single();
  if (updateReleaseError) return json({ ok: false, message: updateReleaseError.message }, 500);
  const runStatus = progress.failed > 0 ? "completed_partial" : "completed";
  const { data: updatedRun, error: updateRunError } = await sb.from("client_research_runs").update({
    status: runStatus,
    source_count: sourceCountResult.count ?? 0,
    completed_at: generatedAt,
    retryable: false,
    failure_code: progress.failed > 0 ? "PARTIAL_MODULE_FAILURE" : null,
    failure_message: progress.failed > 0 ? `${progress.failed} Avatar OS module(s) did not complete.` : null,
  }).eq("id", run.id).select("*").single();
  if (updateRunError) return json({ ok: false, message: updateRunError.message }, 500);
  await audit(sb, "avatar_os.submitted_for_review", "client_intelligence_releases", release.id, {
    client_id: clientId,
    research_run_id: run.id,
    version: release.version,
    completed_modules: progress.completed,
    failed_modules: progress.failed,
  });

  const unresolvedNotes = summaries.flatMap((module) =>
    module.unknowns.map((claim: unknown) => ({ module_key: module.module_key, claim: compact(String(claim), 500) }))
  );
  await sb.from("client_agent_memory").upsert({
    client_id: clientId,
    intelligence_domain: "avatar_os",
    summary: compact(summary, 2000),
    unresolved_notes: unresolvedNotes,
    source_run_id: run.id,
    updated_at: generatedAt,
  }, { onConflict: "client_id,intelligence_domain" });

  return json({ ok: true, message: "Avatar OS is ready for human review.", release: updatedRelease, run: updatedRun });
}

async function retryFailedStep(
  sb: ServiceClient,
  clientId: string,
  researchRunId: string,
  stepId: string,
  userId: string,
) {
  const [runResult, releaseResult, stepResult] = await Promise.all([
    sb.from("client_research_runs").select("*")
      .eq("id", researchRunId).eq("client_id", clientId).eq("intelligence_domain", "avatar_os").maybeSingle(),
    sb.from("client_intelligence_releases").select("*")
      .eq("client_id", clientId).eq("research_run_id", researchRunId).in("status", ["draft", "needs_review"]).maybeSingle(),
    sb.from("client_research_steps").select("*")
      .eq("id", stepId).eq("client_id", clientId).eq("research_run_id", researchRunId).maybeSingle(),
  ]);
  const error = runResult.error ?? releaseResult.error ?? stepResult.error;
  if (error) return json({ ok: false, message: error.message }, 500);
  if (!runResult.data || !releaseResult.data || !stepResult.data) {
    return json({ ok: false, message: "The failed Avatar OS module is no longer available to retry." }, 404);
  }
  if (stepResult.data.status !== "failed") {
    return json({ ok: false, message: "Only a failed Avatar OS module can be retried." }, 409);
  }

  await cleanupStepArtifacts(sb, clientId, releaseResult.data.id, stepId, stepResult.data.step_key);
  const { error: stepError } = await sb.from("client_research_steps").update({
    status: "queued",
    attempt_count: 0,
    failure_code: null,
    failure_message: null,
    output_summary: {},
    started_at: null,
    completed_at: null,
    lease_owner: null,
    lease_expires_at: null,
  }).eq("id", stepId).eq("client_id", clientId);
  if (stepError) return json({ ok: false, message: stepError.message }, 500);

  const { error: releaseError } = await sb.from("client_intelligence_releases").update({
    status: "draft",
    generated_at: null,
    submitted_at: null,
  }).eq("id", releaseResult.data.id).in("status", ["draft", "needs_review"]);
  if (releaseError) return json({ ok: false, message: releaseError.message }, 500);

  const { error: runError } = await sb.from("client_research_runs").update({
    status: "queued",
    retryable: true,
    failure_code: null,
    failure_message: null,
    completed_at: null,
  }).eq("id", researchRunId).eq("client_id", clientId);
  if (runError) return json({ ok: false, message: runError.message }, 500);

  await audit(sb, "avatar_os.failed_module_requeued", "client_research_steps", stepId, {
    client_id: clientId,
    research_run_id: researchRunId,
    release_id: releaseResult.data.id,
    step_key: stepResult.data.step_key,
    requested_by: userId,
  });
  return json({
    ok: true,
    mode: "resumed",
    message: `${stepResult.data.title} was cleared and queued for regeneration.`,
    research_run_id: researchRunId,
    release_id: releaseResult.data.id,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);

  let body: { action?: Action; client_id?: string; research_run_id?: string; step_id?: string };
  try { body = await req.json(); }
  catch { return json({ ok: false, message: "Invalid JSON body." }, 400); }
  const clientId = (body.client_id ?? "").trim();
  const action = body.action;
  if (!clientId) return json({ ok: false, message: "client_id is required." }, 400);
  if (!action || !new Set<Action>(["prepare", "step", "finalize", "retry_step"]).has(action)) {
    return json({ ok: false, message: "action must be prepare, step, finalize, or retry_step." }, 400);
  }

  const access = await validateIntelligenceAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ ok: false, code: access.code, message: access.message }, access.status);
  const sb = svc();
  try {
    if (action === "prepare") return await prepare(sb, clientId, access.userId);
    const researchRunId = (body.research_run_id ?? "").trim();
    if (!researchRunId) return json({ ok: false, message: "research_run_id is required." }, 400);
    if (action === "retry_step") {
      const stepId = (body.step_id ?? "").trim();
      if (!stepId) return json({ ok: false, message: "step_id is required." }, 400);
      return await retryFailedStep(sb, clientId, researchRunId, stepId, access.userId);
    }
    if (action === "step") return await runStep(sb, clientId, researchRunId);
    return await finalize(sb, clientId, researchRunId);
  } catch (error) {
    return json({ ok: false, message: errorMessage(error) }, 500);
  }
});
