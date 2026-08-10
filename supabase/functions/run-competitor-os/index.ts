// Phase 2A-C — one-button Competitor OS orchestration.
//
// One UI action drives prepare -> bounded research steps -> finalize. Each
// provider call is isolated so the workflow can resume after navigation,
// provider failure, or an Edge Function wall-clock interruption. Human review
// remains a separate database-controlled decision.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";
import {
  COMPETITOR_CORE_MODULES,
  COMPETITOR_RESEARCH_MODULES,
  runOpenAiCompetitorResearch,
  type CompetitorModuleFinding,
} from "../_shared/intelligence/competitor-research-provider.ts";

type Action = "prepare" | "step" | "finalize";
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

interface CompetitorAuthority {
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
    created_at?: string;
    record_type: string;
    record_key: string;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
  }>;
  avatarRelease: {
    id: string;
    version: number;
    title: string;
    summary: string;
    content: Record<string, unknown>;
    approved_at: string;
  };
  avatarRecords: Array<{
    created_at?: string;
    record_type: string;
    record_key: string;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
  }>;
  previousCompetitorRelease: {
    id: string;
    version: number;
    title: string;
    summary: string;
    approved_at: string;
  } | null;
  previousCompetitorRecords: Array<{
    created_at?: string;
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
  if (message.includes("invalid json") || message.includes("invalid identity") || message.includes("duplicate observation identity")) return "PROVIDER_INVALID_RESPONSE";
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

function identityPart(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
}

function observationIdentity(record: { subject_key: string; observation_kind: string; record_key: string }): string {
  const subject = identityPart(record.subject_key);
  const kind = identityPart(record.observation_kind);
  const key = identityPart(record.record_key);
  if (!subject || !kind || !key) throw new Error("Competitor OS returned an invalid observation identity.");
  return `${subject}|${kind}|${key}`;
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

function renderMarketAuthority(authority: CompetitorAuthority): string {
  const release = authority.marketRelease;
  const records = authority.marketRecords.map((record) => {
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
    return `## ${record.title} [${record.record_type}/${record.record_key}]\n${record.summary}${details ? `\n${details}` : ""}`;
  }).join("\n\n");
  return `# ${release.title} (approved v${release.version})\n${release.summary}\n\n${compact(records, 24000)}`;
}

function renderAvatarAuthority(authority: CompetitorAuthority): string {
  const release = authority.avatarRelease;
  const records = renderCompetitorModel(authority.avatarRecords);
  return `# ${release.title} (approved v${release.version})\n${release.summary}\n\n${compact(records, 24000)}`;
}

function renderPreviousCompetitorOS(authority: CompetitorAuthority): string {
  const release = authority.previousCompetitorRelease;
  if (!release) return "";
  return `# ${release.title} (approved v${release.version})\n${release.summary}\n\n${compact(renderCompetitorModel(authority.previousCompetitorRecords), 24000)}`;
}

function renderCompetitorModel(records: Array<{ record_type: string; record_key: string; title: string; summary: string; payload: Record<string, unknown> }>): string {
  return records.map((record) => {
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
    return `## ${record.title} [${record.record_type}/${record.record_key}]\n${record.summary}${details ? `\n${details}` : ""}`;
  }).join("\n\n");
}

async function loadCompetitorAuthority(sb: ServiceClient, clientId: string): Promise<
  | { ok: true; authority: CompetitorAuthority }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }
> {
  const [clientResult, contextResult, marketPointerResult, avatarPointerResult, competitorPointerResult] = await Promise.all([
    sb.from("clients").select("id,name,stage1_status").eq("id", clientId).maybeSingle(),
    sb.from("client_context_files")
      .select("id,file_number,file_name,content_md,status,version")
      .eq("client_id", clientId).order("file_number"),
    sb.from("client_intelligence_active_releases")
      .select("release_id").eq("client_id", clientId).eq("intelligence_domain", "market_os").maybeSingle(),
    sb.from("client_intelligence_active_releases")
      .select("release_id").eq("client_id", clientId).eq("intelligence_domain", "avatar_os").maybeSingle(),
    sb.from("client_intelligence_active_releases")
      .select("release_id").eq("client_id", clientId).eq("intelligence_domain", "competitor_os").maybeSingle(),
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
      message: "Competitor OS requires an active approved Market OS release.",
    };
  }
  if (avatarPointerResult.error || !avatarPointerResult.data?.release_id) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_OS_REQUIRED",
      message: "Competitor OS requires an active approved Avatar OS release.",
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
      message: "Competitor OS requires all 21 approved, non-empty Context Files.",
      details: { stage1_status: clientResult.data.stage1_status, approved: approved.length, missing_file_numbers: [...expected] },
    };
  }
  const [marketReleaseResult, marketRecordsResult, avatarReleaseResult, avatarRecordsResult] = await Promise.all([
    sb.from("client_intelligence_releases")
      .select("id,version,title,summary,content,approved_at")
      .eq("id", marketPointerResult.data.release_id)
      .eq("client_id", clientId)
      .eq("intelligence_domain", "market_os")
      .eq("status", "approved")
      .maybeSingle(),
    sb.from("client_intelligence_records")
      .select("created_at,record_type,record_key,title,summary,payload")
      .eq("client_id", clientId)
      .eq("release_id", marketPointerResult.data.release_id)
      .order("display_order"),
    sb.from("client_intelligence_releases")
      .select("id,version,title,summary,content,approved_at")
      .eq("id", avatarPointerResult.data.release_id)
      .eq("client_id", clientId)
      .eq("intelligence_domain", "avatar_os")
      .eq("status", "approved")
      .maybeSingle(),
    sb.from("client_intelligence_records")
      .select("created_at,record_type,record_key,title,summary,payload")
      .eq("client_id", clientId)
      .eq("release_id", avatarPointerResult.data.release_id)
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
  if (avatarReleaseResult.error || !avatarReleaseResult.data?.approved_at) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_OS_REQUIRED",
      message: "The active Avatar OS pointer does not reference an approved release.",
    };
  }
  if (avatarRecordsResult.error || (avatarRecordsResult.data ?? []).length === 0) {
    return {
      ok: false,
      status: 409,
      code: "AVATAR_OS_RECORDS_REQUIRED",
      message: "The active Avatar OS release has no structured buyer-role records.",
    };
  }

  let previousCompetitorRelease: CompetitorAuthority["previousCompetitorRelease"] = null;
  let previousCompetitorRecords: CompetitorAuthority["previousCompetitorRecords"] = [];
  if (competitorPointerResult.error) {
    return { ok: false, status: 500, code: "COMPETITOR_POINTER_QUERY_FAILED", message: competitorPointerResult.error.message };
  }
  if (competitorPointerResult.data?.release_id) {
    const [previousReleaseResult, previousRecordsResult] = await Promise.all([
      sb.from("client_intelligence_releases")
        .select("id,version,title,summary,approved_at")
        .eq("id", competitorPointerResult.data.release_id)
        .eq("client_id", clientId)
        .eq("intelligence_domain", "competitor_os")
        .eq("status", "approved")
        .maybeSingle(),
      sb.from("client_intelligence_records")
        .select("created_at,record_type,record_key,title,summary,payload")
        .eq("client_id", clientId)
        .eq("release_id", competitorPointerResult.data.release_id)
        .order("display_order"),
    ]);
    if (previousReleaseResult.error || !previousReleaseResult.data?.approved_at || previousRecordsResult.error) {
      return { ok: false, status: 409, code: "ACTIVE_COMPETITOR_OS_INVALID", message: "The active Competitor OS release cannot be used as refresh history." };
    }
    previousCompetitorRelease = previousReleaseResult.data;
    previousCompetitorRecords = previousRecordsResult.data ?? [];
  }
  return {
    ok: true,
    authority: {
      client: clientResult.data,
      files: approved,
      marketRelease: marketReleaseResult.data,
      marketRecords: marketRecordsResult.data ?? [],
      avatarRelease: avatarReleaseResult.data,
      avatarRecords: avatarRecordsResult.data ?? [],
      previousCompetitorRelease,
      previousCompetitorRecords,
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

async function ensureCompetitorFollowupSteps(
  sb: ServiceClient,
  clientId: string,
  researchRunId: string,
) {
  const modules = COMPETITOR_CORE_MODULES.slice(1);
  const { data: existing, error: existingError } = await sb.from("client_research_steps")
    .select("step_key").eq("research_run_id", researchRunId);
  if (existingError) throw new Error(existingError.message);
  const existingKeys = new Set((existing ?? []).map((step) => step.step_key));
  const rows = modules.filter((module) => !existingKeys.has(module.key)).map((module) => ({
    client_id: clientId,
    research_run_id: researchRunId,
    step_key: module.key,
    step_order: COMPETITOR_RESEARCH_MODULES.findIndex((candidate) => candidate.key === module.key) + 1,
    title: module.title,
  }));
  if (rows.length === 0) return;
  const { error } = await sb.from("client_research_steps").insert(rows);
  if (error) throw new Error(error.message);
}

async function prepare(sb: ServiceClient, clientId: string, userId: string) {
  const authorityResult = await loadCompetitorAuthority(sb, clientId);
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
    avatar_os: {
      release_id: authority.avatarRelease.id,
      version: authority.avatarRelease.version,
      approved_at: authority.avatarRelease.approved_at,
    },
    previous_competitor_os: authority.previousCompetitorRelease ? {
      release_id: authority.previousCompetitorRelease.id,
      version: authority.previousCompetitorRelease.version,
      approved_at: authority.previousCompetitorRelease.approved_at,
    } : null,
  };
  const authorityHash = await sha256(JSON.stringify(authoritySnapshot));

  const { data: openRuns, error: openRunError } = await sb.from("client_research_runs")
    .select("*").eq("client_id", clientId).eq("intelligence_domain", "competitor_os")
    .in("status", ["queued", "running", "waiting_provider", "failed", "completed_partial"])
    .order("created_at", { ascending: false }).limit(5);
  if (openRunError) return json({ ok: false, mode: "blocked", message: openRunError.message }, 500);

  for (const run of openRuns ?? []) {
    const { data: release } = await sb.from("client_intelligence_releases")
      .select("id,status").eq("client_id", clientId).eq("research_run_id", run.id)
      .in("status", ["draft", "needs_review"]).maybeSingle();
    if (!release || release.status === "needs_review") continue;
    const { data: loadedSteps, error: stepsError } = await sb.from("client_research_steps")
      .select("*").eq("research_run_id", run.id).order("step_order");
    if (stepsError) return json({ ok: false, mode: "blocked", message: stepsError.message }, 500);
    let steps = loadedSteps ?? [];
    if (run.status === "completed_partial") {
      const exhaustedFailedStepIds = steps
        .filter((step) => step.status === "failed" && step.attempt_count >= step.maximum_attempts)
        .map((step) => step.id);
      if (exhaustedFailedStepIds.length > 0) {
        const { error: resetError } = await sb.from("client_research_steps").update({
          status: "queued",
          attempt_count: 0,
          failure_code: null,
          failure_message: null,
          started_at: null,
          completed_at: null,
          lease_owner: null,
          lease_expires_at: null,
        }).in("id", exhaustedFailedStepIds).eq("client_id", clientId);
        if (resetError) return json({ ok: false, mode: "blocked", message: resetError.message }, 500);
        steps = steps.map((step) => exhaustedFailedStepIds.includes(step.id)
          ? { ...step, status: "queued", attempt_count: 0, failure_code: null, failure_message: null }
          : step);
      }
    }
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
      message: "Resuming the existing Competitor OS build.",
      research_run_id: run.id,
      release_id: release.id,
      steps,
    });
  }

  const { data: latestRelease, error: versionError } = await sb.from("client_intelligence_releases")
    .select("version").eq("client_id", clientId).eq("intelligence_domain", "competitor_os")
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (versionError) return json({ ok: false, mode: "blocked", message: versionError.message }, 500);
  const version = (latestRelease?.version ?? 0) + 1;
  const model = (Deno.env.get("OPENAI_COMPETITOR_RESEARCH_MODEL") ?? Deno.env.get("OPENAI_MARKET_RESEARCH_MODEL") ?? "gpt-5.6-terra").trim();
  const timeBucket = Math.floor(Date.now() / 600_000);
  const idempotencyKey = `competitor_os:${authorityHash.slice(0, 40)}:v${version}:${timeBucket}`;

  const { data: run, error: runError } = await sb.from("client_research_runs").insert({
    client_id: clientId,
    research_domain: "competitor",
    intelligence_domain: "competitor_os",
    status: "queued",
    idempotency_key: idempotencyKey,
    provider: "openai",
    model,
    prompt_digest: authorityHash,
    configuration_snapshot: {
      authority: authoritySnapshot,
      authority_hash: authorityHash,
      module_manifest: COMPETITOR_CORE_MODULES,
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
        return json({ ok: true, mode: "resumed", message: "Resuming the existing Competitor OS build.", research_run_id: duplicate.id, release_id: release?.id, steps: steps ?? [] });
      }
    }
    return json({ ok: false, mode: "blocked", message: runError.message }, 500);
  }

  const { data: release, error: releaseError } = await sb.from("client_intelligence_releases").insert({
    client_id: clientId,
    intelligence_domain: "competitor_os",
    version,
    status: "draft",
    research_run_id: run.id,
    title: `Competitor OS v${version}`,
    authority_snapshot: { ...authoritySnapshot, authority_hash: authorityHash },
    created_by: userId,
  }).select("*").single();
  if (releaseError) {
    await sb.from("client_research_runs").update({ status: "failed", failure_code: "RELEASE_CREATE_FAILED", failure_message: releaseError.message, retryable: false }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
  }

  const stepRows = COMPETITOR_CORE_MODULES.slice(0, 1).map((module) => ({
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
    intelligence_domain: "competitor_os",
    refresh_interval_days: 30,
    due_warning_days: 7,
    scheduled_refresh_enabled: false,
    policy_reason: "Competitor observations are comparatively dynamic and require a more frequent review rhythm; scheduled monitoring remains disabled until operationalization.",
    updated_by: userId,
  }, { onConflict: "client_id,intelligence_domain" });
  await audit(sb, "competitor_os.prepared", "client_intelligence_releases", release.id, {
    client_id: clientId, research_run_id: run.id, version, authority_hash: authorityHash,
  });
  return json({
    ok: true,
    mode: "prepared",
    message: "Competitor OS research workflow prepared.",
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
}

async function persistModule(input: {
  sb: ServiceClient;
  clientId: string;
  runId: string;
  releaseId: string;
  step: ResearchStepRow;
  authority: CompetitorAuthority;
  result: Awaited<ReturnType<typeof runOpenAiCompetitorResearch>>;
}) {
  const { sb, clientId, runId, releaseId, step, authority, result } = input;
  await cleanupStepArtifacts(sb, clientId, releaseId, step.id, step.step_key);

  const sourceRows = result.sources.map((source) => ({
    client_id: clientId,
    research_run_id: runId,
    url: source.url,
    canonical_url: source.url,
    title: compact(source.title, 500),
    publisher: new URL(source.url).hostname,
    retrieved_at: result.retrievedAt,
    evidence_kind: "paraphrased",
    evidence_text: `Source consulted during the ${step.title} Competitor OS module.`,
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
  const avatarByKey = new Map(authority.avatarRecords.map((record) => [record.record_key, record]));
  const previousByIdentity = new Map(authority.previousCompetitorRecords.flatMap((record) => {
    const identity = typeof record.payload?.observation_identity === "string" ? record.payload.observation_identity : null;
    return identity ? [[identity, record] as const] : [];
  }));
  const { data: currentReleaseRecords, error: currentReleaseRecordsError } = await sb.from("client_intelligence_records")
    .select("payload").eq("client_id", clientId).eq("release_id", releaseId);
  if (currentReleaseRecordsError) throw new Error(currentReleaseRecordsError.message);
  const seenObservationIdentities = new Set((currentReleaseRecords ?? []).flatMap((record) =>
    typeof record.payload?.observation_identity === "string" ? [record.payload.observation_identity] : []
  ));
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
        .filter((record): record is CompetitorAuthority["marketRecords"][number] => Boolean(record));
      const matchedAvatarRecords = providerFinding.avatar_record_keys
        .map((recordKey) => avatarByKey.get(recordKey))
        .filter((record): record is CompetitorAuthority["avatarRecords"][number] => Boolean(record));
      const hasEvidence = matchedSources.length > 0 || matchedContext.length > 0 || matchedMarketRecords.length > 0 || matchedAvatarRecords.length > 0;
      const normalised = normaliseFinding(providerFinding, hasEvidence);
      const { data: finding, error: findingError } = await sb.from("client_intelligence_findings").insert({
        client_id: clientId,
        intelligence_domain: "competitor_os",
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
          requested_avatar_record_keys: providerFinding.avatar_record_keys,
        },
        created_by: "openai_competitor_research",
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
        ...matchedAvatarRecords.map((record) => ({
          client_id: clientId,
          research_run_id: runId,
          source_type: "structured_observation",
          evidence_kind: "structured_observation",
          evidence_text: compact(`${record.title}: ${record.summary}`, 30000),
          locator: {
            upstream_domain: "avatar_os",
            release_id: authority.avatarRelease.id,
            release_version: authority.avatarRelease.version,
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
    const identity = observationIdentity(record);
    if (seenObservationIdentities.has(identity)) throw new Error(`Competitor OS returned a duplicate observation identity: ${identity}`);
    seenObservationIdentities.add(identity);
    const fingerprint = await sha256(JSON.stringify({
      title: record.title,
      summary: record.summary,
      details: record.details,
      findings: record.findings.map((finding) => ({ claim: finding.claim, disposition: finding.disposition })),
    }));
    const previous = previousByIdentity.get(identity);
    const previousFingerprint = typeof previous?.payload?.observation_fingerprint === "string"
      ? previous.payload.observation_fingerprint
      : null;
    const changeStatus = !previous ? "new" : previousFingerprint === fingerprint ? "unchanged" : "changed";
    const observedAt = Number.isNaN(Date.parse(record.observed_at)) ? result.retrievedAt : new Date(record.observed_at).toISOString();
    const firstSeenAt = typeof previous?.payload?.first_seen_at === "string"
      ? previous.payload.first_seen_at
      : previous?.created_at ?? observedAt;
    const stableRecordKey = `${identityPart(record.subject_key).slice(0, 78)}__${identityPart(record.record_key).slice(0, 78)}`;
    recordRows.push({
      client_id: clientId,
      release_id: releaseId,
      record_type: step.step_key,
      record_key: stableRecordKey,
      title: compact(record.title, 500),
      summary: compact(record.summary, 5000),
      payload: {
        details: record.details,
        finding_ids: recordFindingIds,
        module_key: step.step_key,
        subject_key: identityPart(record.subject_key),
        alternative_type: record.alternative_type,
        observation_kind: identityPart(record.observation_kind),
        observation_identity: identity,
        observation_fingerprint: fingerprint,
        previous_observation_fingerprint: previousFingerprint,
        change_status: changeStatus,
        first_seen_at: firstSeenAt,
        observed_at: observedAt,
        previous_release_id: previous ? authority.previousCompetitorRelease?.id ?? null : null,
      },
      display_order: (step.step_order * 100) + recordIndex,
    });
  }
  if (recordRows.length === 0) throw new Error("Competitor OS module returned no structured domain records.");
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
      record_count: recordRows.length,
      finding_count: findingCount,
      provider_request_id: result.providerRequestId,
    },
  }).eq("id", step.id);
  if (completeError) throw new Error(completeError.message);
}

function normaliseFinding(finding: CompetitorModuleFinding, hasEvidence: boolean): CompetitorModuleFinding {
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
    .select("*").eq("id", researchRunId).eq("client_id", clientId).eq("intelligence_domain", "competitor_os").maybeSingle();
  if (runError || !run) return json({ ok: false, terminal: true, message: runError?.message ?? "Competitor OS research run not found." }, 404);
  if (run.status === "completed" || run.status === "completed_partial" || run.status === "cancelled") {
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: true, terminal: true, message: "Competitor OS research is already terminal.", research_run_id: researchRunId, progress });
  }
  const { data: release, error: releaseError } = await sb.from("client_intelligence_releases")
    .select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).eq("status", "draft").maybeSingle();
  if (releaseError || !release) return json({ ok: false, terminal: true, message: releaseError?.message ?? "Draft Competitor OS release not found." }, 409);

  const leaseOwner = `competitor-os:${crypto.randomUUID()}`;
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
      message: progress.terminal ? "No recoverable Competitor OS steps remain." : "Another worker currently owns the next Competitor OS step.",
      research_run_id: researchRunId,
      release_id: release.id,
      progress,
    });
  }
  const step = claimed as ResearchStepRow;
  await sb.from("client_research_runs").update({
    status: "running", started_at: run.started_at ?? new Date().toISOString(), retryable: false, failure_code: null, failure_message: null,
  }).eq("id", researchRunId);

  const authorityResult = await loadCompetitorAuthority(sb, clientId);
  if (!authorityResult.ok) {
    await sb.from("client_research_steps").update({ status: "failed", failure_code: authorityResult.code, failure_message: authorityResult.message, lease_owner: null, lease_expires_at: null }).eq("id", step.id);
    await sb.from("client_research_runs").update({ status: "failed", failure_code: authorityResult.code, failure_message: authorityResult.message, retryable: false }).eq("id", researchRunId);
    return json({ ok: false, terminal: true, message: authorityResult.message, research_run_id: researchRunId, release_id: release.id, progress: await stepProgress(sb, researchRunId) }, authorityResult.status);
  }
  const expectedAuthority = release.authority_snapshot?.context as Array<{ id: string; version: number }> | undefined;
  const expectedMarketAuthority = release.authority_snapshot?.market_os as { release_id?: string; version?: number } | undefined;
  const expectedAvatarAuthority = release.authority_snapshot?.avatar_os as { release_id?: string; version?: number } | undefined;
  const expectedPreviousCompetitorAuthority = release.authority_snapshot?.previous_competitor_os as { release_id?: string; version?: number } | null | undefined;
  const currentById = new Map(authorityResult.authority.files.map((file) => [file.id, file.version]));
  const authorityChanged = !expectedAuthority ||
    expectedAuthority.some((file) => currentById.get(file.id) !== file.version) ||
    !expectedMarketAuthority ||
    expectedMarketAuthority.release_id !== authorityResult.authority.marketRelease.id ||
    expectedMarketAuthority.version !== authorityResult.authority.marketRelease.version ||
    !expectedAvatarAuthority ||
    expectedAvatarAuthority.release_id !== authorityResult.authority.avatarRelease.id ||
    expectedAvatarAuthority.version !== authorityResult.authority.avatarRelease.version ||
    (expectedPreviousCompetitorAuthority?.release_id ?? null) !== (authorityResult.authority.previousCompetitorRelease?.id ?? null) ||
    (expectedPreviousCompetitorAuthority?.version ?? null) !== (authorityResult.authority.previousCompetitorRelease?.version ?? null);
  if (authorityChanged) {
    const message = "Approved Context or an active upstream OS changed after this Competitor OS run began. Start a new run from the new authority.";
    await sb.from("client_research_steps").update({ status: "failed", attempt_count: step.maximum_attempts, failure_code: "AUTHORITY_CHANGED", failure_message: message, lease_owner: null, lease_expires_at: null }).eq("id", step.id);
    await sb.from("client_research_runs").update({ status: "failed", failure_code: "AUTHORITY_CHANGED", failure_message: message, retryable: false }).eq("id", researchRunId);
    return json({ ok: false, terminal: true, message, research_run_id: researchRunId, release_id: release.id, progress: await stepProgress(sb, researchRunId) }, 409);
  }
  const module = COMPETITOR_RESEARCH_MODULES.find((candidate) => candidate.key === step.step_key);
  if (!module) return json({ ok: false, terminal: true, message: `Unknown Competitor OS step ${step.step_key}.` }, 500);

  try {
    const { data: existingRecords, error: existingRecordsError } = await sb.from("client_intelligence_records")
      .select("record_type,record_key,title,summary,payload")
      .eq("client_id", clientId)
      .eq("release_id", release.id)
      .order("display_order");
    if (existingRecordsError) throw new Error(existingRecordsError.message);
    const providerResult = await runOpenAiCompetitorResearch({
      module,
      clientName: authorityResult.authority.client.name,
      approvedContext: renderAuthority(authorityResult.authority.files),
      approvedMarketOS: renderMarketAuthority(authorityResult.authority),
      approvedAvatarOS: renderAvatarAuthority(authorityResult.authority),
      existingCompetitorModel: compact(renderCompetitorModel(existingRecords ?? []), 24000),
      previousActiveCompetitorOS: renderPreviousCompetitorOS(authorityResult.authority),
      model: run.model ?? undefined,
    });
    if (step.step_key === "alternative_registry") {
      await ensureCompetitorFollowupSteps(sb, clientId, researchRunId);
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
      provider: "openai",
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
  if (error || !runResult.data || !releaseResult.data) return json({ ok: false, message: error?.message ?? "Competitor OS run or release not found." }, 404);
  const run = runResult.data;
  const release = releaseResult.data;
  if (release.status === "needs_review" || release.status === "approved") {
    return json({ ok: true, message: "Competitor OS release is already finalised.", release, run });
  }
  const steps = (stepsResult.data ?? []) as ResearchStepRow[];
  const progress = await stepProgress(sb, researchRunId);
  if (!progress.terminal || progress.completed === 0) {
    return json({ ok: false, message: "Competitor OS cannot be finalised while recoverable research remains or no module completed.", progress }, 409);
  }
  const records = (recordsResult.data ?? []).filter((record) => record.release_id === release.id);
  const findingIds = (findingsResult.data ?? []).filter((link) => link.release_id === release.id).map((link) => link.finding_id);
  if (records.length === 0) return json({ ok: false, message: "Competitor OS has no structured domain records." }, 409);
  const alternativeTypeCounts = records.reduce<Record<string, number>>((counts, record) => {
    const type = typeof record.payload?.alternative_type === "string" ? record.payload.alternative_type : "unclassified";
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
  const changeStatusCounts = records.reduce<Record<string, number>>((counts, record) => {
    const status = typeof record.payload?.change_status === "string" ? record.payload.change_status : "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
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
      intelligence_domain: "competitor_os",
      modules: summaries,
      record_count: records.length,
      finding_count: findingIds.length,
      source_count: sourceCountResult.count ?? 0,
      completed_modules: progress.completed,
      failed_modules: progress.failed,
      alternative_type_counts: alternativeTypeCounts,
      change_status_counts: changeStatusCounts,
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
    failure_message: progress.failed > 0 ? `${progress.failed} Competitor OS module(s) did not complete.` : null,
  }).eq("id", run.id).select("*").single();
  if (updateRunError) return json({ ok: false, message: updateRunError.message }, 500);
  await audit(sb, "competitor_os.submitted_for_review", "client_intelligence_releases", release.id, {
    client_id: clientId,
    research_run_id: run.id,
    version: release.version,
    completed_modules: progress.completed,
    failed_modules: progress.failed,
  });
  return json({ ok: true, message: "Competitor OS is ready for human review.", release: updatedRelease, run: updatedRun });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);

  let body: { action?: Action; client_id?: string; research_run_id?: string };
  try { body = await req.json(); }
  catch { return json({ ok: false, message: "Invalid JSON body." }, 400); }
  const clientId = (body.client_id ?? "").trim();
  const action = body.action;
  if (!clientId) return json({ ok: false, message: "client_id is required." }, 400);
  if (!action || !new Set<Action>(["prepare", "step", "finalize"]).has(action)) {
    return json({ ok: false, message: "action must be prepare, step, or finalize." }, 400);
  }

  const access = await validateIntelligenceAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ ok: false, code: access.code, message: access.message }, access.status);
  const sb = svc();
  try {
    if (action === "prepare") return await prepare(sb, clientId, access.userId);
    const researchRunId = (body.research_run_id ?? "").trim();
    if (!researchRunId) return json({ ok: false, message: "research_run_id is required." }, 400);
    if (action === "step") return await runStep(sb, clientId, researchRunId);
    return await finalize(sb, clientId, researchRunId);
  } catch (error) {
    return json({ ok: false, message: errorMessage(error) }, 500);
  }
});
