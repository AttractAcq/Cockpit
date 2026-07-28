// Ideation Stage 2 — scoring configuration snapshot and idempotency hash.
//
// Every material scoring input is hashed. A change to any candidate's text or
// evidence, to the rubric, prompt, model, provider budgets, batch strategy, or
// to the cycle's authority identity produces a different hash — so an existing
// scoring run can never be silently reused for a semantically different basis.
// Request ids, lease tokens, timestamps, and worker state are excluded.

import { sha256, stableJson } from "../hash.ts";
import {
  IDEATION_OUTPUT_TOKEN_POLICY,
  IDEATION_PROVIDER_TIME_POLICY,
  resolveIdeationProviderRuntime,
} from "../provider-runtime.ts";
import {
  IDEATION_SCORING_BATCH_POLICY,
  IDEATION_SCORING_MODEL_CONFIGURATION,
  IDEATION_SCORING_MODULE_VERSION,
  IDEATION_SCORING_OUTPUT_TOKEN_POLICY,
  IDEATION_SCORING_PROMPT_VERSION,
  IDEATION_SCORING_RETRY_POLICY,
  ideationScoringOutputTokenBudget,
} from "./config.ts";
import { IDEATION_SCORING_PROMPT_CONSTRUCTION } from "./model.ts";
import {
  IDEATION_SCORING_OUTPUT_SCHEMA_VERSION,
  IDEATION_SCORING_RUBRIC_MANIFEST,
  IDEATION_SCORING_RUBRIC_SLUG,
  IDEATION_SCORING_RUBRIC_VERSION,
} from "./rubric.ts";
import type { EligibleScoringCandidate } from "./eligibility.ts";
import type { ReconstructedScoringAuthority } from "./authority.ts";

export interface ScoringCandidateFingerprint {
  candidate_id: string;
  technique_slug: string;
  candidate_index: number;
  asset_type: string;
  content_hash: string;
  evidence_hash: string;
  evidence_source_ids: string[];
}

/**
 * Immutable fingerprint of one candidate as scoring input.
 *
 * `content_hash` covers every persisted candidate field, so any edit to the
 * candidate text invalidates the scoring run. `evidence_hash` covers the full
 * evidence array, so an evidence change does the same.
 */
export async function fingerprintScoringCandidate(
  candidate: EligibleScoringCandidate,
): Promise<ScoringCandidateFingerprint> {
  const contentHash = await sha256(stableJson({
    candidate_id: candidate.candidate_id,
    technique_slug: candidate.technique_slug,
    candidate_index: candidate.candidate_index,
    asset_type: candidate.asset_type,
    working_title: candidate.working_title,
    hook: candidate.hook,
    core_message: candidate.core_message,
    psychological_angle: candidate.psychological_angle,
    cta: candidate.cta,
  }));
  const evidenceHash = await sha256(stableJson(candidate.evidence_references));
  return {
    candidate_id: candidate.candidate_id,
    technique_slug: candidate.technique_slug,
    candidate_index: candidate.candidate_index,
    asset_type: candidate.asset_type,
    content_hash: contentHash,
    evidence_hash: evidenceHash,
    evidence_source_ids: [...candidate.evidence_source_ids],
  };
}

export async function fingerprintScoringCandidates(
  candidates: EligibleScoringCandidate[],
): Promise<ScoringCandidateFingerprint[]> {
  return await Promise.all(candidates.map(fingerprintScoringCandidate));
}

export interface ScoringConfigurationInput {
  clientId: string;
  ideationCycleId: string;
  cycleInputHash: string;
  candidates: ScoringCandidateFingerprint[];
  authority: ReconstructedScoringAuthority;
  selectedModel: string;
}

export async function buildScoringConfigurationSnapshot(input: ScoringConfigurationInput) {
  const providerRuntime = resolveIdeationProviderRuntime();
  const promptDigest = await sha256(stableJson(IDEATION_SCORING_PROMPT_CONSTRUCTION));
  const rubricDigest = await sha256(stableJson(IDEATION_SCORING_RUBRIC_MANIFEST));
  return {
    stage: "ideation.stage-2.score-and-sort",
    module_version: IDEATION_SCORING_MODULE_VERSION,
    output_schema_version: IDEATION_SCORING_OUTPUT_SCHEMA_VERSION,
    client: { id: input.clientId },
    ideation_cycle: {
      id: input.ideationCycleId,
      input_hash: input.cycleInputHash,
    },
    candidates: input.candidates.map((candidate) => ({ ...candidate })),
    authority: {
      context: input.authority.verified.context.map((entry) => ({ ...entry })),
      strategic_playbooks: input.authority.verified.strategic_playbooks.map((entry) => ({ ...entry })),
      execution: input.authority.verified.execution.map((entry) => ({ ...entry })),
    },
    rubric: {
      slug: IDEATION_SCORING_RUBRIC_SLUG,
      version: IDEATION_SCORING_RUBRIC_VERSION,
      manifest: IDEATION_SCORING_RUBRIC_MANIFEST,
      digest: rubricDigest,
    },
    prompt: {
      version: IDEATION_SCORING_PROMPT_VERSION,
      construction: IDEATION_SCORING_PROMPT_CONSTRUCTION,
      digest: promptDigest,
    },
    model: {
      ...IDEATION_SCORING_MODEL_CONFIGURATION,
      selected_model: input.selectedModel,
      time_budget_policy: IDEATION_PROVIDER_TIME_POLICY,
      generation_output_token_policy: IDEATION_OUTPUT_TOKEN_POLICY,
      scoring_output_token_policy: IDEATION_SCORING_OUTPUT_TOKEN_POLICY,
      effective: {
        connect_timeout_ms: providerRuntime.connect_timeout_ms,
        call_timeout_ms: providerRuntime.call_timeout_ms,
        technique_deadline_ms: providerRuntime.technique_deadline_ms,
        minimum_correction_budget_ms: providerRuntime.minimum_correction_budget_ms,
        batch_output_tokens: ideationScoringOutputTokenBudget(
          Math.min(IDEATION_SCORING_BATCH_POLICY.batch_size, Math.max(input.candidates.length, 1)),
        ),
      },
    },
    batch_policy: IDEATION_SCORING_BATCH_POLICY,
    retry_policy: {
      ...IDEATION_SCORING_RETRY_POLICY,
      lease_seconds: providerRuntime.lease_seconds,
      heartbeat_interval_ms: providerRuntime.heartbeat_interval_ms,
    },
  };
}

export async function hashScoringConfiguration(snapshot: Record<string, unknown>): Promise<string> {
  return await sha256(stableJson(snapshot));
}
