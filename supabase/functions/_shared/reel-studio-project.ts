import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  selectUnambiguousLegacyReelBrief,
  type ReelProductionBriefIdentity,
  type ReelProjectSourceIdentity,
  validateBoundReelBrief,
} from "./reel-studio-contract.ts";
import { resolveReelSourceEligibility } from "./reel-studio-eligibility.ts";

export interface ReelProjectRecord {
  id: string;
  client_id: string;
  organic_master_id: string | null;
  ads_master_id: string | null;
  client_production_brief_id: string | null;
  brand_prompt_block_id: string;
  status: string;
  title: string;
  archetype: string;
  awareness_stage: string;
  target_duration_sec: number;
  updated_at: string;
}

export interface ReelProductionBriefRecord extends ReelProductionBriefIdentity {
  content_md: string;
  source_ref: string;
  title: string;
  production_status: string;
  production_mode: string | null;
  metadata: Record<string, unknown> | null;
}

export class ReelStudioGateError extends Error {
  readonly status: number;
  readonly stage: string;

  constructor(status: number, stage: string, message: string) {
    super(message);
    this.name = "ReelStudioGateError";
    this.status = status;
    this.stage = stage;
  }
}

export function projectSourceIdentity(project: ReelProjectRecord): ReelProjectSourceIdentity {
  if (project.organic_master_id) {
    return {
      clientId: project.client_id,
      sourceTable: "organic_master",
      sourceRowId: project.organic_master_id,
    };
  }
  if (project.ads_master_id) {
    return {
      clientId: project.client_id,
      sourceTable: "ads_master",
      sourceRowId: project.ads_master_id,
    };
  }
  throw new ReelStudioGateError(
    409,
    "brief",
    "This standalone project has no linked source or production brief; add shots manually.",
  );
}

/**
 * Phase 2, Workstream B: one authoritative eligibility check applied to every
 * brief-derived Reel Studio operation. Reads the project's own source row so the
 * SAME resolver the UI and create-video-project use decides here too, and a
 * human-only brief can never enter Reel Studio without an explicit mode change.
 */
export async function assertReelStudioEligible(
  sb: SupabaseClient,
  project: ReelProjectRecord,
  brief: ReelProductionBriefRecord,
): Promise<void> {
  const source = projectSourceIdentity(project);
  const sourceRow = await sb.from(source.sourceTable).select("*").eq("id", source.sourceRowId).maybeSingle();
  if (sourceRow.error) throw new Error(`Could not read the project's source content row: ${sourceRow.error.message}`);

  const eligibility = resolveReelSourceEligibility({
    sourceTable: source.sourceTable,
    sourceRow: (sourceRow.data as Record<string, unknown> | null) ?? null,
    brief,
    briefCandidateCount: 1,
  });
  if (!eligibility.eligible) {
    throw new ReelStudioGateError(409, "eligibility", eligibility.reason);
  }
}

export async function resolveApprovedReelBrief(
  sb: SupabaseClient,
  project: ReelProjectRecord,
): Promise<{ project: ReelProjectRecord; brief: ReelProductionBriefRecord }> {
  const source = projectSourceIdentity(project);

  if (project.client_production_brief_id) {
    const result = await sb
      .from("client_production_briefs")
      .select("*")
      .eq("id", project.client_production_brief_id)
      .maybeSingle();
    if (result.error) throw new Error(`Could not load the bound production brief: ${result.error.message}`);
    if (!result.data) throw new ReelStudioGateError(409, "brief", "The project's bound production brief no longer exists.");

    const validation = validateBoundReelBrief(source, result.data as ReelProductionBriefRecord);
    if (!validation.ok) throw new ReelStudioGateError(409, "brief", validation.error);
    await assertReelStudioEligible(sb, project, result.data as ReelProductionBriefRecord);
    return { project, brief: result.data as ReelProductionBriefRecord };
  }

  const matches = await sb
    .from("client_production_briefs")
    .select("*")
    .eq("client_id", source.clientId)
    .eq("source_table", source.sourceTable)
    .eq("source_row_id", source.sourceRowId)
    .eq("asset_format", "reel_video")
    .eq("status", "approved");
  if (matches.error) throw new Error(`Could not resolve a legacy project's production brief: ${matches.error.message}`);

  const selected = selectUnambiguousLegacyReelBrief(
    source,
    (matches.data ?? []) as ReelProductionBriefRecord[],
  );
  if (!selected.ok) throw new ReelStudioGateError(409, "brief", selected.error);
  // Legacy binding must clear the same eligibility bar as an explicit binding —
  // resolving a brief implicitly must never smuggle a human-only brief into
  // Reel Studio.
  await assertReelStudioEligible(sb, project, selected.value as ReelProductionBriefRecord);

  const bound = await sb.rpc("bind_legacy_reel_project_brief", {
    p_video_project_id: project.id,
    p_client_production_brief_id: selected.value.id,
  });
  if (bound.error || !bound.data) {
    throw new ReelStudioGateError(
      409,
      "brief",
      bound.error?.message ?? "Could not persist the resolved production brief on the legacy project.",
    );
  }

  return {
    project: bound.data as ReelProjectRecord,
    brief: selected.value as ReelProductionBriefRecord,
  };
}
