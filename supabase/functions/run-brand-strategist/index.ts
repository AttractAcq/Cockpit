// Phase 2A-E — one-button Brand Strategist orchestration.
//
// One UI action drives prepare -> bounded research steps -> finalize. Each
// provider call is isolated so the workflow can resume after navigation,
// provider failure, or an Edge Function wall-clock interruption. Human review
// remains a separate database-controlled decision.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";
import {
  BRAND_STRATEGIST_MODULES,
  runOpenAiBrandStrategistSynthesis,
  type BrandStrategistFinding,
} from "../_shared/intelligence/brand-strategist-provider.ts";

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

interface BrandStrategistAuthority {
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
  competitorRelease: {
    id: string;
    version: number;
    title: string;
    summary: string;
    content: Record<string, unknown>;
    approved_at: string;
  };
  competitorRecords: Array<{
    created_at?: string;
    record_type: string;
    record_key: string;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
  }>;
  associationRelease: {
    id: string;
    version: number;
    title: string;
    summary: string;
    content: Record<string, unknown>;
    approved_at: string;
  };
  associationRecords: Array<{
    created_at?: string;
    record_type: string;
    record_key: string;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
  }>;
  readiness: {
    status: "ready" | "degraded";
    warnings: string[];
    domains: Array<{ domain: string; freshness: "fresh" | "due"; release_id: string; version: number }>;
  };
  previousBrandStrategistRelease: {
    id: string;
    version: number;
    title: string;
    summary: string;
    approved_at: string;
  } | null;
  previousBrandStrategistRecords: Array<{
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
  if (message.includes("invalid json") || message.includes("invalid identity") || message.includes("unsupported traceability") || message.includes("duplicate strategy identity")) return "PROVIDER_INVALID_RESPONSE";
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

function identityPart(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
}

function strategyIdentity(record: { record_kind: string; recommendation_type: string; record_key: string }): string {
  const subject = identityPart(record.record_kind);
  const kind = identityPart(record.recommendation_type);
  const key = identityPart(record.record_key);
  if (!subject || !kind || !key) throw new Error("Brand Strategist returned an invalid identity.");
  return `${subject}|${kind}|${key}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function contradictionCount(content: Record<string, unknown>): number {
  const modules = Array.isArray(content.modules) ? content.modules : [];
  return modules.reduce((total, module) => {
    if (!module || typeof module !== "object") return total;
    const contradictions = (module as { contradictions?: unknown }).contradictions;
    return total + (Array.isArray(contradictions) ? contradictions.length : 0);
  }, 0);
}

function freshnessFor(approvedAt: string, intervalDays: number, warningDays: number): "fresh" | "due" | "stale" {
  const approved = new Date(approvedAt);
  const staleAt = new Date(approved);
  staleAt.setUTCDate(staleAt.getUTCDate() + intervalDays);
  const dueAt = new Date(staleAt);
  dueAt.setUTCDate(dueAt.getUTCDate() - warningDays);
  const now = new Date();
  return now >= staleAt ? "stale" : now >= dueAt ? "due" : "fresh";
}

function renderAuthority(files: ContextFileRow[]): string {
  return files.map((file) =>
    `\n## Context file ${file.file_number}: ${file.file_name} (approved v${file.version})\n${compact(file.content_md, 3000)}`
  ).join("\n");
}

function renderMarketAuthority(authority: BrandStrategistAuthority): string {
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

function renderAvatarAuthority(authority: BrandStrategistAuthority): string {
  const release = authority.avatarRelease;
  const records = renderBrandStrategistModel(authority.avatarRecords);
  return `# ${release.title} (approved v${release.version})\n${release.summary}\n\n${compact(records, 24000)}`;
}

function renderCompetitorAuthority(authority: BrandStrategistAuthority): string {
  const release = authority.competitorRelease;
  const records = renderBrandStrategistModel(authority.competitorRecords);
  return `# ${release.title} (approved v${release.version})\n${release.summary}\n\n${compact(records, 24000)}`;
}

function renderAssociationAuthority(authority: BrandStrategistAuthority): string {
  const release = authority.associationRelease;
  const records = renderBrandStrategistModel(authority.associationRecords);
  return `# ${release.title} (approved v${release.version})\n${release.summary}\n\n${compact(records, 24000)}`;
}

function renderPreviousBrandStrategistOS(authority: BrandStrategistAuthority): string {
  const release = authority.previousBrandStrategistRelease;
  if (!release) return "";
  return `# ${release.title} (approved v${release.version})\n${release.summary}\n\n${compact(renderBrandStrategistModel(authority.previousBrandStrategistRecords), 24000)}`;
}

function renderBrandStrategistModel(records: Array<{ record_type: string; record_key: string; title: string; summary: string; payload: Record<string, unknown> }>): string {
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
    const strategicFields = [
      "record_kind", "recommendation_type", "priority", "rationale", "expected_impact",
      "dependencies", "risks", "trade_offs", "contradictions", "downstream_owner",
      "proposed_next_action", "validation_needed", "supporting_os_domains",
    ].flatMap((key) => {
      const value = record.payload?.[key];
      if (typeof value === "string" && value.trim()) return [`- ${key}: ${value}`];
      if (Array.isArray(value) && value.length > 0) return [`- ${key}: ${value.join("; ")}`];
      return [];
    }).join("\n");
    const payload = [details, strategicFields].filter(Boolean).join("\n");
    return `## ${record.title} [${record.record_type}/${record.record_key}]\n${record.summary}${payload ? `\n${payload}` : ""}`;
  }).join("\n\n");
}

