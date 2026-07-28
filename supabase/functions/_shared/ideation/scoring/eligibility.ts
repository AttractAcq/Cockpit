// Ideation Stage 2 — scoring eligibility and exact candidate reconciliation.
//
// Scoring is only ever offered a cycle that Stage 1 completed exactly. Anything
// partial, retryable, failed, mis-owned, or inconsistent fails closed here,
// before any authority is reconstructed and before any provider call is made.

import { IDEATION_TECHNIQUE_SLUGS, type IdeationTechniqueSlug } from "../config.ts";

export type IdeationScoringEligibilityCode =
  | "CYCLE_NOT_FOUND"
  | "CYCLE_CLIENT_MISMATCH"
  | "CYCLE_NOT_COMPLETED"
  | "CYCLE_SHORTFALL"
  | "CYCLE_COUNT_MISMATCH"
  | "CANDIDATE_SET_INVALID"
  | "CANDIDATE_SLOT_MISSING"
  | "CANDIDATE_SLOT_DUPLICATE"
  | "CANDIDATE_CROSS_CYCLE"
  | "CANDIDATE_CROSS_CLIENT"
  | "CANDIDATE_EVIDENCE_INVALID";

export interface ScoringCycleRow {
  id: string;
  client_id: string;
  status: string;
  expected_candidate_count: number;
  candidate_count: number;
  shortfall_count: number;
  slot_allocation: Record<string, string[]>;
  configuration_snapshot: Record<string, unknown>;
  input_hash: string;
}

export interface ScoringTechniqueRunRow {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  technique_slug: string;
}

export interface ScoringCandidateRow {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  technique_run_id: string;
  candidate_index: number;
  asset_type: string;
  working_title: string;
  hook: string;
  core_message: string;
  psychological_angle: string | null;
  cta: string;
  evidence_references: unknown;
  input_hash: string;
}

export interface EligibleScoringCandidate {
  candidate_id: string;
  technique_slug: IdeationTechniqueSlug;
  technique_run_id: string;
  candidate_index: number;
  asset_type: string;
  working_title: string;
  hook: string;
  core_message: string;
  psychological_angle: string | null;
  cta: string;
  evidence_references: Array<Record<string, unknown>>;
  evidence_source_ids: string[];
}

export type ScoringEligibilityResult =
  | { ok: true; candidates: EligibleScoringCandidate[] }
  | { ok: false; code: IdeationScoringEligibilityCode; message: string };

function fail(
  code: IdeationScoringEligibilityCode,
  message: string,
): ScoringEligibilityResult {
  return { ok: false, code, message };
}

function canonicalTechniqueOrder(slug: string): number {
  const index = (IDEATION_TECHNIQUE_SLUGS as readonly string[]).indexOf(slug);
  return index >= 0 ? index : IDEATION_TECHNIQUE_SLUGS.length;
}

/**
 * Canonical scoring order: technique order, then candidate index, then id.
 * Batching and the configuration hash both depend on this being stable.
 */
export function sortCandidatesCanonically<T extends {
  technique_slug: string;
  candidate_index: number;
  candidate_id: string;
}>(candidates: T[]): T[] {
  return [...candidates].sort((left, right) => {
    const leftTechnique = canonicalTechniqueOrder(left.technique_slug);
    const rightTechnique = canonicalTechniqueOrder(right.technique_slug);
    if (leftTechnique !== rightTechnique) return leftTechnique - rightTechnique;
    if (left.candidate_index !== right.candidate_index) {
      return left.candidate_index - right.candidate_index;
    }
    return left.candidate_id.localeCompare(right.candidate_id);
  });
}

function evidenceSourceIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.source_ref !== "string" || row.source_ref.trim().length === 0) return null;
    if (typeof row.claim !== "string" || row.claim.trim().length === 0) return null;
    if (!Array.isArray(row.source_ids) || row.source_ids.length === 0) return null;
    for (const sourceId of row.source_ids) {
      if (typeof sourceId !== "string" || sourceId.trim().length === 0) return null;
      ids.add(sourceId);
    }
  }
  return [...ids].sort();
}

/**
 * Validates a cycle and its complete candidate set for scoring.
 *
 * Exact reconciliation, not an aggregate count: every allocated slot must be
 * present exactly once, and every supplied candidate must map to a slot the
 * cycle actually allocated.
 */
