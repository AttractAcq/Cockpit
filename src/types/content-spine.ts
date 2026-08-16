// Programme Stage B — canonical content spine domain model.
//
// This is the single shared vocabulary for the Cockpit content operating
// chain. Frontend and backend must both use these types; no later stage may
// redefine an entity's ownership.
//
// Ownership boundaries (mirrors 20260803000042_stage_b_canonical_domain_spine):
// - scheduled date      -> CalendarSlot.scheduled_for
// - format              -> ContentRequirement.asset_format
// - production status   -> ProductionJob.status
// - approval            -> ContentItem.status
// - distribution        -> client_distribution_records (referenced, not owned)
// - analytics           -> ContentPerformance
// - authority provenance-> context_version / execution_version

export type ContentSourceKind =
  | "manual_idea"
  | "proof_item"
  | "research_candidate"
  | "performance_insight"
  | "ideation_candidate";

export type ProofKind =
  | "testimonial"
  | "result"
  | "case_study"
  | "metric"
  | "credential"
  | "artefact";

export type ProofVerificationStatus = "unverified" | "verified" | "rejected";

export type ContentOpportunityStatus =
  | "draft"
  | "needs_review"
  | "shortlisted"
  | "selected"
  | "scheduled"
  | "produced"
  | "rejected"
  | "expired";

export type ContentOpportunityOrigin =
  | "manual"
  | "proof"
  | "research"
  | "performance";

export type ContentOpportunityEligibilityStatus = "pending" | "eligible" | "ineligible";

export type ContentOpportunityGeneratedBy = "manual" | "ai";

export type CalendarSlotStatus = "open" | "reserved" | "filled" | "cancelled";

export type ContentItemStatus =
  | "planned"
  | "brief_pending"
  | "brief_review"
  | "production_ready"
  | "in_production"
  | "asset_review"
  | "approved"
  | "scheduled"
  | "published"
  | "analysed"
  | "iterated";

export type ContentBriefStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "superseded";

export type ProductionJobStatus =
  | "pending"
  | "running"
  | "retryable"
  | "failed"
  | "completed"
  | "cancelled";

export type MetricSource = "manual" | "platform_api" | "derived";

export type LearningProposalKind =
  | "context_update"
  | "execution_update"
  | "opportunity_seed";

export type LearningProposalStatus =
  | "draft"
  | "needs_review"
  | "accepted"
  | "rejected";

// ---------------------------------------------------------------------------
// Status machines — the only authoritative transition tables.
// ---------------------------------------------------------------------------

export const CONTENT_OPPORTUNITY_TRANSITIONS: Readonly<
  Record<ContentOpportunityStatus, readonly ContentOpportunityStatus[]>
> = {
  draft: ["needs_review", "rejected", "expired"],
  needs_review: ["shortlisted", "rejected", "expired"],
  shortlisted: ["selected", "rejected", "expired"],
  selected: ["scheduled"],
  scheduled: ["produced"],
  produced: [],
  rejected: [],
  expired: [],
} as const;

export const CONTENT_ITEM_TRANSITIONS: Readonly<
  Record<ContentItemStatus, readonly ContentItemStatus[]>
> = {
  planned: ["brief_pending"],
  brief_pending: ["brief_review"],
  brief_review: ["production_ready"],
  production_ready: ["in_production"],
  in_production: ["asset_review"],
  asset_review: ["approved"],
  approved: ["scheduled"],
  scheduled: ["published"],
  published: ["analysed"],
  analysed: ["iterated"],
  iterated: [],
} as const;

/** Statuses at or beyond human approval. Never machine-settable. */
export const CONTENT_ITEM_APPROVED_STATUSES: readonly ContentItemStatus[] = [
  "approved",
  "scheduled",
  "published",
  "analysed",
  "iterated",
] as const;

export function canTransitionOpportunity(
  from: ContentOpportunityStatus,
  to: ContentOpportunityStatus,
): boolean {
  return CONTENT_OPPORTUNITY_TRANSITIONS[from].includes(to);
}

export function canTransitionContentItem(
  from: ContentItemStatus,
  to: ContentItemStatus,
): boolean {
  return CONTENT_ITEM_TRANSITIONS[from].includes(to);
}

/** True when reaching `status` requires a recorded human approver. */
export function requiresHumanApproval(status: ContentItemStatus): boolean {
  return CONTENT_ITEM_APPROVED_STATUSES.includes(status);
}

