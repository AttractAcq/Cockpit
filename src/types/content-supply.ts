// Programme Stage E — unified content source layer.
//
// All four supply streams (Manual Idea, Proof Vault, seven-technique Research
// Ideation, Performance Insight) resolve through one source contract to the
// same canonical identity. No adapter here writes to the Calendar or to the
// production system; adapters produce sources only.
//
// Mirrors migrations 20260803021320 .. 20260803021355.

import type { ContentSourceKind, ProofKind } from "./content-spine.ts";

export type SourceProcessingStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "skipped";

export type ConsentStatus =
  | "not_obtained"
  | "requested"
  | "granted"
  | "withdrawn"
  | "not_required";

export type Anonymisation =
  | "none"
  | "first_name_only"
  | "initials"
  | "fully_anonymised";

export type ProofUsageState =
  | "unused"
  | "used"
  | "repurposed"
  | "overused"
  | "high_performing"
  | "restricted"
  | "expired"
  | "needs_stronger_evidence";

export type Specificity = "vague" | "general" | "specific" | "quantified";

export type TechniqueFailureBehaviour =
  | "fail_closed"
  | "skip_technique"
  | "retry_then_fail";

/** The single shape every adapter must produce. */
export interface CanonicalSourceInput {
  client_id: string;
  source_kind: ContentSourceKind;
  title: string;
  summary: string | null;
  raw_content: string;
  raw_content_hash: string;
  payload: Record<string, unknown>;
  external_ref: string | null;
  ideation_candidate_id: string | null;
  performance_insight_id: string | null;
  source_document_id: string | null;
  proof_item_id: string | null;
}

export interface ProofVaultItem {
  id: string;
  client_id: string;
  proof_kind: ProofKind;
  claim: string;
  verification_status: "unverified" | "verified" | "rejected";
  happened_what: string | null;
  happened_for: string | null;
  what_changed: string | null;
  claims_supported: string[];
  objections_answered: string[];
  available_media: string[];
  specificity: Specificity | null;
  occurred_on: string | null;
  service_ref: string | null;
  audience_relevance: string | null;
  consent_status: ConsentStatus;
  consent_reference: string | null;
  anonymisation: Anonymisation;
  usage_state: ProofUsageState;
  used_count: number;
  last_used_at: string | null;
  restricted_reason: string | null;
  expires_on: string | null;
}

export interface IdeationTechniqueStrategy {
  technique_slug: string;
  strategy_version: number;
  status: "draft" | "active" | "superseded";
  required_inputs: string[];
  research_method: string;
  evidence_contract: Record<string, unknown>;
  freshness_max_age_days: number;
  candidate_contract: Record<string, unknown>;
  failure_behaviour: TechniqueFailureBehaviour;
  cost_limit_usd: number | null;
  cost_limit_calls: number | null;
  content_hash: string;
}

/** The seven techniques the Ideation system implements. */
export const IDEATION_TECHNIQUES = [
  "persona",
  "review_mined_pain_language",
  "competitor_objections",
  "end_customer_complaints",
  "live_objection_log",
  "trigger_event",
  "format_swipe",
] as const;

export type IdeationTechnique = (typeof IDEATION_TECHNIQUES)[number];

// ---------------------------------------------------------------------------
// Canonical identity
// ---------------------------------------------------------------------------

const EMPTY_LINKS = {
  ideation_candidate_id: null,
  performance_insight_id: null,
  source_document_id: null,
  proof_item_id: null,
} as const;

/**
 * Canonical source identity. Deliberately built from client and raw content
 * hash only — the same material submitted through any stream is the same
 * source, and identity never depends on which adapter created it.
 */
export function canonicalSourceIdentity(
  source: Pick<CanonicalSourceInput, "client_id" | "raw_content_hash">,
): string {
  return `${source.client_id}:${source.raw_content_hash}`;
}

