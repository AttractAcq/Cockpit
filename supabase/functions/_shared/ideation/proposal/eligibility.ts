// Ideation Stage 3 — proposal eligibility and exact candidate/score reconciliation.
//
// A proposal is only ever offered a cycle Stage 1 completed exactly and a scoring
// run Stage 2 completed exactly. Anything partial, retryable, failed, mis-owned,
// or inconsistent fails closed here, before authority is reconstructed and before
// any provider call is made.

import { IDEATION_TECHNIQUE_SLUGS } from "../config.ts";
import type { IdeationAssetType } from "./slot-planner.ts";

export type ProposalEligibilityCode =
  | "CYCLE_NOT_FOUND"
  | "CYCLE_CLIENT_MISMATCH"
  | "CYCLE_NOT_ELIGIBLE"
  | "SCORING_RUN_NOT_FOUND"
  | "SCORING_RUN_CLIENT_MISMATCH"
  | "SCORING_RUN_CYCLE_MISMATCH"
  | "SCORING_RUN_NOT_ELIGIBLE"
  | "CANDIDATE_SET_INVALID"
  | "SCORE_SET_INVALID"
  | "RANKS_INVALID"
  | "CANDIDATE_SNAPSHOT_MISMATCH"
  | "PERIOD_MISMATCH";

export interface ProposalCycleRow {
  id: string;
  client_id: string;
  status: string;
  period_start: string;
  period_end: string;
  expected_candidate_count: number;
  candidate_count: number;
  shortfall_count: number;
  slot_allocation: Record<string, string[]>;
  quantity_plan: Record<string, unknown>;
  configuration_snapshot: Record<string, unknown>;
  input_hash: string;
}

export interface ProposalScoringRunRow {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  status: string;
  expected_candidate_count: number;
  scored_candidate_count: number;
  failed_candidate_count: number;
  configuration_hash: string;
  candidate_snapshot: unknown;
  rubric_slug: string;
  rubric_version: string;
}

export interface ProposalCandidateRow {
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

export interface ProposalScoreRow {
  id: string;
  client_id: string;
  ideation_cycle_id: string;
  scoring_run_id: string;
  candidate_id: string;
  candidate_content_hash: string;
  candidate_evidence_hash: string;
  overall_score: number;
  priority_band: string;
  rank: number | null;
  execution_plan_alignment: number;
  proof_and_evidence_strength: number;
  audience_and_pain_relevance: number;
  strengths: unknown;
  risks: unknown;
}

export interface EligibleProposalCandidate {
  candidate_id: string;
  candidate_score_id: string;
  technique_slug: string;
  candidate_index: number;
  asset_type: IdeationAssetType;
  working_title: string;
  hook: string;
  core_message: string;
  cta: string;
  evidence_source_ids: string[];
  candidate_content_hash: string;
  candidate_evidence_hash: string;
  rank: number;
  overall_score: number;
  priority_band: string;
  execution_plan_alignment: number;
  proof_and_evidence_strength: number;
  audience_and_pain_relevance: number;
  strengths: string[];
  risks: string[];
}

export type ProposalEligibilityResult =
  | {
    ok: true;
    candidates: EligibleProposalCandidate[];
    requiredByAssetType: Record<IdeationAssetType, number>;
  }
  | { ok: false; code: ProposalEligibilityCode; message: string };

function fail(code: ProposalEligibilityCode, message: string): ProposalEligibilityResult {
  return { ok: false, code, message };
}

function canonicalTechniqueOrder(slug: string): number {
  const index = (IDEATION_TECHNIQUE_SLUGS as readonly string[]).indexOf(slug);
  return index >= 0 ? index : IDEATION_TECHNIQUE_SLUGS.length;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function evidenceSourceIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (!Array.isArray(row.source_ids) || row.source_ids.length === 0) return null;
    for (const sourceId of row.source_ids) {
      if (typeof sourceId !== "string" || sourceId.trim().length === 0) return null;
      ids.add(sourceId);
    }
  }
  return [...ids].sort();
}

const ASSET_TYPES = new Set<string>(["reel", "carousel", "static", "story"]);

/**
 * Validates the full Stage 1 + Stage 2 chain for proposal generation.
 *
 * Exact reconciliation throughout: every allocated slot must carry exactly one
 * candidate, every candidate must carry exactly one score from the named scoring
 * run, ranks must be unique and gap-free 1..N, and each candidate's hashes must
 * still equal the immutable scoring snapshot.
 */
