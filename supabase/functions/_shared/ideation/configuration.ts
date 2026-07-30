import {
  IDEATION_EVIDENCE_POLICY_VERSION,
  IDEATION_SUPPORT_UNIT_PARSER_VERSION,
  IDEATION_SUPPORT_UNIT_SELECTION,
} from "./support-units.ts";
import {
  IDEATION_EVIDENCE_SELECTION_VERSION,
  IDEATION_EXECUTION_FILE_NUMBERS,
  IDEATION_MAX_ATTEMPTS,
  IDEATION_MODEL_CONFIGURATION,
  IDEATION_MODULE_VERSION,
  IDEATION_OUTPUT_SCHEMA_VERSION,
  IDEATION_PROMPT_VERSION,
  IDEATION_TECHNIQUE_MANIFEST,
  IDEATION_TECHNIQUE_MANIFEST_VERSION,
  IDEATION_TECHNIQUE_SLUGS,
} from "./config.ts";
import { sha256, stableJson } from "./hash.ts";
import { IDEATION_PROMPT_CONSTRUCTION_CONFIG } from "./model.ts";
import {
  ideationOutputTokenBudget,
  ideationTruncationCorrectionTokenBudget,
  IDEATION_OUTPUT_TOKEN_POLICY,
  IDEATION_PROVIDER_TIME_POLICY,
  resolveIdeationProviderRuntime,
} from "./provider-runtime.ts";

export interface IdeationConfigurationInput {
  clientId: string;
  clientName: string;
  period: Record<string, unknown>;
  quantityPlan: Record<string, unknown>;
  slotAllocation: Record<string, unknown>;
  authority: Record<string, unknown>;
  selectedModel: string;
}

export async function buildIdeationConfigurationSnapshot(input: IdeationConfigurationInput) {
  const techniqueManifest = IDEATION_TECHNIQUE_MANIFEST.map((technique) => ({
    ...technique,
    context_file_numbers: [...technique.context_file_numbers],
  }));
  const promptConstructionDigest = await sha256(stableJson(IDEATION_PROMPT_CONSTRUCTION_CONFIG));
  // The effective provider runtime and the deterministic output-token budgets
  // are recorded here so a semantically different configuration can never reuse
  // a completed run's idempotency identity.
  const providerRuntime = resolveIdeationProviderRuntime();
  const outputTokenBudgets = Object.fromEntries(
    Object.entries(input.slotAllocation).map(([slug, slots]) => {
      const slotCount = Array.isArray(slots) ? slots.length : 0;
      const budget = ideationOutputTokenBudget(slotCount);
      return [slug, {
        requested_slots: slotCount,
        max_output_tokens: budget,
        truncation_correction_max_output_tokens: ideationTruncationCorrectionTokenBudget(budget),
      }];
    }),
  );

  return {
    client: {
      id: input.clientId,
      display_name: input.clientName,
    },
    period: input.period,
    execution_months: [...((input.period.executionMonths as string[] | undefined) ?? [])],
    quantity_plan: input.quantityPlan,
    slot_allocation: input.slotAllocation,
    authority: input.authority,
    technique_manifest_version: IDEATION_TECHNIQUE_MANIFEST_VERSION,
    technique_manifest: techniqueManifest,
    canonical_technique_order: [...IDEATION_TECHNIQUE_SLUGS],
    // Evidence policy v2 participates in the hash: an existing v1 cycle can
    // never silently reuse the previous grounding contract.
    evidence_policy: {
      version: IDEATION_EVIDENCE_POLICY_VERSION,
      support_unit_parser_version: IDEATION_SUPPORT_UNIT_PARSER_VERSION,
      support_unit_selection: IDEATION_SUPPORT_UNIT_SELECTION,
    },
    evidence_selection: {
      version: IDEATION_EVIDENCE_SELECTION_VERSION,
      execution_file_numbers: [...IDEATION_EXECUTION_FILE_NUMBERS],
      per_technique_context_file_numbers: Object.fromEntries(
        techniqueManifest.map((technique) => [technique.slug, [...technique.context_file_numbers]]),
      ),
      source_policies: Object.fromEntries(
        techniqueManifest.map((technique) => [technique.slug, technique.source_policy]),
      ),
      approved_authority_only_in_pr1: true,
      external_provider: null,
      raw_html_allowed: false,
    },
    prompt: {
      version: IDEATION_PROMPT_VERSION,
      construction: IDEATION_PROMPT_CONSTRUCTION_CONFIG,
      construction_digest: promptConstructionDigest,
      effective_technique_focus: Object.fromEntries(
        techniqueManifest.map((technique) => [technique.slug, technique.effective_focus]),
      ),
    },
    model: {
      ...IDEATION_MODEL_CONFIGURATION,
      selected_model: input.selectedModel,
      time_budget_policy: IDEATION_PROVIDER_TIME_POLICY,
      output_token_policy: IDEATION_OUTPUT_TOKEN_POLICY,
      effective: {
        connect_timeout_ms: providerRuntime.connect_timeout_ms,
        call_timeout_ms: providerRuntime.call_timeout_ms,
        technique_deadline_ms: providerRuntime.technique_deadline_ms,
        minimum_correction_budget_ms: providerRuntime.minimum_correction_budget_ms,
        output_token_budgets: outputTokenBudgets,
      },
    },
    output_schema_version: IDEATION_OUTPUT_SCHEMA_VERSION,
    module_version: IDEATION_MODULE_VERSION,
    retry_policy: {
      max_attempts: IDEATION_MAX_ATTEMPTS,
      lease_seconds: providerRuntime.lease_seconds,
      heartbeat_interval_ms: providerRuntime.heartbeat_interval_ms,
      preserve_successful_candidates: true,
      retry_only_missing_slots: true,
      non_retryable_shortfall_is_terminal: true,
    },
  };
}

export async function hashIdeationConfiguration(snapshot: Record<string, unknown>): Promise<string> {
  return await sha256(stableJson(snapshot));
}
