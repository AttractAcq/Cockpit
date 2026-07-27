export const IDEATION_TECHNIQUE_SLUGS = [
  "persona",
  "review-mined-pain-language",
  "competitor-objections",
  "end-customer-complaints",
  "live-objection-log",
  "trigger-event",
  "format-swipe",
] as const;

export type IdeationTechniqueSlug = typeof IDEATION_TECHNIQUE_SLUGS[number];

export type IdeationTechniqueRole =
  | "standing_reference"
  | "sourcing"
  | "dormant"
  | "event_triggered";

export interface IdeationTechniqueDefinition {
  slug: IdeationTechniqueSlug;
  name: string;
  version: number;
  order: number;
  role: IdeationTechniqueRole;
  cadence: "weekly" | "monthly" | "continuous" | "dormant";
  mechanism_type: "approved_authority" | "manual_log" | "event_triggered";
  prompt_template: string;
  source_policy: Record<string, unknown>;
  output_schema_version: string;
  model_policy: Record<string, unknown>;
  module_version: string;
  source_title: string;
  context_file_numbers: readonly number[];
  effective_focus: string;
}

export const IDEATION_SOURCING_SLUGS = [
  "review-mined-pain-language",
  "competitor-objections",
  "end-customer-complaints",
] as const satisfies readonly IdeationTechniqueSlug[];

export const IDEATION_TECHNIQUE_MANIFEST_VERSION = "aa.ideation-techniques.v1.2";
export const IDEATION_MODULE_VERSION = "ideation-modules.v1.2";
export const IDEATION_PROMPT_VERSION = "ideation-period.v1.2";
export const IDEATION_OUTPUT_SCHEMA_VERSION = "ideation-candidates.v1.1";
export const IDEATION_QUANTITY_SCHEMA_VERSION = "aa.ideation.quantity.v1";
export const IDEATION_EVIDENCE_SELECTION_VERSION = "aa.ideation.evidence-selection.v1";
export const IDEATION_EXECUTION_FILE_NUMBERS = [1, 2, 4, 5, 11] as const;
export const IDEATION_LEASE_SECONDS = 180;
export const IDEATION_MAX_ATTEMPTS = 3;
export const IDEATION_MODEL_CONFIGURATION = Object.freeze({
  provider: "anthropic",
  primary_model_env: "AA_IDEATION_AI_MODEL",
  fallback_model_env: "AA_PHASE2_AI_MODEL",
  fallback_model: "claude-sonnet-4-6",
  temperature: null,
  initial_timeout_ms: 90_000,
  format_retry_timeout_ms: 35_000,
  format_retries: 1,
  max_tokens_floor: 2_200,
  max_tokens_per_candidate: 460,
  max_tokens_cap: 12_000,
  reject_max_token_truncation: true,
});

const SOURCE_POLICY = Object.freeze({
  mode: "approved_authority",
  raw_html_allowed: false,
  max_excerpt_chars: 8000,
});
const MODEL_POLICY = Object.freeze({
  provider: "anthropic",
  model_env: "AA_IDEATION_AI_MODEL",
  attempt_timeout_ms: 90_000,
  format_retry_timeout_ms: 35_000,
  format_retries: 1,
});

