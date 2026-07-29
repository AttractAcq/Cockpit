// Ideation Stage 3 — proposal configuration snapshot and idempotency hash.
//
// Every material proposal input is hashed. A change to the scoring run, any
// candidate, any score, the authority identity, the Calendar conflict snapshot,
// the slot planner, the prompt, the model, or the batch strategy produces a
// different hash, so an existing proposal can never be silently reused for a
// semantically different basis. Request ids, lease tokens, timestamps, and
// worker state are excluded.

import { sha256, stableJson } from "../hash.ts";
import {
  IDEATION_OUTPUT_TOKEN_POLICY,
  IDEATION_PROVIDER_TIME_POLICY,
  resolveIdeationProviderRuntime,
} from "../provider-runtime.ts";
import {
  ideationProposalOutputTokenBudget,
  IDEATION_PROPOSAL_BATCH_POLICY,
  IDEATION_PROPOSAL_MODEL_CONFIGURATION,
  IDEATION_PROPOSAL_MODULE_VERSION,
  IDEATION_PROPOSAL_OUTPUT_SCHEMA_VERSION,
  IDEATION_PROPOSAL_OUTPUT_TOKEN_POLICY,
  IDEATION_PROPOSAL_PROMPT_VERSION,
  IDEATION_PROPOSAL_RETRY_POLICY,
} from "./config.ts";
import { IDEATION_PROPOSAL_PROMPT_CONSTRUCTION } from "./model.ts";
import {
  IDEATION_SLOT_PLANNER_MANIFEST,
  IDEATION_SLOT_PLANNER_VERSION,
  type IdeationAssetType,
  type ProposalSlot,
} from "./slot-planner.ts";
import type { CalendarConflictSnapshot } from "./conflicts.ts";
import type { EligibleProposalCandidate } from "./eligibility.ts";
import type { ReconstructedScoringAuthority } from "../scoring/authority.ts";

export interface ProposalCandidateFingerprint {
  candidate_id: string;
  candidate_score_id: string;
  technique_slug: string;
  candidate_index: number;
  asset_type: IdeationAssetType;
  content_hash: string;
  evidence_hash: string;
  rank: number;
  overall_score: number;
  execution_plan_alignment: number;
  proof_and_evidence_strength: number;
  audience_and_pain_relevance: number;
}

/**
 * Immutable fingerprint of one candidate as proposal input. Covers the Stage 2
 * hashes plus the scheduling-relevant score dimensions, so a re-score that moves
 * a candidate's rank or its scheduling dimensions changes the proposal hash.
 */
export function fingerprintProposalCandidates(
  candidates: EligibleProposalCandidate[],
): ProposalCandidateFingerprint[] {
  return candidates.map((candidate) => ({
    candidate_id: candidate.candidate_id,
    candidate_score_id: candidate.candidate_score_id,
    technique_slug: candidate.technique_slug,
    candidate_index: candidate.candidate_index,
    asset_type: candidate.asset_type,
    content_hash: candidate.candidate_content_hash,
    evidence_hash: candidate.candidate_evidence_hash,
    rank: candidate.rank,
    overall_score: candidate.overall_score,
    execution_plan_alignment: candidate.execution_plan_alignment,
    proof_and_evidence_strength: candidate.proof_and_evidence_strength,
    audience_and_pain_relevance: candidate.audience_and_pain_relevance,
  }));
}

export interface ProposalConfigurationInput {
  clientId: string;
  ideationCycleId: string;
  cycleInputHash: string;
  scoringRunId: string;
  scoringConfigurationHash: string;
  rubricSlug: string;
  rubricVersion: string;
  periodStart: string;
  periodEnd: string;
  quantityPlan: Record<string, unknown>;
  requiredByAssetType: Record<IdeationAssetType, number>;
  candidates: ProposalCandidateFingerprint[];
  slots: ProposalSlot[];
  scheduleContractSource: string;
  scheduleContractFile: string | null;
  conflictSnapshot: CalendarConflictSnapshot;
  authority: ReconstructedScoringAuthority;
  selectedModel: string;
}

