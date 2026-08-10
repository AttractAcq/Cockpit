import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { EXECUTION_FILE_COUNT, EXECUTION_FILE_MANIFEST } from "./execution-manifest.ts";

export const APPROVED_CONTEXT_FILE_COUNT = 21;

export const INTELLIGENCE_DOMAINS = [
  "market_os",
  "avatar_os",
  "competitor_os",
  "association_os",
  "brand_strategist",
] as const;

export type IntelligenceDomain = typeof INTELLIGENCE_DOMAINS[number];

// Phase 1 currently persists its client-specific strategic systems in
// client_context_files. Keep their logical authority class distinct even while
// they share that physical table with business-context documents.
export const STRATEGIC_PLAYBOOK_CONTEXT_FILES = [
  { file_number: 6, file_name: "06_Positioning_And_Angle_Map.md" },
  { file_number: 8, file_name: "08_Profile_Funnel_Context.md" },
  { file_number: 9, file_name: "09_Content_System.md" },
  { file_number: 10, file_name: "10_Story_System.md" },
  { file_number: 11, file_name: "11_Ad_System.md" },
  { file_number: 12, file_name: "12_Website_And_Landing_Page_Context.md" },
  { file_number: 13, file_name: "13_Distribution_System.md" },
  { file_number: 14, file_name: "14_Automation_And_AI_Instructions.md" },
  { file_number: 19, file_name: "19_Sales_Enablement_Assets.md" },
  { file_number: 20, file_name: "20_Retention_Upsell_And_Expansion_Context.md" },
] as const;

const STRATEGIC_PLAYBOOK_FILE_NUMBERS = new Set<number>(
  STRATEGIC_PLAYBOOK_CONTEXT_FILES.map((file) => file.file_number),
);

export interface ApprovedContextFile {
  id: string;
  file_number: number;
  file_name: string;
  content_md: string;
  status: "approved";
  version: number;
}

export interface ApprovedStrategicPlaybook extends ApprovedContextFile {
  authority_class: "approved_strategic_playbook";
  storage_table: "client_context_files";
}

export interface ApprovedExecutionFile {
  id: string;
  month: string;
  file_number: number;
  file_name: string;
  content_md: string;
  review_state: "approved";
  version: number;
}

export interface ApprovedIntelligenceRecord {
  id: string;
  release_id: string;
  record_type: string;
  record_key: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  display_order: number;
}

export interface ApprovedIntelligenceRelease {
  id: string;
  intelligence_domain: IntelligenceDomain;
  version: number;
  title: string;
  summary: string;
  content: Record<string, unknown>;
  authority_snapshot: Record<string, unknown>;
  approved_at: string;
  freshness: "fresh" | "due";
  records: ApprovedIntelligenceRecord[];
}

export interface ApprovedClientAuthority {
  client: {
    id: string;
    name: string;
    package_tier: string;
    stage1_status: string;
    stage2_status: string;
  };
  allContextFiles: ApprovedContextFile[];
  contextFiles: ApprovedContextFile[];
  strategicPlaybooks: ApprovedStrategicPlaybook[];
  executionFilesByMonth: Map<string, ApprovedExecutionFile[]>;
  intelligenceReleases: ApprovedIntelligenceRelease[];
}

