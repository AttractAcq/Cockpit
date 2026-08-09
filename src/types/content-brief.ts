// Programme Stage H — the structured Content Brief contract.
//
// Deliberately duplicated from supabase/functions/_shared/content-brief.ts
// rather than cross-imported — same Supabase MCP deploy-tool path-flattening
// constraint documented for Stage F/G. Parity is guarded by a test, not
// just a comment.

export interface StructuredContentBrief {
  objective: string;
  audience: string;
  platform: string;
  format: string;
  organic_or_paid: "organic" | "paid";
  core_idea: string;
  core_claim: string | null;
  hook: string;
  belief_before: string;
  belief_after: string;
  proof: string | null;
  proof_required: boolean;
  narrative_structure: string;
  copy_or_script_requirements: string;
  visual_direction: string;
  asset_inputs: string[];
  brand_constraints: string[];
  cta: string;
  approval_rules: string;
  production_mode: "ai" | "human" | "hybrid";
  required_outputs: string[];
  quality_checklist: string[];
}

export type ContentBriefStatus = "draft" | "in_review" | "approved" | "superseded";

export interface ContentBrief {
  id: string;
  client_id: string;
  content_item_id: string;
  brief_version: number;
  status: ContentBriefStatus;
  body: StructuredContentBrief;
  rendered_markdown: string | null;
  context_version: number | null;
  execution_version: number | null;
  provider: string | null;
  model: string | null;
  prompt_digest: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ContentItemStatus =
  | "planned" | "brief_pending" | "brief_review" | "production_ready"
  | "in_production" | "asset_review" | "approved" | "scheduled"
  | "published" | "analysed" | "iterated";

export interface ContentItem {
  id: string;
  client_id: string;
  content_opportunity_id: string | null;
  calendar_slot_id: string | null;
  title: string;
  status: ContentItemStatus;
  context_version: number | null;
  execution_version: number | null;
  distribution_record_id: string | null;
  current_content_brief_id: string | null;
  source_proposal_slot_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  published_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

const REQUIRED_STRING_FIELDS: readonly (keyof StructuredContentBrief)[] = [
  "objective", "audience", "platform", "format", "core_idea", "hook",
  "belief_before", "belief_after", "narrative_structure",
  "copy_or_script_requirements", "visual_direction", "cta", "approval_rules",
];

const REQUIRED_ARRAY_FIELDS: readonly (keyof StructuredContentBrief)[] = [
  "asset_inputs", "brand_constraints", "required_outputs", "quality_checklist",
];

/**
 * Frontend twin of the Deno-side validator in
 * supabase/functions/_shared/content-brief.ts — duplicated for the same
 * deploy-tool path-flattening reason as Stage F/G, parity-tested rather
 * than just commented.
 */
export function validateStructuredBrief(raw: unknown): StructuredContentBrief | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;

  for (const field of REQUIRED_STRING_FIELDS) {
    const v = row[field];
    if (typeof v !== "string" || v.trim().length === 0) return null;
  }
  for (const field of REQUIRED_ARRAY_FIELDS) {
    const v = row[field];
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return null;
  }
  if (row.organic_or_paid !== "organic" && row.organic_or_paid !== "paid") return null;
  if (row.production_mode !== "ai" && row.production_mode !== "human" && row.production_mode !== "hybrid") return null;
  if (typeof row.proof_required !== "boolean") return null;
  if (row.core_claim !== null && typeof row.core_claim !== "string") return null;
  if (row.proof !== null && typeof row.proof !== "string") return null;

  return {
    objective: row.objective as string,
    audience: row.audience as string,
    platform: row.platform as string,
    format: row.format as string,
    organic_or_paid: row.organic_or_paid,
    core_idea: row.core_idea as string,
    core_claim: (row.core_claim as string | null) ?? null,
    hook: row.hook as string,
    belief_before: row.belief_before as string,
    belief_after: row.belief_after as string,
    proof: (row.proof as string | null) ?? null,
    proof_required: row.proof_required,
    narrative_structure: row.narrative_structure as string,
    copy_or_script_requirements: row.copy_or_script_requirements as string,
    visual_direction: row.visual_direction as string,
    asset_inputs: row.asset_inputs as string[],
    brand_constraints: row.brand_constraints as string[],
    cta: row.cta as string,
    approval_rules: row.approval_rules as string,
    production_mode: row.production_mode,
    required_outputs: row.required_outputs as string[],
    quality_checklist: row.quality_checklist as string[],
  };
}

// Programme Stage 1B-C — Facebook Renditions. One canonical Content Item can
// produce an independent, platform-specific Rendition without mutating the
// canonical Brief above or another platform's Rendition.

export type RenditionFormat = "IMAGE" | "CAROUSEL" | "STORIES" | "REELS" | "VIDEO" | "TEXT_LINK";
export type RenditionPlatform = "instagram" | "facebook";
export type RenditionStatus = "draft" | "in_review" | "approved" | "superseded";

export interface RenditionCapabilitySnapshot {
  supported: boolean;
  reason: string | null;
}

export interface ContentItemRendition {
  id: string;
  client_id: string;
  content_item_id: string;
  platform: RenditionPlatform;
  rendition_version: number;
  status: RenditionStatus;
  format: RenditionFormat;
  copy: string;
  cta: string;
  media: string[];
  scheduling_guidance: Record<string, unknown>;
  capability_snapshot: RenditionCapabilitySnapshot;
  change_request_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ReviewBriefAction = "submit_for_review" | "approve" | "request_changes";

export interface GenerateContentBriefResponse {
  ok: true;
  content_item_id: string;
  brief: ContentBrief;
}

export interface ReviewContentBriefResponse {
  ok: true;
  content_brief_id: string;
  status: ContentBriefStatus;
}