export function evaluateProposalEligibility(input: {
  clientId: string;
  cycle: ProposalCycleRow | null;
  scoringRun: ProposalScoringRunRow | null;
  techniqueRuns: Array<{ id: string; client_id: string; ideation_cycle_id: string; technique_slug: string }>;
  candidates: ProposalCandidateRow[];
  scores: ProposalScoreRow[];
}): ProposalEligibilityResult {
  const { clientId, cycle, scoringRun, techniqueRuns, candidates, scores } = input;

  if (!cycle) return fail("CYCLE_NOT_FOUND", "The Ideation cycle was not found.");
  if (cycle.client_id !== clientId) {
    return fail("CYCLE_CLIENT_MISMATCH", "The Ideation cycle belongs to another client.");
  }
  if (cycle.status !== "completed") {
    return fail("CYCLE_NOT_ELIGIBLE", `Only a completed Ideation cycle can be proposed; this cycle is ${cycle.status}.`);
  }
  if (cycle.shortfall_count !== 0 || cycle.candidate_count !== cycle.expected_candidate_count) {
    return fail("CYCLE_NOT_ELIGIBLE", "The Ideation cycle did not generate its full candidate set.");
  }

  if (!scoringRun) return fail("SCORING_RUN_NOT_FOUND", "The scoring run was not found.");
  if (scoringRun.client_id !== clientId) {
    return fail("SCORING_RUN_CLIENT_MISMATCH", "The scoring run belongs to another client.");
  }
  if (scoringRun.ideation_cycle_id !== cycle.id) {
    return fail("SCORING_RUN_CYCLE_MISMATCH", "The scoring run belongs to another Ideation cycle.");
  }
  if (scoringRun.status !== "completed") {
    return fail("SCORING_RUN_NOT_ELIGIBLE", `Only a completed scoring run can be proposed; this run is ${scoringRun.status}.`);
  }
  if (
    scoringRun.failed_candidate_count !== 0
    || scoringRun.scored_candidate_count !== scoringRun.expected_candidate_count
    || scoringRun.expected_candidate_count !== cycle.expected_candidate_count
  ) {
    return fail("SCORING_RUN_NOT_ELIGIBLE", "The scoring run did not score every candidate.");
  }

  const runsById = new Map(techniqueRuns.map((run) => [run.id, run]));
  for (const run of techniqueRuns) {
    if (run.client_id !== clientId || run.ideation_cycle_id !== cycle.id) {
      return fail("CANDIDATE_SET_INVALID", "A technique run does not belong to this cycle and client.");
    }
  }

  // Exact slot reconciliation against the immutable Stage 1 allocation.
  const requiredSlots = new Set<string>();
  const requiredByAssetType = { reel: 0, carousel: 0, static: 0, story: 0 } as Record<IdeationAssetType, number>;
  for (const [slug, allocated] of Object.entries(cycle.slot_allocation ?? {})) {
    if (!Array.isArray(allocated)) {
      return fail("CANDIDATE_SET_INVALID", "The cycle slot allocation is malformed.");
    }
    allocated.forEach((assetType, index) => {
      if (!ASSET_TYPES.has(assetType)) {
        throw new Error(`Unknown allocated asset type ${assetType}.`);
      }
      requiredSlots.add(`${slug}#${index}`);
      requiredByAssetType[assetType as IdeationAssetType] += 1;
    });
  }
  if (requiredSlots.size !== cycle.expected_candidate_count) {
    return fail("CANDIDATE_SET_INVALID", "The cycle slot allocation does not match its expected candidate count.");
  }

  const scoresByCandidate = new Map<string, ProposalScoreRow>();
  for (const score of scores) {
    if (score.scoring_run_id !== scoringRun.id) continue;
    if (score.client_id !== clientId || score.ideation_cycle_id !== cycle.id) {
      return fail("SCORE_SET_INVALID", "A score does not belong to this cycle and client.");
    }
    if (scoresByCandidate.has(score.candidate_id)) {
      return fail("SCORE_SET_INVALID", "A candidate carries more than one score in this scoring run.");
    }
    scoresByCandidate.set(score.candidate_id, score);
  }
  if (scoresByCandidate.size !== cycle.expected_candidate_count) {
    return fail("SCORE_SET_INVALID", "The scoring run does not carry exactly one score per candidate.");
  }

  // The immutable Stage 2 candidate snapshot must still describe these candidates.
  const snapshot = Array.isArray(scoringRun.candidate_snapshot)
    ? scoringRun.candidate_snapshot as Array<Record<string, unknown>>
    : null;
  if (!snapshot || snapshot.length !== cycle.expected_candidate_count) {
    return fail("CANDIDATE_SNAPSHOT_MISMATCH", "The scoring run candidate snapshot is missing or malformed.");
  }
  const snapshotByCandidate = new Map(
    snapshot.map((entry) => [String(entry.candidate_id), entry]),
  );

  const seenSlots = new Set<string>();
  const resolved: EligibleProposalCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.client_id !== clientId || candidate.ideation_cycle_id !== cycle.id) {
      return fail("CANDIDATE_SET_INVALID", "A candidate does not belong to this cycle and client.");
    }
    const run = runsById.get(candidate.technique_run_id);
    if (!run) return fail("CANDIDATE_SET_INVALID", "A candidate references an unknown technique run.");

    const slotKey = `${run.technique_slug}#${candidate.candidate_index}`;
    if (!requiredSlots.has(slotKey)) {
      return fail("CANDIDATE_SET_INVALID", "A candidate occupies a slot the cycle did not allocate.");
    }
    if (seenSlots.has(slotKey)) {
      return fail("CANDIDATE_SET_INVALID", "Two candidates occupy the same allocated slot.");
    }
    seenSlots.add(slotKey);

    const allocated = (cycle.slot_allocation ?? {})[run.technique_slug];
    if (!Array.isArray(allocated) || allocated[candidate.candidate_index] !== candidate.asset_type) {
      return fail("CANDIDATE_SET_INVALID", "A candidate asset type does not match its allocated slot.");
    }

    const score = scoresByCandidate.get(candidate.id);
    if (!score) return fail("SCORE_SET_INVALID", "A candidate has no score in this scoring run.");

    const snapshotEntry = snapshotByCandidate.get(candidate.id);
    if (!snapshotEntry) {
      return fail("CANDIDATE_SNAPSHOT_MISMATCH", "A candidate is absent from the scoring run snapshot.");
    }
    if (
      snapshotEntry.content_hash !== score.candidate_content_hash
      || snapshotEntry.evidence_hash !== score.candidate_evidence_hash
    ) {
      return fail("CANDIDATE_SNAPSHOT_MISMATCH", "A candidate hash no longer matches the scoring snapshot.");
    }

    const sourceIds = evidenceSourceIds(candidate.evidence_references);
    if (!sourceIds) {
      return fail("CANDIDATE_SET_INVALID", "A candidate has missing or malformed evidence.");
    }
    if (score.rank === null || !Number.isInteger(score.rank)) {
      return fail("RANKS_INVALID", "A candidate score carries no rank.");
    }

    resolved.push({
      candidate_id: candidate.id,
      candidate_score_id: score.id,
      technique_slug: run.technique_slug,
      candidate_index: candidate.candidate_index,
      asset_type: candidate.asset_type as IdeationAssetType,
      working_title: candidate.working_title,
      hook: candidate.hook,
      core_message: candidate.core_message,
      cta: candidate.cta,
      evidence_source_ids: sourceIds,
      candidate_content_hash: score.candidate_content_hash,
      candidate_evidence_hash: score.candidate_evidence_hash,
      rank: score.rank,
      overall_score: score.overall_score,
      priority_band: score.priority_band,
      execution_plan_alignment: score.execution_plan_alignment,
      proof_and_evidence_strength: score.proof_and_evidence_strength,
      audience_and_pain_relevance: score.audience_and_pain_relevance,
      strengths: stringArray(score.strengths),
      risks: stringArray(score.risks),
    });
  }

  if (seenSlots.size !== requiredSlots.size) {
    return fail("CANDIDATE_SET_INVALID", "The candidate set does not fill every allocated slot.");
  }

  // Ranks must be unique and gap-free from 1 through N.
  const ranks = resolved.map((candidate) => candidate.rank).sort((a, b) => a - b);
  for (let index = 0; index < ranks.length; index += 1) {
    if (ranks[index] !== index + 1) {
      return fail("RANKS_INVALID", "Scoring ranks are not unique and gap-free from 1.");
    }
  }

  resolved.sort((left, right) => {
    const leftTechnique = canonicalTechniqueOrder(left.technique_slug);
    const rightTechnique = canonicalTechniqueOrder(right.technique_slug);
    if (leftTechnique !== rightTechnique) return leftTechnique - rightTechnique;
    if (left.candidate_index !== right.candidate_index) return left.candidate_index - right.candidate_index;
    return left.candidate_id.localeCompare(right.candidate_id);
  });

  return { ok: true, candidates: resolved, requiredByAssetType };
}