export type AuthorityLoadResult =
  | { ok: true; authority: ApprovedClientAuthority }
  | {
    ok: false;
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function intelligenceFreshness(
  approvedAt: string,
  refreshIntervalDays: number,
  dueWarningDays: number,
  now = new Date(),
): "fresh" | "due" | "stale" {
  const staleAt = new Date(approvedAt);
  staleAt.setUTCDate(staleAt.getUTCDate() + refreshIntervalDays);
  const dueAt = new Date(staleAt);
  dueAt.setUTCDate(dueAt.getUTCDate() - dueWarningDays);
  return now >= staleAt ? "stale" : now >= dueAt ? "due" : "fresh";
}

function snapshotReleaseId(snapshot: Record<string, unknown>, domain: IntelligenceDomain): string | null {
  const value = snapshot[domain];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const releaseId = (value as { release_id?: unknown }).release_id;
  return typeof releaseId === "string" ? releaseId : null;
}

export function contextAuthorityReadiness(
  stage1Status: string,
  files: Array<{ file_number: number; content_md: string | null; status: string }>,
) {
  const approved = files.filter((file) => file.status === "approved");
  const numbers = new Set(approved.map((file) => file.file_number));
  const missingFileNumbers = Array.from({ length: APPROVED_CONTEXT_FILE_COUNT }, (_, number) => number)
    .filter((number) => !numbers.has(number));
  const emptyFileNumbers = approved.filter((file) => !nonEmpty(file.content_md)).map((file) => file.file_number);
  return {
    ready: stage1Status === "complete" &&
      approved.length === APPROVED_CONTEXT_FILE_COUNT &&
      missingFileNumbers.length === 0 &&
      emptyFileNumbers.length === 0,
    approved: approved.length,
    missingFileNumbers,
    emptyFileNumbers,
  };
}

export function classifyApprovedPhase1Authority(files: ApprovedContextFile[]): {
  contextFiles: ApprovedContextFile[];
  strategicPlaybooks: ApprovedStrategicPlaybook[];
} {
  const strategicPlaybooks = files
    .filter((file) => STRATEGIC_PLAYBOOK_FILE_NUMBERS.has(file.file_number))
    .map((file) => ({
      ...file,
      authority_class: "approved_strategic_playbook" as const,
      storage_table: "client_context_files" as const,
    }));
  const contextFiles = files.filter((file) => !STRATEGIC_PLAYBOOK_FILE_NUMBERS.has(file.file_number));
  return { contextFiles, strategicPlaybooks };
}

export function executionAuthorityReadiness(
  stage2Status: string,
  month: string,
  files: Array<{
    month: string;
    file_number: number | null;
    file_name: string;
    content_md: string | null;
    review_state: string;
  }>,
) {
  const approved = files.filter((file) => file.month === month && file.review_state === "approved");
  const missing = EXECUTION_FILE_MANIFEST.filter((definition) => !approved.some((file) =>
    file.file_number === definition.fileNumber && file.file_name === definition.fileName
  ));
  const empty = approved.filter((file) => !nonEmpty(file.content_md)).map((file) => file.file_name);
  return {
    ready: stage2Status === "complete" &&
      approved.length === EXECUTION_FILE_COUNT &&
      missing.length === 0 &&
      empty.length === 0,
    approved,
    missingCodes: missing.map((definition) => definition.code),
    empty,
  };
}

export async function loadApprovedClientAuthority(
  sb: SupabaseClient,
  clientId: string,
  executionMonths: string[],
): Promise<AuthorityLoadResult> {
  const [clientResult, contextResult, executionResult, activeIntelligenceResult, intelligencePoliciesResult] = await Promise.all([
    sb.from("clients")
      .select("id, name, package_tier, stage1_status, stage2_status")
      .eq("id", clientId)
      .maybeSingle(),
    sb.from("client_context_files")
      .select("id, file_number, file_name, content_md, status, version")
      .eq("client_id", clientId)
      .order("file_number"),
    sb.from("client_execution_files")
      .select("id, month, file_number, file_name, content_md, review_state, version")
      .eq("client_id", clientId)
      .in("month", executionMonths)
      .order("month")
      .order("file_number"),
    sb.from("client_intelligence_active_releases")
      .select("intelligence_domain, release_id")
      .eq("client_id", clientId)
      .in("intelligence_domain", [...INTELLIGENCE_DOMAINS]),
    sb.from("client_intelligence_refresh_policies")
      .select("intelligence_domain, refresh_interval_days, due_warning_days")
      .eq("client_id", clientId)
      .in("intelligence_domain", [...INTELLIGENCE_DOMAINS]),
  ]);

  if (clientResult.error || !clientResult.data) {
    return { ok: false, status: 404, code: "CLIENT_NOT_FOUND", message: "Client not found." };
  }
  if (contextResult.error || executionResult.error || activeIntelligenceResult.error || intelligencePoliciesResult.error) {
    return {
      ok: false,
      status: 500,
      code: "AUTHORITY_QUERY_FAILED",
      message: contextResult.error?.message ?? executionResult.error?.message
        ?? activeIntelligenceResult.error?.message ?? intelligencePoliciesResult.error?.message
        ?? "Authority query failed.",
    };
  }

  const allContext = contextResult.data ?? [];
  const approvedContext = allContext.filter((file) => file.status === "approved");
  const contextReadiness = contextAuthorityReadiness(clientResult.data.stage1_status, allContext);
  if (!contextReadiness.ready) {
    return {
      ok: false,
      status: 409,
      code: "CONTEXT_AUTHORITY_INCOMPLETE",
      message: "Ideation requires all 21 approved, non-empty Context Files.",
      details: {
        stage1_status: clientResult.data.stage1_status,
        approved: contextReadiness.approved,
        missing_file_numbers: contextReadiness.missingFileNumbers,
        empty_file_numbers: contextReadiness.emptyFileNumbers,
      },
    };
  }

  if (clientResult.data.stage2_status !== "complete") {
    return {
      ok: false,
      status: 409,
      code: "EXECUTION_AUTHORITY_INCOMPLETE",
      message: "Ideation requires Phase 2 to be complete.",
      details: { stage2_status: clientResult.data.stage2_status },
    };
  }

  const approvedPhase1Files = approvedContext.map((file) => ({
    ...file,
    content_md: file.content_md as string,
  })) as ApprovedContextFile[];
  const classifiedPhase1 = classifyApprovedPhase1Authority(approvedPhase1Files);
  const missingStrategicPlaybooks = STRATEGIC_PLAYBOOK_CONTEXT_FILES.filter((definition) =>
    !classifiedPhase1.strategicPlaybooks.some((file) =>
      file.file_number === definition.file_number && file.file_name === definition.file_name
    )
  );
  if (missingStrategicPlaybooks.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "STRATEGIC_PLAYBOOK_AUTHORITY_INCOMPLETE",
      message: "Ideation requires the approved Phase 1 strategic playbook authority.",
      details: {
        missing: missingStrategicPlaybooks.map((file) => file.file_name),
        storage_table: "client_context_files",
      },
    };
  }

  const executionFilesByMonth = new Map<string, ApprovedExecutionFile[]>();
  for (const month of executionMonths) {
    const readiness = executionAuthorityReadiness(
      clientResult.data.stage2_status,
      month,
      executionResult.data ?? [],
    );
    const monthRows = readiness.approved;
    if (!readiness.ready) {
      return {
        ok: false,
        status: 409,
        code: "EXECUTION_AUTHORITY_INCOMPLETE",
        message: `Ideation requires all ${EXECUTION_FILE_COUNT} approved, canonical Execution Files for ${month}.`,
        details: {
          month,
          approved: monthRows.length,
          missing: readiness.missingCodes,
          empty: readiness.empty,
        },
      };
    }
    executionFilesByMonth.set(
      month,
      monthRows
        .map((file) => ({ ...file, content_md: file.content_md as string })) as ApprovedExecutionFile[],
    );
  }

  const activeRows = activeIntelligenceResult.data ?? [];
  const activeByDomain = new Map(activeRows.map((row) => [row.intelligence_domain, row.release_id]));
  const missingDomains = INTELLIGENCE_DOMAINS.filter((domain) => !activeByDomain.has(domain));
  if (missingDomains.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "INTELLIGENCE_AUTHORITY_INCOMPLETE",
      message: "Ideation requires active approved Market, Avatar, Competitor, Association, and Brand Strategist authority.",
      details: { missing_intelligence_domains: missingDomains },
    };
  }

  const policyByDomain = new Map((intelligencePoliciesResult.data ?? []).map((policy) => [
    policy.intelligence_domain,
    policy,
  ]));
  const missingPolicies = INTELLIGENCE_DOMAINS.filter((domain) => !policyByDomain.has(domain));
  if (missingPolicies.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "INTELLIGENCE_REFRESH_POLICY_INCOMPLETE",
      message: "Ideation cannot establish intelligence freshness because a required refresh policy is missing.",
      details: { missing_intelligence_policy_domains: missingPolicies },
    };
  }

  const activeReleaseIds = INTELLIGENCE_DOMAINS.map((domain) => activeByDomain.get(domain)!);
  const [intelligenceReleasesResult, intelligenceRecordsResult] = await Promise.all([
    sb.from("client_intelligence_releases")
      .select("id, intelligence_domain, version, title, summary, content, authority_snapshot, approved_at, status")
      .eq("client_id", clientId)
      .in("id", activeReleaseIds),
    sb.from("client_intelligence_records")
      .select("id, release_id, record_type, record_key, title, summary, payload, display_order")
      .eq("client_id", clientId)
      .in("release_id", activeReleaseIds)
      .order("display_order"),
  ]);
  if (intelligenceReleasesResult.error || intelligenceRecordsResult.error) {
    return {
      ok: false,
      status: 500,
      code: "INTELLIGENCE_AUTHORITY_QUERY_FAILED",
      message: intelligenceReleasesResult.error?.message ?? intelligenceRecordsResult.error?.message
        ?? "Approved intelligence authority could not be loaded.",
    };
  }

  const releasesByDomain = new Map((intelligenceReleasesResult.data ?? []).map((release) => [
    release.intelligence_domain,
    release,
  ]));
  const invalidDomains = INTELLIGENCE_DOMAINS.filter((domain) => {
    const release = releasesByDomain.get(domain);
    return !release || release.status !== "approved" || release.id !== activeByDomain.get(domain) || !release.approved_at;
  });
  if (invalidDomains.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "INTELLIGENCE_AUTHORITY_INVALID",
      message: "An active intelligence pointer does not reference its approved client-owned release.",
      details: { invalid_intelligence_domains: invalidDomains },
    };
  }

  const staleDomains: IntelligenceDomain[] = [];
  const driftedDependencies: Array<{ domain: IntelligenceDomain; upstream_domain: IntelligenceDomain }> = [];
  const intelligenceReleases: ApprovedIntelligenceRelease[] = [];
  for (const domain of INTELLIGENCE_DOMAINS) {
    const release = releasesByDomain.get(domain)!;
    const policy = policyByDomain.get(domain)!;
    const freshness = intelligenceFreshness(
      release.approved_at,
      policy.refresh_interval_days,
      policy.due_warning_days,
    );
    if (freshness === "stale") staleDomains.push(domain);
    for (const upstreamDomain of INTELLIGENCE_DOMAINS) {
      if (upstreamDomain === domain) continue;
      const recordedReleaseId = snapshotReleaseId(release.authority_snapshot ?? {}, upstreamDomain);
      if (recordedReleaseId && recordedReleaseId !== activeByDomain.get(upstreamDomain)) {
        driftedDependencies.push({ domain, upstream_domain: upstreamDomain });
      }
    }
    const records = (intelligenceRecordsResult.data ?? []).filter((record) => record.release_id === release.id);
    if (records.length === 0) {
      return {
        ok: false,
        status: 409,
        code: "INTELLIGENCE_AUTHORITY_EMPTY",
        message: `The active approved ${domain} release has no structured records.`,
        details: { intelligence_domain: domain, release_id: release.id },
      };
    }
    intelligenceReleases.push({
      id: release.id,
      intelligence_domain: domain,
      version: release.version,
      title: release.title,
      summary: release.summary,
      content: release.content ?? {},
      authority_snapshot: release.authority_snapshot ?? {},
      approved_at: release.approved_at,
      freshness: freshness as "fresh" | "due",
      records: records as ApprovedIntelligenceRecord[],
    });
  }
  if (staleDomains.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "INTELLIGENCE_AUTHORITY_STALE",
      message: "Ideation requires refreshed intelligence before it can create downstream work.",
      details: { stale_intelligence_domains: staleDomains },
    };
  }
  if (driftedDependencies.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "INTELLIGENCE_DEPENDENCY_DRIFT",
      message: "Approved downstream intelligence was built from a superseded upstream release and must be refreshed.",
      details: { drifted_dependencies: driftedDependencies },
    };
  }

  return {
    ok: true,
    authority: {
      client: clientResult.data,
      allContextFiles: approvedPhase1Files,
      contextFiles: classifiedPhase1.contextFiles,
      strategicPlaybooks: classifiedPhase1.strategicPlaybooks,
      executionFilesByMonth,
      intelligenceReleases,
    },
  };
}

