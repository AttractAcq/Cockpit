import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  INTELLIGENCE_DOMAINS,
  intelligenceFreshness,
  type IntelligenceDomain,
} from "../client-authority.ts";
import { sha256 } from "../ideation/hash.ts";

export type IntelligenceAuthorityVerification =
  | { ok: true }
  | { ok: false; code: string; message: string };

function expectedEntry(snapshot: Record<string, unknown>, domain: IntelligenceDomain): {
  release_id: string;
  version: number;
  content_hash: string;
} | null {
  const value = snapshot[domain];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.release_id !== "string"
    || !Number.isInteger(entry.version)
    || typeof entry.content_hash !== "string"
  ) return null;
  return {
    release_id: entry.release_id,
    version: entry.version as number,
    content_hash: entry.content_hash,
  };
}

function upstreamReleaseId(snapshot: Record<string, unknown>, domain: IntelligenceDomain): string | null {
  const value = snapshot[domain];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const releaseId = (value as Record<string, unknown>).release_id;
  return typeof releaseId === "string" ? releaseId : null;
}

export async function verifyIntelligenceAuthoritySnapshot(
  sb: SupabaseClient,
  clientId: string,
  snapshot: unknown,
): Promise<IntelligenceAuthorityVerification> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return { ok: false, code: "INTELLIGENCE_SNAPSHOT_INVALID", message: "The downstream output has no valid intelligence authority snapshot." };
  }
  const expectedSnapshot = snapshot as Record<string, unknown>;
  const expectedByDomain = new Map<IntelligenceDomain, NonNullable<ReturnType<typeof expectedEntry>>>();
  for (const domain of INTELLIGENCE_DOMAINS) {
    const expected = expectedEntry(expectedSnapshot, domain);
    if (!expected) {
      return { ok: false, code: "INTELLIGENCE_SNAPSHOT_INVALID", message: `The intelligence snapshot is missing ${domain}.` };
    }
    expectedByDomain.set(domain, expected);
  }

  const expectedIds = INTELLIGENCE_DOMAINS.map((domain) => expectedByDomain.get(domain)!.release_id);
  const [activeResult, releaseResult, recordResult, policyResult] = await Promise.all([
    sb.from("client_intelligence_active_releases")
      .select("intelligence_domain, release_id")
      .eq("client_id", clientId)
      .in("intelligence_domain", [...INTELLIGENCE_DOMAINS]),
    sb.from("client_intelligence_releases")
      .select("id, intelligence_domain, version, title, summary, status, approved_at, authority_snapshot")
      .eq("client_id", clientId)
      .in("id", expectedIds),
    sb.from("client_intelligence_records")
      .select("release_id, record_type, record_key, title, summary, payload, display_order")
      .eq("client_id", clientId)
      .in("release_id", expectedIds)
      .order("display_order"),
    sb.from("client_intelligence_refresh_policies")
      .select("intelligence_domain, refresh_interval_days, due_warning_days")
      .eq("client_id", clientId)
      .in("intelligence_domain", [...INTELLIGENCE_DOMAINS]),
  ]);
  const queryError = activeResult.error ?? releaseResult.error ?? recordResult.error ?? policyResult.error;
  if (queryError) {
    return { ok: false, code: "INTELLIGENCE_AUTHORITY_QUERY_FAILED", message: "Approved intelligence authority could not be re-verified." };
  }

  const activeByDomain = new Map((activeResult.data ?? []).map((row) => [row.intelligence_domain, row.release_id]));
  const releaseByDomain = new Map((releaseResult.data ?? []).map((row) => [row.intelligence_domain, row]));
  const policyByDomain = new Map((policyResult.data ?? []).map((row) => [row.intelligence_domain, row]));
  for (const domain of INTELLIGENCE_DOMAINS) {
    const expected = expectedByDomain.get(domain)!;
    const release = releaseByDomain.get(domain);
    const policy = policyByDomain.get(domain);
    if (
      activeByDomain.get(domain) !== expected.release_id
      || !release
      || release.id !== expected.release_id
      || release.version !== expected.version
      || release.status !== "approved"
      || !release.approved_at
    ) {
      return { ok: false, code: "INTELLIGENCE_AUTHORITY_DRIFT", message: `${domain} changed after this downstream output was created.` };
    }
    if (!policy) {
      return { ok: false, code: "INTELLIGENCE_REFRESH_POLICY_INCOMPLETE", message: `${domain} has no refresh policy.` };
    }
    if (intelligenceFreshness(release.approved_at, policy.refresh_interval_days, policy.due_warning_days) === "stale") {
      return { ok: false, code: "INTELLIGENCE_AUTHORITY_STALE", message: `${domain} is stale and must be refreshed before downstream commit.` };
    }
    for (const upstreamDomain of INTELLIGENCE_DOMAINS) {
      if (upstreamDomain === domain) continue;
      const recordedUpstream = upstreamReleaseId(release.authority_snapshot ?? {}, upstreamDomain);
      if (recordedUpstream && recordedUpstream !== activeByDomain.get(upstreamDomain)) {
        return { ok: false, code: "INTELLIGENCE_DEPENDENCY_DRIFT", message: `${domain} depends on a superseded ${upstreamDomain} release.` };
      }
    }
    const records = (recordResult.data ?? []).filter((record) => record.release_id === release.id);
    const contentHash = await sha256(JSON.stringify({
      title: release.title,
      summary: release.summary,
      records: records.map((record) => ({
        record_type: record.record_type,
        record_key: record.record_key,
        title: record.title,
        summary: record.summary,
        payload: record.payload,
      })),
    }));
    if (contentHash !== expected.content_hash) {
      return { ok: false, code: "INTELLIGENCE_AUTHORITY_DRIFT", message: `${domain} content no longer matches the recorded authority hash.` };
    }
  }
  return { ok: true };
}
