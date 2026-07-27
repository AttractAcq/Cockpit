import {
  IDEATION_EVIDENCE_SELECTION_VERSION,
  IDEATION_EXECUTION_FILE_NUMBERS,
  IDEATION_LEASE_SECONDS,
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
    },
    output_schema_version: IDEATION_OUTPUT_SCHEMA_VERSION,
    module_version: IDEATION_MODULE_VERSION,
    retry_policy: {
      max_attempts: IDEATION_MAX_ATTEMPTS,
      lease_seconds: IDEATION_LEASE_SECONDS,
      preserve_successful_candidates: true,
      retry_only_missing_slots: true,
      non_retryable_shortfall_is_terminal: true,
    },
  };
}

export async function hashIdeationConfiguration(snapshot: Record<string, unknown>): Promise<string> {
  return await sha256(stableJson(snapshot));
}