/** Mirrors content_sources_adapter_check. */
export function hasValidAdapterLinkage(source: CanonicalSourceInput): boolean {
  const { source_kind, ideation_candidate_id, performance_insight_id, proof_item_id } = source;
  switch (source_kind) {
    case "manual_idea":
      return (
        ideation_candidate_id === null &&
        performance_insight_id === null &&
        proof_item_id === null
      );
    case "proof_item":
      return ideation_candidate_id === null && performance_insight_id === null;
    case "research_candidate":
      return performance_insight_id === null && proof_item_id === null;
    case "performance_insight":
      return ideation_candidate_id === null && proof_item_id === null;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Adapters — one per supply stream
// ---------------------------------------------------------------------------

export function manualIdeaToSource(input: {
  client_id: string;
  title: string;
  body: string;
  body_hash: string;
  notes?: string | null;
  source_url?: string | null;
}): CanonicalSourceInput {
  return {
    ...EMPTY_LINKS,
    client_id: input.client_id,
    source_kind: "manual_idea",
    title: input.title,
    summary: input.notes ?? null,
    raw_content: input.body,
    raw_content_hash: input.body_hash,
    payload: { notes: input.notes ?? null },
    external_ref: input.source_url ?? null,
  };
}

export function proofItemToSource(
  proof: Pick<
    ProofVaultItem,
    "id" | "client_id" | "claim" | "proof_kind" | "claims_supported" | "objections_answered"
  >,
  raw: { content: string; hash: string },
): CanonicalSourceInput {
  return {
    ...EMPTY_LINKS,
    client_id: proof.client_id,
    source_kind: "proof_item",
    title: proof.claim.slice(0, 400),
    summary: null,
    raw_content: raw.content,
    raw_content_hash: raw.hash,
    payload: {
      proof_kind: proof.proof_kind,
      claims_supported: proof.claims_supported,
      objections_answered: proof.objections_answered,
    },
    external_ref: null,
    proof_item_id: proof.id,
  };
}

export function ideationCandidateToSource(candidate: {
  id: string;
  client_id: string;
  title: string;
  rationale?: string | null;
  technique_slug: string;
  raw_content: string;
  raw_content_hash: string;
  evidence: ResearchEvidence[];
}): CanonicalSourceInput {
  return {
    ...EMPTY_LINKS,
    client_id: candidate.client_id,
    source_kind: "research_candidate",
    title: candidate.title,
    summary: candidate.rationale ?? null,
    raw_content: candidate.raw_content,
    raw_content_hash: candidate.raw_content_hash,
    // Evidence travels with the source; it is never summarised away.
    payload: {
      technique_slug: candidate.technique_slug,
      evidence: candidate.evidence,
    },
    external_ref: null,
    ideation_candidate_id: candidate.id,
  };
}

export function performanceInsightToSource(insight: {
  id: string;
  client_id: string;
  title: string;
  summary?: string | null;
  action: PerformanceAction;
  raw_content: string;
  raw_content_hash: string;
}): CanonicalSourceInput {
  return {
    ...EMPTY_LINKS,
    client_id: insight.client_id,
    source_kind: "performance_insight",
    title: insight.title,
    summary: insight.summary ?? null,
    raw_content: insight.raw_content,
    raw_content_hash: insight.raw_content_hash,
    payload: { action: insight.action },
    external_ref: null,
    performance_insight_id: insight.id,
  };
}

export const PERFORMANCE_ACTIONS = [
  "re_edit",
  "alternate_hook",
  "carousel_conversion",
  "story_sequence",
  "paid_promotion",
  "follow_up_topic",
  "proof_reuse",
  "offer_variation",
] as const;

export type PerformanceAction = (typeof PERFORMANCE_ACTIONS)[number];

export interface ResearchEvidence {
  url: string;
  title: string;
  retrieved_at: string;
  quote: string;
  span_start?: number;
  span_end?: number;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Research evidence must survive the adapter intact. */
export function evidenceRemainsAttached(
  source: CanonicalSourceInput,
  original: readonly ResearchEvidence[],
): boolean {
  const carried = source.payload.evidence;
  if (!Array.isArray(carried)) return false;
  if (carried.length !== original.length) return false;
  return original.every((e, i) => {
    const c = carried[i] as ResearchEvidence | undefined;
    return (
      c !== undefined &&
      c.url === e.url &&
      c.quote === e.quote &&
      c.retrieved_at === e.retrieved_at
    );
  });
}

/**
 * Proof is publishable only when verified, consented, not restricted or
 * expired, and not past its expiry date. Every gate is independent — passing
 * verification does not excuse missing consent.
 */
export function isProofPublishable(
  proof: Pick<
    ProofVaultItem,
    "verification_status" | "consent_status" | "usage_state" | "expires_on"
  >,
  today: string,
): boolean {
  if (proof.verification_status !== "verified") return false;
  if (proof.consent_status !== "granted" && proof.consent_status !== "not_required") return false;
  if (
    proof.usage_state === "restricted" ||
    proof.usage_state === "expired" ||
    proof.usage_state === "needs_stronger_evidence"
  ) {
    return false;
  }
  if (proof.expires_on !== null && proof.expires_on < today) return false;
  return true;
}

/** Failed processing is retryable until the attempt cap. */
export function canRetrySource(source: {
  processing_status: SourceProcessingStatus;
  attempt_count: number;
  maximum_attempts: number;
}): boolean {
  return (
    source.processing_status === "failed" && source.attempt_count < source.maximum_attempts
  );
}

/** A technique may only run with an active, complete, fresh-bounded strategy. */
export function isTechniqueStrategyUsable(
  strategy: Pick<
    IdeationTechniqueStrategy,
    "status" | "research_method" | "freshness_max_age_days" | "failure_behaviour"
  >,
): boolean {
  return (
    strategy.status === "active" &&
    strategy.research_method.trim().length > 0 &&
    strategy.freshness_max_age_days > 0
  );
}

/** Which of the seven techniques still lack an active strategy. */
export function techniquesMissingStrategy(
  strategies: ReadonlyArray<Pick<IdeationTechniqueStrategy, "technique_slug" | "status">>,
): IdeationTechnique[] {
  const active = new Set(
    strategies.filter((s) => s.status === "active").map((s) => s.technique_slug),
  );
  return IDEATION_TECHNIQUES.filter((t) => !active.has(t));
}