export function evaluateScoringEligibility(input: {
  clientId: string;
  cycle: ScoringCycleRow | null;
  techniqueRuns: ScoringTechniqueRunRow[];
  candidates: ScoringCandidateRow[];
}): ScoringEligibilityResult {
  const { clientId, cycle, techniqueRuns, candidates } = input;
  if (!cycle) return fail("CYCLE_NOT_FOUND", "The Ideation cycle was not found.");
  if (cycle.client_id !== clientId) {
    return fail("CYCLE_CLIENT_MISMATCH", "The Ideation cycle belongs to another client.");
  }
  if (cycle.status !== "completed") {
    return fail(
      "CYCLE_NOT_COMPLETED",
      `Only a completed Ideation cycle can be scored; this cycle is ${cycle.status}.`,
    );
  }
  if (cycle.shortfall_count !== 0) {
    return fail("CYCLE_SHORTFALL", "The Ideation cycle still reports missing candidates.");
  }
  if (cycle.candidate_count !== cycle.expected_candidate_count) {
    return fail(
      "CYCLE_COUNT_MISMATCH",
      "The Ideation cycle generated count does not equal its expected count.",
    );
  }

  const runsById = new Map(techniqueRuns.map((run) => [run.id, run]));
  for (const run of techniqueRuns) {
    if (run.client_id !== clientId || run.ideation_cycle_id !== cycle.id) {
      return fail("CANDIDATE_SET_INVALID", "A technique run does not belong to this cycle and client.");
    }
  }

  // Every slot the cycle allocated, as an exact multiset of (slug, index).
  const requiredSlots = new Set<string>();
  for (const [slug, slots] of Object.entries(cycle.slot_allocation ?? {})) {
    if (!Array.isArray(slots)) {
      return fail("CANDIDATE_SET_INVALID", "The cycle slot allocation is malformed.");
    }
    slots.forEach((_assetType, index) => requiredSlots.add(`${slug}#${index}`));
  }
  if (requiredSlots.size !== cycle.expected_candidate_count) {
    return fail(
      "CANDIDATE_SET_INVALID",
      "The cycle slot allocation does not match its expected candidate count.",
    );
  }

  const seenSlots = new Set<string>();
  const seenCandidateIds = new Set<string>();
  const resolved: EligibleScoringCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.client_id !== clientId) {
      return fail("CANDIDATE_CROSS_CLIENT", "A candidate belongs to another client.");
    }
    if (candidate.ideation_cycle_id !== cycle.id) {
      return fail("CANDIDATE_CROSS_CYCLE", "A candidate belongs to another Ideation cycle.");
    }
    const run = runsById.get(candidate.technique_run_id);
    if (!run) {
      return fail("CANDIDATE_SET_INVALID", "A candidate references an unknown technique run.");
    }
    if (seenCandidateIds.has(candidate.id)) {
      return fail("CANDIDATE_SLOT_DUPLICATE", "A candidate id appears more than once.");
    }
    seenCandidateIds.add(candidate.id);

    const slotKey = `${run.technique_slug}#${candidate.candidate_index}`;
    if (!requiredSlots.has(slotKey)) {
      return fail(
        "CANDIDATE_SET_INVALID",
        "A candidate occupies a slot the cycle did not allocate.",
      );
    }
    if (seenSlots.has(slotKey)) {
      return fail("CANDIDATE_SLOT_DUPLICATE", "Two candidates occupy the same allocated slot.");
    }
    seenSlots.add(slotKey);

    const allocated = (cycle.slot_allocation ?? {})[run.technique_slug];
    if (!Array.isArray(allocated) || allocated[candidate.candidate_index] !== candidate.asset_type) {
      return fail(
        "CANDIDATE_SET_INVALID",
        "A candidate asset type does not match its allocated slot.",
      );
    }

    const sourceIds = evidenceSourceIds(candidate.evidence_references);
    if (!sourceIds) {
      return fail("CANDIDATE_EVIDENCE_INVALID", "A candidate has missing or malformed evidence.");
    }
    if (!/^[0-9a-f]{64}$/.test(candidate.input_hash)) {
      return fail("CANDIDATE_EVIDENCE_INVALID", "A candidate has invalid generation provenance.");
    }

    resolved.push({
      candidate_id: candidate.id,
      technique_slug: run.technique_slug as IdeationTechniqueSlug,
      technique_run_id: run.id,
      candidate_index: candidate.candidate_index,
      asset_type: candidate.asset_type,
      working_title: candidate.working_title,
      hook: candidate.hook,
      core_message: candidate.core_message,
      psychological_angle: candidate.psychological_angle,
      cta: candidate.cta,
      evidence_references: candidate.evidence_references as Array<Record<string, unknown>>,
      evidence_source_ids: sourceIds,
    });
  }

  if (seenSlots.size !== requiredSlots.size) {
    return fail("CANDIDATE_SLOT_MISSING", "The candidate set does not fill every allocated slot.");
  }

  return { ok: true, candidates: sortCandidatesCanonically(resolved) };
}