/** Proof fails closed: only a verified claim may be used downstream. */
export function isProofUsable(proof: Pick<ProofItem, "verification_status">): boolean {
  return proof.verification_status === "verified";
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

interface OwnedRow {
  id: string;
  client_id: string;
  created_at: string;
  updated_at: string;
}

interface AuthorityProvenance {
  context_version: number | null;
  execution_version: number | null;
}

export interface ContentSource extends OwnedRow, AuthorityProvenance {
  source_kind: ContentSourceKind;
  external_ref: string | null;
  title: string;
  summary: string | null;
  payload: Record<string, unknown>;
  captured_at: string;
  created_by: string | null;
}

export interface ManualIdea extends OwnedRow {
  content_source_id: string;
  body: string;
  submitted_by: string | null;
}

export interface ProofItem extends OwnedRow {
  content_source_id: string;
  proof_kind: ProofKind;
  claim: string;
  evidence_ref: string | null;
  verification_status: ProofVerificationStatus;
  verified_by: string | null;
  verified_at: string | null;
}

export interface ContentOpportunity extends OwnedRow, AuthorityProvenance {
  title: string;
  angle: string | null;
  rationale: string | null;
  status: ContentOpportunityStatus;
  origin: ContentOpportunityOrigin;
  score: number | null;
  score_method: string | null;
  expires_at: string | null;
  rejected_reason: string | null;
  selected_at: string | null;
  created_by: string | null;

  // Programme Stage F — Content Opportunity Intelligence.
  core_claim: string | null;
  hook_direction: string | null;
  audience: string | null;
  pain_or_objection: string | null;
  belief_before: string | null;
  belief_after: string | null;
  objective: string | null;
  offer_relationship: string | null;
  funnel_stage: string | null;
  candidate_formats: string[];
  candidate_channels: string[];
  cta_direction: string | null;
  /** 1 (low) to 5 (high) qualitative rating assigned at generation time. */
  visual_potential: number | null;
  production_requirements: string | null;
  eligibility_status: ContentOpportunityEligibilityStatus;
  eligibility_reason: string | null;
  eligibility_checked_at: string | null;
  duplicate_of_opportunity_id: string | null;
  dedup_reason: string | null;
  generated_by: ContentOpportunityGeneratedBy;
  provider: string | null;
  model: string | null;
}

export interface ContentOpportunitySource {
  id: string;
  client_id: string;
  content_opportunity_id: string;
  content_source_id: string;
  contribution: string | null;
  created_at: string;
}

/** Canonical owner of asset_format and channel. */
export interface ContentRequirement extends OwnedRow {
  period_start: string;
  period_end: string;
  asset_format: string;
  channel: string;
  required_count: number;
  fulfilled_count: number;
  execution_version: number | null;
}

/** Canonical owner of the scheduled date. */
export interface CalendarSlot extends OwnedRow {
  content_requirement_id: string;
  scheduled_for: string;
  slot_index: number;
  status: CalendarSlotStatus;
  filled_at: string | null;
}

/** Canonical owner of approval. */
export interface ContentItem extends OwnedRow, AuthorityProvenance {
  content_opportunity_id: string | null;
  calendar_slot_id: string | null;
  title: string;
  status: ContentItemStatus;
  distribution_record_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  published_at: string | null;
  created_by: string | null;
}

export interface ContentItemSource {
  id: string;
  client_id: string;
  content_item_id: string;
  content_source_id: string;
  created_at: string;
}

export interface ContentItemProof {
  id: string;
  client_id: string;
  content_item_id: string;
  proof_item_id: string;
  created_at: string;
}

export interface ContentBrief extends OwnedRow, AuthorityProvenance {
  content_item_id: string;
  brief_version: number;
  status: ContentBriefStatus;
  body: Record<string, unknown>;
  provider: string | null;
  model: string | null;
  prompt_digest: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

/** Canonical owner of production status. Provider-neutral by contract. */
export interface ProductionJob extends OwnedRow {
  content_item_id: string;
  content_brief_id: string | null;
  capability: string;
  status: ProductionJobStatus;
  idempotency_key: string;
  attempt_count: number;
  maximum_attempts: number;
  retryable: boolean;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_heartbeat_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  provider: string | null;
  model: string | null;
  cost_metadata: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
}

/** Canonical owner of analytics. */
export interface ContentPerformance extends OwnedRow {
  content_item_id: string;
  distribution_record_id: string | null;
  measured_at: string;
  metric_source: MetricSource;
  metrics: Record<string, unknown>;
  is_current: boolean;
}

/** Advisory only — never mutates authority. */
export interface LearningProposal extends OwnedRow, AuthorityProvenance {
  content_item_id: string | null;
  content_performance_id: string | null;
  proposal_kind: LearningProposalKind;
  summary: string;
  detail: Record<string, unknown>;
  status: LearningProposalStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
}