export function boundedIntelligenceExcerpt(
  releases: ApprovedIntelligenceRelease[],
  maxChars = 6000,
  perReleaseChars = 1200,
): { excerpt: string; references: string[] } {
  const references: string[] = [];
  const sections = releases
    .slice()
    .sort((left, right) => INTELLIGENCE_DOMAINS.indexOf(left.intelligence_domain) - INTELLIGENCE_DOMAINS.indexOf(right.intelligence_domain))
    .map((release) => {
      references.push(`${release.intelligence_domain}:v${release.version}:${release.id}`);
      const records = release.records.map((record) =>
        `- [${record.record_type}/${record.record_key}] ${record.title}: ${record.summary}`
      ).join("\n");
      return `===== ACTIVE APPROVED ${release.title} (${release.intelligence_domain} v${release.version}) =====\n${release.summary}\n${records}`
        .slice(0, perReleaseChars);
    });
  return { excerpt: sections.join("\n\n").slice(0, maxChars), references };
}

export function boundedAuthorityExcerpt(
  files: Array<{ file_number: number; file_name: string; content_md: string }>,
  wantedNumbers: number[],
  maxChars = 8000,
  perFileChars = 1600,
): { excerpt: string; references: string[] } {
  const wanted = new Set(wantedNumbers);
  const selected = files
    .filter((file) => wanted.has(file.file_number))
    .sort((a, b) => a.file_number - b.file_number);
  const references: string[] = [];
  const sections: string[] = [];
  for (const file of selected) {
    references.push(file.file_name);
    sections.push(`===== APPROVED ${file.file_name} =====\n${file.content_md.trim().slice(0, perFileChars)}`);
  }
  return { excerpt: sections.join("\n\n").slice(0, maxChars), references };
}