async function loadBrandStrategistAuthority(sb: ServiceClient, clientId: string): Promise<
  | { ok: true; authority: BrandStrategistAuthority }
  | { ok: false; status: number; code: string; message: string; details?: Record<string, unknown> }
> {
  const [clientResult, contextResult, marketPointerResult, avatarPointerResult, competitorPointerResult, associationPointerResult, brandStrategistPointerResult, policiesResult] = await Promise.all([
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
    sb.from("client_intelligence_active_releases")
      .select("release_id").eq("client_id", clientId).eq("intelligence_domain", "association_os").maybeSingle(),
    sb.from("client_intelligence_active_releases")
      .select("release_id").eq("client_id", clientId).eq("intelligence_domain", "brand_strategist").maybeSingle(),
    sb.from("client_intelligence_refresh_policies")
      .select("intelligence_domain,refresh_interval_days,due_warning_days")
      .eq("client_id", clientId)
      .in("intelligence_domain", ["market_os", "avatar_os", "competitor_os", "association_os"]),
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
      message: "Brand Strategist requires an active approved Market OS release.",
    };
  }
  if (avatarPointerResult.error || !avatarPointerResult.data?.release_id) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_OS_REQUIRED",
      message: "Brand Strategist requires an active approved Avatar OS release.",
    };
  }
  if (competitorPointerResult.error || !competitorPointerResult.data?.release_id) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_COMPETITOR_OS_REQUIRED",
      message: "Brand Strategist requires an active approved Competitor OS release.",
    };
  }
  if (associationPointerResult.error || !associationPointerResult.data?.release_id) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_ASSOCIATION_OS_REQUIRED",
      message: "Brand Strategist requires an active approved Association OS release.",
    };
  }
  if (policiesResult.error) {
    return { ok: false, status: 500, code: "UPSTREAM_REFRESH_POLICY_QUERY_FAILED", message: policiesResult.error.message };
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
      message: "Brand Strategist requires all 21 approved, non-empty Context Files.",
      details: { stage1_status: clientResult.data.stage1_status, approved: approved.length, missing_file_numbers: [...expected] },
    };
  }
  const [marketReleaseResult, marketRecordsResult, avatarReleaseResult, avatarRecordsResult, competitorReleaseResult, competitorRecordsResult, associationReleaseResult, associationRecordsResult] = await Promise.all([
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
    sb.from("client_intelligence_releases")
      .select("id,version,title,summary,content,approved_at")
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
    sb.from("client_intelligence_releases")
      .select("id,version,title,summary,content,approved_at")
      .eq("id", associationPointerResult.data.release_id)
      .eq("client_id", clientId)
      .eq("intelligence_domain", "association_os")
      .eq("status", "approved")
      .maybeSingle(),
    sb.from("client_intelligence_records")
      .select("created_at,record_type,record_key,title,summary,payload")
      .eq("client_id", clientId)
      .eq("release_id", associationPointerResult.data.release_id)
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
  if (competitorReleaseResult.error || !competitorReleaseResult.data?.approved_at) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_COMPETITOR_OS_REQUIRED",
      message: "The active Competitor OS pointer does not reference an approved release.",
    };
  }
  if (competitorRecordsResult.error || (competitorRecordsResult.data ?? []).length === 0) {
    return {
      ok: false,
      status: 409,
      code: "COMPETITOR_OS_RECORDS_REQUIRED",
      message: "The active Competitor OS release has no structured competitive records.",
    };
  }
  if (associationReleaseResult.error || !associationReleaseResult.data?.approved_at) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_ASSOCIATION_OS_REQUIRED",
      message: "The active Association OS pointer does not reference an approved release.",
    };
  }
  if (associationRecordsResult.error || (associationRecordsResult.data ?? []).length === 0) {
    return {
      ok: false,
      status: 409,
      code: "ASSOCIATION_OS_RECORDS_REQUIRED",
      message: "The active Association OS release has no structured association records.",
    };
  }

  const policyByDomain = new Map((policiesResult.data ?? []).map((policy) => [policy.intelligence_domain, policy]));
  const upstream = [
    { domain: "market_os", release: marketReleaseResult.data },
    { domain: "avatar_os", release: avatarReleaseResult.data },
    { domain: "competitor_os", release: competitorReleaseResult.data },
    { domain: "association_os", release: associationReleaseResult.data },
  ];
  const missingPolicies = upstream.filter(({ domain }) => !policyByDomain.has(domain)).map(({ domain }) => domain);
  if (missingPolicies.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "UPSTREAM_REFRESH_POLICY_REQUIRED",
      message: "Brand Strategist cannot calculate authority readiness because an upstream refresh policy is missing.",
      details: { missing_policy_domains: missingPolicies },
    };
  }
  const domains = upstream.map(({ domain, release }) => {
    const policy = policyByDomain.get(domain)!;
    return {
      domain,
      freshness: freshnessFor(release.approved_at, policy.refresh_interval_days, policy.due_warning_days),
      release_id: release.id,
      version: release.version,
      contradiction_count: contradictionCount(release.content ?? {}),
    };
  });
  const staleDomains = domains.filter((domain) => domain.freshness === "stale").map((domain) => domain.domain);
  if (staleDomains.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "STALE_UPSTREAM_AUTHORITY",
      message: "Brand Strategist requires refreshed upstream authority before producing recommendations.",
      details: { stale_domains: staleDomains },
    };
  }
  const readinessWarnings = [
    ...domains.filter((domain) => domain.freshness === "due").map((domain) => `${domain.domain} is due for review.`),
    ...domains.filter((domain) => domain.contradiction_count > 0).map((domain) => `${domain.domain} contains ${domain.contradiction_count} disclosed contradiction(s).`),
  ];

  let previousBrandStrategistRelease: BrandStrategistAuthority["previousBrandStrategistRelease"] = null;
  let previousBrandStrategistRecords: BrandStrategistAuthority["previousBrandStrategistRecords"] = [];
  if (brandStrategistPointerResult.error) {
    return { ok: false, status: 500, code: "BRAND_STRATEGIST_POINTER_QUERY_FAILED", message: brandStrategistPointerResult.error.message };
  }
  if (brandStrategistPointerResult.data?.release_id) {
    const [previousReleaseResult, previousRecordsResult] = await Promise.all([
      sb.from("client_intelligence_releases")
        .select("id,version,title,summary,approved_at")
        .eq("id", brandStrategistPointerResult.data.release_id)
        .eq("client_id", clientId)
        .eq("intelligence_domain", "brand_strategist")
        .eq("status", "approved")
        .maybeSingle(),
      sb.from("client_intelligence_records")
        .select("created_at,record_type,record_key,title,summary,payload")
        .eq("client_id", clientId)
        .eq("release_id", brandStrategistPointerResult.data.release_id)
        .order("display_order"),
    ]);
    if (previousReleaseResult.error || !previousReleaseResult.data?.approved_at || previousRecordsResult.error) {
      return { ok: false, status: 409, code: "ACTIVE_BRAND_STRATEGIST_OS_INVALID", message: "The active Brand Strategist release cannot be used as refresh history." };
    }
    previousBrandStrategistRelease = previousReleaseResult.data;
    previousBrandStrategistRecords = previousRecordsResult.data ?? [];
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
      competitorRelease: competitorReleaseResult.data,
      competitorRecords: competitorRecordsResult.data ?? [],
      associationRelease: associationReleaseResult.data,
      associationRecords: associationRecordsResult.data ?? [],
      readiness: {
        status: readinessWarnings.length > 0 ? "degraded" : "ready",
        warnings: readinessWarnings,
        domains: domains.map((domain) => ({
          domain: domain.domain,
          freshness: domain.freshness as "fresh" | "due",
          release_id: domain.release_id,
          version: domain.version,
        })),
      },
      previousBrandStrategistRelease,
      previousBrandStrategistRecords,
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

async function ensureBrandStrategistFollowupSteps(
  sb: ServiceClient,
  clientId: string,
  researchRunId: string,
) {
  const modules = BRAND_STRATEGIST_MODULES.slice(1);
  const { data: existing, error: existingError } = await sb.from("client_research_steps")
    .select("step_key").eq("research_run_id", researchRunId);
  if (existingError) throw new Error(existingError.message);
  const existingKeys = new Set((existing ?? []).map((step) => step.step_key));
  const rows = modules.filter((module) => !existingKeys.has(module.key)).map((module) => ({
    client_id: clientId,
    research_run_id: researchRunId,
    step_key: module.key,
    step_order: BRAND_STRATEGIST_MODULES.findIndex((candidate) => candidate.key === module.key) + 1,
    title: module.title,
  }));
  if (rows.length === 0) return;
  const { error } = await sb.from("client_research_steps").insert(rows);
  if (error) throw new Error(error.message);
}

async function prepare(sb: ServiceClient, clientId: string, userId: string) {
  const authorityResult = await loadBrandStrategistAuthority(sb, clientId);
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
    competitor_os: {
      release_id: authority.competitorRelease.id,
      version: authority.competitorRelease.version,
      approved_at: authority.competitorRelease.approved_at,
    },
    association_os: {
      release_id: authority.associationRelease.id,
      version: authority.associationRelease.version,
      approved_at: authority.associationRelease.approved_at,
    },
    readiness: authority.readiness,
    previous_brand_strategist: authority.previousBrandStrategistRelease ? {
      release_id: authority.previousBrandStrategistRelease.id,
      version: authority.previousBrandStrategistRelease.version,
      approved_at: authority.previousBrandStrategistRelease.approved_at,
    } : null,
  };
  const authorityHash = await sha256(JSON.stringify(authoritySnapshot));

  const { data: openRuns, error: openRunError } = await sb.from("client_research_runs")
    .select("*").eq("client_id", clientId).eq("intelligence_domain", "brand_strategist")
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
      message: "Resuming the existing Brand Strategist build.",
      research_run_id: run.id,
      release_id: release.id,
      steps: steps ?? [],
    });
  }

  const { data: latestRelease, error: versionError } = await sb.from("client_intelligence_releases")
    .select("version").eq("client_id", clientId).eq("intelligence_domain", "brand_strategist")
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (versionError) return json({ ok: false, mode: "blocked", message: versionError.message }, 500);
  const version = (latestRelease?.version ?? 0) + 1;
  const model = (Deno.env.get("OPENAI_BRAND_STRATEGIST_MODEL") ?? "gpt-5.6-terra").trim();
  const timeBucket = Math.floor(Date.now() / 600_000);
  const idempotencyKey = `brand_strategist:${authorityHash.slice(0, 40)}:v${version}:${timeBucket}`;

  const { data: run, error: runError } = await sb.from("client_research_runs").insert({
    client_id: clientId,
    research_domain: "brand_strategist",
    intelligence_domain: "brand_strategist",
    status: "queued",
    idempotency_key: idempotencyKey,
    provider: "openai",
    model,
    prompt_digest: authorityHash,
    configuration_snapshot: {
      authority: authoritySnapshot,
      authority_hash: authorityHash,
      module_manifest: BRAND_STRATEGIST_MODULES,
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
        return json({ ok: true, mode: "resumed", message: "Resuming the existing Brand Strategist build.", research_run_id: duplicate.id, release_id: release?.id, steps: steps ?? [] });
      }
    }
    return json({ ok: false, mode: "blocked", message: runError.message }, 500);
  }

  const { data: release, error: releaseError } = await sb.from("client_intelligence_releases").insert({
    client_id: clientId,
    intelligence_domain: "brand_strategist",
    version,
    status: "draft",
    research_run_id: run.id,
    title: `Brand Strategist v${version}`,
    authority_snapshot: { ...authoritySnapshot, authority_hash: authorityHash },
    created_by: userId,
  }).select("*").single();
  if (releaseError) {
    await sb.from("client_research_runs").update({ status: "failed", failure_code: "RELEASE_CREATE_FAILED", failure_message: releaseError.message, retryable: false }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
  }

  const stepRows = BRAND_STRATEGIST_MODULES.slice(0, 1).map((module) => ({
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
    intelligence_domain: "brand_strategist",
    refresh_interval_days: 90,
    due_warning_days: 14,
    scheduled_refresh_enabled: false,
    policy_reason: "Strategic recommendations must be refreshed whenever material upstream authority changes, with a 90-day review backstop; dependency monitoring is completed in operationalization.",
    updated_by: userId,
  }, { onConflict: "client_id,intelligence_domain" });
  await audit(sb, "brand_strategist.prepared", "client_intelligence_releases", release.id, {
    client_id: clientId, research_run_id: run.id, version, authority_hash: authorityHash,
  });
  return json({
    ok: true,
    mode: "prepared",
    message: "Brand Strategist synthesis workflow prepared.",
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
  authority: BrandStrategistAuthority;
  result: Awaited<ReturnType<typeof runOpenAiBrandStrategistSynthesis>>;
}) {
  const { sb, clientId, runId, releaseId, step, authority, result } = input;
  await cleanupStepArtifacts(sb, clientId, releaseId, step.id, step.step_key);
  const contextByNumber = new Map(authority.files.map((file) => [file.file_number, file]));
  const marketByKey = new Map(authority.marketRecords.map((record) => [record.record_key, record]));
  const avatarByKey = new Map(authority.avatarRecords.map((record) => [record.record_key, record]));
  const competitorByKey = new Map(authority.competitorRecords.map((record) => [record.record_key, record]));
  const associationByKey = new Map(authority.associationRecords.map((record) => [record.record_key, record]));
  const previousByIdentity = new Map(authority.previousBrandStrategistRecords.flatMap((record) => {
    const identity = typeof record.payload?.strategy_identity === "string" ? record.payload.strategy_identity : null;
    return identity ? [[identity, record] as const] : [];
  }));
  const { data: currentReleaseRecords, error: currentReleaseRecordsError } = await sb.from("client_intelligence_records")
    .select("payload").eq("client_id", clientId).eq("release_id", releaseId);
  if (currentReleaseRecordsError) throw new Error(currentReleaseRecordsError.message);
  const seenStrategyIdentities = new Set((currentReleaseRecords ?? []).flatMap((record) =>
    typeof record.payload?.strategy_identity === "string" ? [record.payload.strategy_identity] : []
  ));
  const recordRows: Array<Record<string, unknown>> = [];
  let findingCount = 0;

  for (const [recordIndex, record] of result.output.records.entries()) {
    if (step.step_key === "cross_os_synthesis" && record.record_kind === "recommendation") {
      throw new Error("Brand Strategist returned an invalid identity: synthesis cannot emit recommendation records.");
    }
    if (step.step_key !== "cross_os_synthesis" && record.record_kind !== "recommendation") {
      throw new Error("Brand Strategist returned an invalid identity: recommendation modules may emit recommendation records only.");
    }
    const unsupportedBuyerRoles = record.buyer_role_keys.filter((key) => !avatarByKey.has(key));
    const unsupportedMarketConditions = record.market_condition_keys.filter((key) => !marketByKey.has(key));
    if (unsupportedBuyerRoles.length > 0 || unsupportedMarketConditions.length > 0) {
      throw new Error(`Brand Strategist returned unsupported traceability keys: ${[...unsupportedBuyerRoles, ...unsupportedMarketConditions].join(", ")}`);
    }
    if (record.findings.length === 0) throw new Error("Brand Strategist returned unsupported traceability: every record requires a supporting finding.");
    const recordFindingIds: string[] = [];
    const supportedOsDomains = new Set<string>();
    let assertedFindingCount = 0;
    for (const providerFinding of record.findings) {
      const matchedContext = providerFinding.context_file_numbers
        .map((fileNumber) => contextByNumber.get(fileNumber))
        .filter((file): file is ContextFileRow => Boolean(file));
      const matchedMarketRecords = providerFinding.market_record_keys
        .map((recordKey) => marketByKey.get(recordKey))
        .filter((record): record is BrandStrategistAuthority["marketRecords"][number] => Boolean(record));
      const matchedAvatarRecords = providerFinding.avatar_record_keys
        .map((recordKey) => avatarByKey.get(recordKey))
        .filter((record): record is BrandStrategistAuthority["avatarRecords"][number] => Boolean(record));
      const matchedCompetitorRecords = providerFinding.competitor_record_keys
        .map((recordKey) => competitorByKey.get(recordKey))
        .filter((record): record is BrandStrategistAuthority["competitorRecords"][number] => Boolean(record));
      const matchedAssociationRecords = providerFinding.association_record_keys
        .map((recordKey) => associationByKey.get(recordKey))
        .filter((record): record is BrandStrategistAuthority["associationRecords"][number] => Boolean(record));
      if (matchedMarketRecords.length > 0) supportedOsDomains.add("market_os");
      if (matchedAvatarRecords.length > 0) supportedOsDomains.add("avatar_os");
      if (matchedCompetitorRecords.length > 0) supportedOsDomains.add("competitor_os");
      if (matchedAssociationRecords.length > 0) supportedOsDomains.add("association_os");
      const hasEvidence = matchedContext.length > 0 || matchedMarketRecords.length > 0 || matchedAvatarRecords.length > 0 || matchedCompetitorRecords.length > 0 || matchedAssociationRecords.length > 0;
      const normalised = normaliseFinding(providerFinding, hasEvidence);
      if (normalised.disposition === "asserted") assertedFindingCount += 1;
      const { data: finding, error: findingError } = await sb.from("client_intelligence_findings").insert({
        client_id: clientId,
        intelligence_domain: "brand_strategist",
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
          requested_context_file_numbers: providerFinding.context_file_numbers,
          requested_market_record_keys: providerFinding.market_record_keys,
          requested_avatar_record_keys: providerFinding.avatar_record_keys,
          requested_competitor_record_keys: providerFinding.competitor_record_keys,
          requested_association_record_keys: providerFinding.association_record_keys,
        },
        created_by: "openai_brand_strategist_synthesis",
      }).select("id").single();
      if (findingError) throw new Error(findingError.message);
      recordFindingIds.push(finding.id);
      findingCount += 1;

      const { error: releaseLinkError } = await sb.from("client_intelligence_release_findings").insert({
        client_id: clientId, release_id: releaseId, finding_id: finding.id,
      });
      if (releaseLinkError) throw new Error(releaseLinkError.message);

      const evidenceRows = [
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
            finding_ids: Array.isArray(record.payload?.finding_ids) ? record.payload.finding_ids : [],
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
            finding_ids: Array.isArray(record.payload?.finding_ids) ? record.payload.finding_ids : [],
          },
          observed_at: result.retrievedAt,
          source_quality: "authoritative",
          inspectable: true,
          metadata: { research_step_id: step.id, module_key: step.step_key, provider_request_id: result.providerRequestId },
        })),
        ...matchedCompetitorRecords.map((record) => ({
          client_id: clientId,
          research_run_id: runId,
          source_type: "structured_observation",
          evidence_kind: "structured_observation",
          evidence_text: compact(`${record.title}: ${record.summary}`, 30000),
          locator: {
            upstream_domain: "competitor_os",
            release_id: authority.competitorRelease.id,
            release_version: authority.competitorRelease.version,
            record_key: record.record_key,
            finding_ids: Array.isArray(record.payload?.finding_ids) ? record.payload.finding_ids : [],
          },
          observed_at: result.retrievedAt,
          source_quality: "authoritative",
          inspectable: true,
          metadata: { research_step_id: step.id, module_key: step.step_key, provider_request_id: result.providerRequestId },
        })),
        ...matchedAssociationRecords.map((record) => ({
          client_id: clientId,
          research_run_id: runId,
          source_type: "structured_observation",
          evidence_kind: "structured_observation",
          evidence_text: compact(`${record.title}: ${record.summary}`, 30000),
          locator: {
            upstream_domain: "association_os",
            release_id: authority.associationRelease.id,
            release_version: authority.associationRelease.version,
            record_key: record.record_key,
            finding_ids: Array.isArray(record.payload?.finding_ids) ? record.payload.finding_ids : [],
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
    if (assertedFindingCount === 0) throw new Error("Brand Strategist returned unsupported traceability: every record requires asserted upstream support.");
    if (record.record_kind === "recommendation" && supportedOsDomains.size < 2) {
      throw new Error("Brand Strategist returned unsupported traceability: every recommendation requires support from at least two approved OS domains.");
    }
    const identity = strategyIdentity(record);
    if (seenStrategyIdentities.has(identity)) throw new Error(`Brand Strategist returned a duplicate strategy identity: ${identity}`);
    seenStrategyIdentities.add(identity);
    const fingerprint = await sha256(JSON.stringify({
      title: record.title,
      statement: record.statement,
      rationale: record.rationale,
      expected_impact: record.expected_impact,
      dependencies: record.dependencies,
      risks: record.risks,
      trade_offs: record.trade_offs,
      contradictions: record.contradictions,
      findings: record.findings.map((finding) => ({ claim: finding.claim, disposition: finding.disposition })),
    }));
    const previous = previousByIdentity.get(identity);
    const previousFingerprint = typeof previous?.payload?.strategy_fingerprint === "string"
      ? previous.payload.strategy_fingerprint
      : null;
    const changeStatus = !previous ? "new" : previousFingerprint === fingerprint ? "unchanged" : "changed";
    const firstSeenAt = typeof previous?.payload?.first_seen_at === "string"
      ? previous.payload.first_seen_at
      : previous?.created_at ?? result.retrievedAt;
    const stableRecordKey = `${identityPart(record.record_kind).slice(0, 50)}__${identityPart(record.record_key).slice(0, 100)}`;
    recordRows.push({
      client_id: clientId,
      release_id: releaseId,
      record_type: step.step_key,
      record_key: stableRecordKey,
      title: compact(record.title, 500),
      summary: compact(record.statement, 5000),
      payload: {
        finding_ids: recordFindingIds,
        module_key: step.step_key,
        record_kind: record.record_kind,
        recommendation_type: record.recommendation_type,
        priority: record.priority,
        statement: record.statement,
        rationale: record.rationale,
        expected_impact: record.expected_impact,
        dependencies: record.dependencies,
        risks: record.risks,
        trade_offs: record.trade_offs,
        contradictions: record.contradictions,
        buyer_role_keys: record.buyer_role_keys,
        market_condition_keys: record.market_condition_keys,
        downstream_owner: record.downstream_owner,
        proposed_next_action: record.proposed_next_action,
        validation_needed: record.validation_needed,
        supporting_os_domains: [...supportedOsDomains],
        strategy_identity: identity,
        strategy_fingerprint: fingerprint,
        previous_strategy_fingerprint: previousFingerprint,
        change_status: changeStatus,
        first_seen_at: firstSeenAt,
        generated_at: result.retrievedAt,
        previous_release_id: previous ? authority.previousBrandStrategistRelease?.id ?? null : null,
      },
      display_order: (step.step_order * 100) + recordIndex,
    });
  }
  if (recordRows.length === 0) throw new Error("Brand Strategist module returned no structured domain records.");
  const { error: recordError } = await sb.from("client_intelligence_records").insert(recordRows);
  if (recordError) throw new Error(recordError.message);

  const { data: receipt, error: receiptError } = await sb.from("client_provider_operation_receipts").insert({
    client_id: clientId,
    research_run_id: runId,
    research_step_id: step.id,
    capability: "evidence_bound_strategic_synthesis",
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
    tool_calls: 0,
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

function normaliseFinding(finding: BrandStrategistFinding, hasEvidence: boolean): BrandStrategistFinding {
  if (finding.disposition !== "asserted") return { ...finding, confidence: null };
  if (!hasEvidence) {
    return {
      ...finding,
      disposition: "unknown",
      confidence: null,
      rationale: `${finding.rationale} No inspectable source or approved upstream authority matched this claim, so it was stored as unknown.`,
    };
  }
  return { ...finding, confidence: finding.confidence ?? "weakly_inferred" };
}

async function runStep(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data: run, error: runError } = await sb.from("client_research_runs")
    .select("*").eq("id", researchRunId).eq("client_id", clientId).eq("intelligence_domain", "brand_strategist").maybeSingle();
  if (runError || !run) return json({ ok: false, terminal: true, message: runError?.message ?? "Brand Strategist research run not found." }, 404);
  if (run.status === "completed" || run.status === "completed_partial" || run.status === "cancelled") {
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: true, terminal: true, message: "Brand Strategist research is already terminal.", research_run_id: researchRunId, progress });
  }
  const { data: release, error: releaseError } = await sb.from("client_intelligence_releases")
    .select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).eq("status", "draft").maybeSingle();
  if (releaseError || !release) return json({ ok: false, terminal: true, message: releaseError?.message ?? "Draft Brand Strategist release not found." }, 409);

  const leaseOwner = `brand_strategist-os:${crypto.randomUUID()}`;
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
      message: progress.terminal ? "No recoverable Brand Strategist steps remain." : "Another worker currently owns the next Brand Strategist step.",
      research_run_id: researchRunId,
      release_id: release.id,
      progress,
    });
  }
  const step = claimed as ResearchStepRow;
  await sb.from("client_research_runs").update({
    status: "running", started_at: run.started_at ?? new Date().toISOString(), retryable: false, failure_code: null, failure_message: null,
  }).eq("id", researchRunId);

  const authorityResult = await loadBrandStrategistAuthority(sb, clientId);
  if (!authorityResult.ok) {
    await sb.from("client_research_steps").update({ status: "failed", failure_code: authorityResult.code, failure_message: authorityResult.message, lease_owner: null, lease_expires_at: null }).eq("id", step.id);
    await sb.from("client_research_runs").update({ status: "failed", failure_code: authorityResult.code, failure_message: authorityResult.message, retryable: false }).eq("id", researchRunId);
    return json({ ok: false, terminal: true, message: authorityResult.message, research_run_id: researchRunId, release_id: release.id, progress: await stepProgress(sb, researchRunId) }, authorityResult.status);
  }
  const expectedAuthority = release.authority_snapshot?.context as Array<{ id: string; version: number }> | undefined;
  const expectedMarketAuthority = release.authority_snapshot?.market_os as { release_id?: string; version?: number } | undefined;
  const expectedAvatarAuthority = release.authority_snapshot?.avatar_os as { release_id?: string; version?: number } | undefined;
  const expectedCompetitorAuthority = release.authority_snapshot?.competitor_os as { release_id?: string; version?: number } | undefined;
  const expectedAssociationAuthority = release.authority_snapshot?.association_os as { release_id?: string; version?: number } | undefined;
  const expectedPreviousBrandStrategistAuthority = release.authority_snapshot?.previous_brand_strategist as { release_id?: string; version?: number } | null | undefined;
  const currentById = new Map(authorityResult.authority.files.map((file) => [file.id, file.version]));
  const authorityChanged = !expectedAuthority ||
    expectedAuthority.some((file) => currentById.get(file.id) !== file.version) ||
    !expectedMarketAuthority ||
    expectedMarketAuthority.release_id !== authorityResult.authority.marketRelease.id ||
    expectedMarketAuthority.version !== authorityResult.authority.marketRelease.version ||
    !expectedAvatarAuthority ||
    expectedAvatarAuthority.release_id !== authorityResult.authority.avatarRelease.id ||
    expectedAvatarAuthority.version !== authorityResult.authority.avatarRelease.version ||
    !expectedCompetitorAuthority ||
    expectedCompetitorAuthority.release_id !== authorityResult.authority.competitorRelease.id ||
    expectedCompetitorAuthority.version !== authorityResult.authority.competitorRelease.version ||
    !expectedAssociationAuthority ||
    expectedAssociationAuthority.release_id !== authorityResult.authority.associationRelease.id ||
    expectedAssociationAuthority.version !== authorityResult.authority.associationRelease.version ||
    (expectedPreviousBrandStrategistAuthority?.release_id ?? null) !== (authorityResult.authority.previousBrandStrategistRelease?.id ?? null) ||
    (expectedPreviousBrandStrategistAuthority?.version ?? null) !== (authorityResult.authority.previousBrandStrategistRelease?.version ?? null);
  if (authorityChanged) {
    const message = "Approved Context or an active upstream OS changed after this Brand Strategist run began. Start a new run from the new authority.";
    await sb.from("client_research_steps").update({ status: "failed", attempt_count: step.maximum_attempts, failure_code: "AUTHORITY_CHANGED", failure_message: message, lease_owner: null, lease_expires_at: null }).eq("id", step.id);
    await sb.from("client_research_runs").update({ status: "failed", failure_code: "AUTHORITY_CHANGED", failure_message: message, retryable: false }).eq("id", researchRunId);
    return json({ ok: false, terminal: true, message, research_run_id: researchRunId, release_id: release.id, progress: await stepProgress(sb, researchRunId) }, 409);
  }
  const module = BRAND_STRATEGIST_MODULES.find((candidate) => candidate.key === step.step_key);
  if (!module) return json({ ok: false, terminal: true, message: `Unknown Brand Strategist step ${step.step_key}.` }, 500);

  try {
    const { data: existingRecords, error: existingRecordsError } = await sb.from("client_intelligence_records")
      .select("record_type,record_key,title,summary,payload")
      .eq("client_id", clientId)
      .eq("release_id", release.id)
      .order("display_order");
    if (existingRecordsError) throw new Error(existingRecordsError.message);
    const providerResult = await runOpenAiBrandStrategistSynthesis({
      module,
      clientName: authorityResult.authority.client.name,
      approvedContext: renderAuthority(authorityResult.authority.files),
      approvedMarketOS: renderMarketAuthority(authorityResult.authority),
      approvedAvatarOS: renderAvatarAuthority(authorityResult.authority),
      approvedCompetitorOS: renderCompetitorAuthority(authorityResult.authority),
      approvedAssociationOS: renderAssociationAuthority(authorityResult.authority),
      authorityReadiness: JSON.stringify(authorityResult.authority.readiness, null, 2),
      existingStrategy: compact(renderBrandStrategistModel(existingRecords ?? []), 24000),
      previousActiveStrategy: renderPreviousBrandStrategistOS(authorityResult.authority),
      model: run.model ?? undefined,
    });
    if (step.step_key === "cross_os_synthesis") {
      await ensureBrandStrategistFollowupSteps(sb, clientId, researchRunId);
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
      capability: "evidence_bound_strategic_synthesis",
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
  if (error || !runResult.data || !releaseResult.data) return json({ ok: false, message: error?.message ?? "Brand Strategist run or release not found." }, 404);
  const run = runResult.data;
  const release = releaseResult.data;
  if (release.status === "needs_review" || release.status === "approved") {
    return json({ ok: true, message: "Brand Strategist release is already finalised.", release, run });
  }
  const steps = (stepsResult.data ?? []) as ResearchStepRow[];
  const progress = await stepProgress(sb, researchRunId);
  if (!progress.terminal || progress.completed === 0) {
    return json({ ok: false, message: "Brand Strategist cannot be finalised while recoverable research remains or no module completed.", progress }, 409);
  }
  const records = (recordsResult.data ?? []).filter((record) => record.release_id === release.id);
  const findingIds = (findingsResult.data ?? []).filter((link) => link.release_id === release.id).map((link) => link.finding_id);
  if (records.length === 0) return json({ ok: false, message: "Brand Strategist has no structured domain records." }, 409);
  const recommendationCount = records.filter((record) => record.payload?.record_kind === "recommendation").length;
  if (recommendationCount === 0) {
    return json({ ok: false, message: "Brand Strategist has no evidence-backed recommendation records." }, 409);
  }
  const recordKindCounts = records.reduce<Record<string, number>>((counts, record) => {
    const kind = typeof record.payload?.record_kind === "string" ? record.payload.record_kind : "unclassified";
    counts[kind] = (counts[kind] ?? 0) + 1;
    return counts;
  }, {});
  const recommendationTypeCounts = records.reduce<Record<string, number>>((counts, record) => {
    const type = typeof record.payload?.recommendation_type === "string" ? record.payload.recommendation_type : "unclassified";
    counts[type] = (counts[type] ?? 0) + 1;
    return counts;
  }, {});
  const priorityCounts = records.reduce<Record<string, number>>((counts, record) => {
    const priority = typeof record.payload?.priority === "string" ? record.payload.priority : "unclassified";
    counts[priority] = (counts[priority] ?? 0) + 1;
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
      intelligence_domain: "brand_strategist",
      modules: summaries,
      record_count: records.length,
      finding_count: findingIds.length,
      source_count: sourceCountResult.count ?? 0,
      completed_modules: progress.completed,
      failed_modules: progress.failed,
      readiness: release.authority_snapshot?.readiness ?? null,
      recommendation_count: recommendationCount,
      record_kind_counts: recordKindCounts,
      recommendation_type_counts: recommendationTypeCounts,
      priority_counts: priorityCounts,
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
    failure_message: progress.failed > 0 ? `${progress.failed} Brand Strategist module(s) did not complete.` : null,
  }).eq("id", run.id).select("*").single();
  if (updateRunError) return json({ ok: false, message: updateRunError.message }, 500);
  await audit(sb, "brand_strategist.submitted_for_review", "client_intelligence_releases", release.id, {
    client_id: clientId,
    research_run_id: run.id,
    version: release.version,
    completed_modules: progress.completed,
    failed_modules: progress.failed,
  });
  return json({ ok: true, message: "Brand Strategist is ready for human review.", release: updatedRelease, run: updatedRun });
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