export async function buildProposalConfigurationSnapshot(input: ProposalConfigurationInput) {
  const providerRuntime = resolveIdeationProviderRuntime();
  const promptDigest = await sha256(stableJson(IDEATION_PROPOSAL_PROMPT_CONSTRUCTION));
  const plannerDigest = await sha256(stableJson(IDEATION_SLOT_PLANNER_MANIFEST));
  return {
    stage: "ideation.stage-3.proposed-calendar",
    module_version: IDEATION_PROPOSAL_MODULE_VERSION,
    output_schema_version: IDEATION_PROPOSAL_OUTPUT_SCHEMA_VERSION,
    client: { id: input.clientId },
    ideation_cycle: { id: input.ideationCycleId, input_hash: input.cycleInputHash },
    scoring_run: {
      id: input.scoringRunId,
      configuration_hash: input.scoringConfigurationHash,
      rubric_slug: input.rubricSlug,
      rubric_version: input.rubricVersion,
    },
    period: {
      start: input.periodStart,
      end: input.periodEnd,
      inclusive: true,
      quantity_plan: input.quantityPlan,
      required_by_asset_type: input.requiredByAssetType,
    },
    candidates: input.candidates.map((candidate) => ({ ...candidate })),
    slot_planner: {
      version: IDEATION_SLOT_PLANNER_VERSION,
      manifest: IDEATION_SLOT_PLANNER_MANIFEST,
      digest: plannerDigest,
      schedule_contract_source: input.scheduleContractSource,
      schedule_contract_file: input.scheduleContractFile,
    },
    slot_manifest: input.slots.map((slot) => ({ ...slot })),
    calendar_conflict_snapshot: {
      version: input.conflictSnapshot.version,
      digest: input.conflictSnapshot.digest,
      captured_row_count: input.conflictSnapshot.captured_row_count,
      period_start: input.conflictSnapshot.period_start,
      period_end: input.conflictSnapshot.period_end,
    },
    authority: {
      context: input.authority.verified.context.map((entry) => ({ ...entry })),
      strategic_playbooks: input.authority.verified.strategic_playbooks.map((entry) => ({ ...entry })),
      execution: input.authority.verified.execution.map((entry) => ({ ...entry })),
    },
    prompt: {
      version: IDEATION_PROPOSAL_PROMPT_VERSION,
      construction: IDEATION_PROPOSAL_PROMPT_CONSTRUCTION,
      digest: promptDigest,
    },
    model: {
      ...IDEATION_PROPOSAL_MODEL_CONFIGURATION,
      selected_model: input.selectedModel,
      time_budget_policy: IDEATION_PROVIDER_TIME_POLICY,
      generation_output_token_policy: IDEATION_OUTPUT_TOKEN_POLICY,
      proposal_output_token_policy: IDEATION_PROPOSAL_OUTPUT_TOKEN_POLICY,
      effective: {
        connect_timeout_ms: providerRuntime.connect_timeout_ms,
        call_timeout_ms: providerRuntime.call_timeout_ms,
        technique_deadline_ms: providerRuntime.technique_deadline_ms,
        minimum_correction_budget_ms: providerRuntime.minimum_correction_budget_ms,
        batch_output_tokens: ideationProposalOutputTokenBudget(
          Math.min(IDEATION_PROPOSAL_BATCH_POLICY.batch_size, Math.max(input.slots.length, 1)),
        ),
      },
    },
    batch_policy: IDEATION_PROPOSAL_BATCH_POLICY,
    retry_policy: {
      ...IDEATION_PROPOSAL_RETRY_POLICY,
      lease_seconds: providerRuntime.lease_seconds,
      heartbeat_interval_ms: providerRuntime.heartbeat_interval_ms,
    },
  };
}

export async function hashProposalConfiguration(snapshot: Record<string, unknown>): Promise<string> {
  return await sha256(stableJson(snapshot));
}