export const IDEATION_TECHNIQUE_MANIFEST: readonly IdeationTechniqueDefinition[] = Object.freeze([
  {
    slug: "persona", name: "Persona", version: 2, order: 1,
    role: "standing_reference", cadence: "monthly", mechanism_type: "approved_authority",
    prompt_template: "Build a persona-fit reference from approved buyer authority without producing candidate topics.",
    source_policy: SOURCE_POLICY, output_schema_version: "ideation-reference.v1",
    model_policy: MODEL_POLICY, module_version: IDEATION_MODULE_VERSION,
    source_title: "Approved Persona Authority",
    context_file_numbers: [0, 1, 2, 3, 6],
    effective_focus: "Standing buyer hypothesis and researched-objection reference for persona fit.",
  },
  {
    slug: "review-mined-pain-language", name: "Review-Mined Pain Language", version: 2, order: 2,
    role: "sourcing", cadence: "weekly", mechanism_type: "approved_authority",
    prompt_template: "Generate candidates grounded in supplied pain language, objections, and desired outcomes.",
    source_policy: SOURCE_POLICY, output_schema_version: IDEATION_OUTPUT_SCHEMA_VERSION,
    model_policy: MODEL_POLICY, module_version: IDEATION_MODULE_VERSION,
    source_title: "Approved Pain-Language Authority",
    context_file_numbers: [2, 3, 4, 5, 6],
    effective_focus: "Pain language, objections, feared outcomes, desired outcomes, and supported phrasing.",
  },
  {
    slug: "competitor-objections", name: "Competitor Objections", version: 2, order: 3,
    role: "sourcing", cadence: "weekly", mechanism_type: "approved_authority",
    prompt_template: "Generate candidates grounded in supported category scepticism and competitor objections.",
    source_policy: SOURCE_POLICY, output_schema_version: IDEATION_OUTPUT_SCHEMA_VERSION,
    model_policy: MODEL_POLICY, module_version: IDEATION_MODULE_VERSION,
    source_title: "Approved Competitor-Objection Authority",
    context_file_numbers: [1, 2, 3, 6, 11],
    effective_focus: "Supported competitor objections, category resistance, and scepticism.",
  },
  {
    slug: "end-customer-complaints", name: "End-Customer Complaints", version: 2, order: 4,
    role: "sourcing", cadence: "weekly", mechanism_type: "approved_authority",
    prompt_template: "Generate candidates grounded in supported end-customer complaints.",
    source_policy: SOURCE_POLICY, output_schema_version: IDEATION_OUTPUT_SCHEMA_VERSION,
    model_policy: MODEL_POLICY, module_version: IDEATION_MODULE_VERSION,
    source_title: "Approved End-Customer Complaint Authority",
    context_file_numbers: [1, 2, 3, 6, 9, 10],
    effective_focus: "Supported end-customer complaints the service-business audience can prevent or solve.",
  },
  {
    slug: "live-objection-log", name: "Live Objection Log", version: 1, order: 5,
    role: "dormant", cadence: "dormant", mechanism_type: "manual_log",
    prompt_template: "Return no_source until an approved live objection source exists.",
    source_policy: { mode: "unavailable", raw_html_allowed: false },
    output_schema_version: "ideation-no-source.v1", model_policy: {},
    module_version: IDEATION_MODULE_VERSION,
    source_title: "Live Objection Log",
    context_file_numbers: [],
    effective_focus: "No source",
  },
  {
    slug: "trigger-event", name: "Trigger Event", version: 1, order: 6,
    role: "event_triggered", cadence: "continuous", mechanism_type: "event_triggered",
    prompt_template: "Return inactive in PR 1; event sourcing and slot policy are deferred.",
    source_policy: { mode: "inactive", raw_html_allowed: false },
    output_schema_version: "ideation-inactive.v1", model_policy: {},
    module_version: IDEATION_MODULE_VERSION,
    source_title: "Trigger Event",
    context_file_numbers: [],
    effective_focus: "Inactive",
  },
  {
    slug: "format-swipe", name: "Format Swipe", version: 1, order: 7,
    role: "standing_reference", cadence: "monthly", mechanism_type: "approved_authority",
    prompt_template: "Build a structural and pacing reference from approved brand and content systems.",
    source_policy: SOURCE_POLICY, output_schema_version: "ideation-reference.v1",
    model_policy: MODEL_POLICY, module_version: IDEATION_MODULE_VERSION,
    source_title: "Approved Format and Pacing Authority",
    context_file_numbers: [7, 9, 10, 14],
    effective_focus: "Standing structural, voice, and pacing reference. It is not a topic source.",
  },
]);

export function isIdeationTechniqueSlug(value: string): value is IdeationTechniqueSlug {
  return (IDEATION_TECHNIQUE_SLUGS as readonly string[]).includes(value);
}

export function ideationTechniqueDefinition(slug: IdeationTechniqueSlug): IdeationTechniqueDefinition {
  const definition = IDEATION_TECHNIQUE_MANIFEST.find((technique) => technique.slug === slug);
  if (!definition) throw new Error(`Missing canonical Ideation technique ${slug}.`);
  return definition;
}
