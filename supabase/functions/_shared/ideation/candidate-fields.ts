// Ideation candidate-field policy v2 — claim-first candidate contract.
//
// Root cause this replaces: the v1 contract graded all five candidate fields as
// if each were a factual proposition. But the five fields are three different
// kinds of thing:
//
//   - core_message and the evidence claims are factual propositions;
//   - working_title, hook, and cta are creative framing of those propositions;
//   - psychological_angle is strategic classification metadata.
//
// Requiring a creative hook or a strategy label to share source vocabulary made
// every field an independent chance to fail, so a fully correct candidate was
// rejected for wording that asserted nothing.
//
// The fix separates the categories. Facts are grounded once, in a bounded
// proposition registry validated under evidence policy v2. Creative fields then
// reference validated propositions and are checked for what they must NOT do:
// introduce a number, an outcome, a causal claim, a guarantee, a comparison, or
// any other high-risk assertion the propositions do not carry. Grounding is
// preserved exactly; only the place it is enforced moves.

import type { IdeationTechniqueSlug } from "./config.ts";

export const IDEATION_CANDIDATE_FIELD_POLICY_VERSION = "aa.ideation.candidate-fields.v2";
export const IDEATION_PROPOSITION_SCHEMA_VERSION = "aa.ideation.grounded-propositions.v1";
export const IDEATION_ANGLE_TAXONOMY_VERSION = "aa.ideation.psychological-angles.v1";
export const IDEATION_FIELD_REPAIR_POLICY_VERSION = "aa.ideation.field-repair.v1";

/* ------------------------------------------------------ field semantics */

export type IdeationCandidateFieldName =
  | "working_title"
  | "hook"
  | "core_message"
  | "psychological_angle"
  | "cta";

export type IdeationFieldSemantics =
  | "grounded_proposition"
  | "creative_framing"
  | "strategic_classification";

/** Exactly one semantic category per persisted candidate field. */
export const IDEATION_FIELD_SEMANTICS: Record<IdeationCandidateFieldName, IdeationFieldSemantics> = {
  working_title: "creative_framing",
  hook: "creative_framing",
  core_message: "grounded_proposition",
  psychological_angle: "strategic_classification",
  cta: "creative_framing",
};

export const IDEATION_CANDIDATE_FIELD_NAMES: readonly IdeationCandidateFieldName[] = [
  "working_title",
  "hook",
  "core_message",
  "psychological_angle",
  "cta",
] as const;

export const IDEATION_FIELD_LIMITS = Object.freeze({
  working_title: 300,
  hook: 1000,
  core_message: 3000,
  psychological_angle: 1000,
  cta: 1000,
  proposition_text: 1000,
  support_note: 500,
  max_propositions_per_candidate: 6,
  min_propositions_per_candidate: 1,
  max_units_per_proposition: 3,
  max_propositions_per_field: 3,
});

/* --------------------------------------------- psychological angle taxonomy */

export interface IdeationAngleDefinition {
  code: string;
  label: string;
  definition: string;
  /** Techniques this angle is a coherent classification for. */
  techniques: readonly IdeationTechniqueSlug[];
  incompatible_with?: readonly string[];
}

const ALL_TECHNIQUES: readonly IdeationTechniqueSlug[] = [
  "persona",
  "review-mined-pain-language",
  "competitor-objections",
  "end-customer-complaints",
  "live-objection-log",
  "trigger-event",
  "format-swipe",
] as const;

/**
 * Code-owned strategic classification. The model returns a code only; the
 * server owns the operator-facing label. A classification says how the idea
 * works, not what is true about the client, so it is deliberately NOT required
 * to appear in client authority.
 */
export const IDEATION_ANGLE_TAXONOMY: readonly IdeationAngleDefinition[] = Object.freeze([
  {
    code: "proof_visibility",
    label: "Proof visibility",
    definition: "Makes existing but unseen proof visible to the audience.",
    techniques: ALL_TECHNIQUES,
  },
  {
    code: "objection_resolution",
    label: "Objection resolution",
    definition: "Answers a stated buyer objection directly.",
    techniques: ["review-mined-pain-language", "competitor-objections", "end-customer-complaints", "live-objection-log", "persona"],
  },
  {
    code: "risk_reversal",
    label: "Risk reversal",
    definition: "Reduces the perceived risk of taking the next step.",
    techniques: ["competitor-objections", "live-objection-log", "persona"],
  },
  {
    code: "loss_aversion",
    label: "Loss aversion",
    definition: "Frames the cost of leaving the problem unaddressed.",
    techniques: ["review-mined-pain-language", "end-customer-complaints", "trigger-event", "persona"],
  },
  {
    code: "authority_signal",
    label: "Authority signal",
    definition: "Demonstrates competence or standing without asserting new results.",
    techniques: ALL_TECHNIQUES,
  },
  {
    code: "contrast",
    label: "Contrast",
    definition: "Sets two grounded states or approaches against each other.",
    techniques: ALL_TECHNIQUES,
  },
  {
    code: "specificity",
    label: "Specificity",
    definition: "Replaces a vague idea with a concrete, supported detail.",
    techniques: ALL_TECHNIQUES,
  },
  {
    code: "identity_alignment",
    label: "Identity alignment",
    definition: "Speaks to how the audience sees themselves.",
    techniques: ["persona", "review-mined-pain-language", "end-customer-complaints", "trigger-event"],
  },
  {
    code: "curiosity_gap",
    label: "Curiosity gap",
    definition: "Opens a question the content then answers.",
    techniques: ALL_TECHNIQUES,
  },
  {
    code: "trigger_event",
    label: "Trigger event",
    definition: "Anchors the idea to a moment that prompts action.",
    techniques: ["trigger-event", "persona", "live-objection-log"],
  },
  {
    code: "problem_agitation",
    label: "Problem agitation",
    definition: "Draws out a stated problem so its cost is felt.",
    techniques: ["review-mined-pain-language", "end-customer-complaints", "live-objection-log", "persona"],
  },
  {
    code: "practical_utility",
    label: "Practical utility",
    definition: "Gives the audience something immediately usable.",
    techniques: ALL_TECHNIQUES,
  },
  {
    code: "misconception_correction",
    label: "Misconception correction",
    definition: "Corrects a belief the audience holds that the authority contradicts.",
    techniques: ["competitor-objections", "review-mined-pain-language", "live-objection-log", "end-customer-complaints"],
  },
  {
    code: "behind_the_scenes",
    label: "Behind the scenes",
    definition: "Shows how the work is actually done.",
    techniques: ["format-swipe", "persona", "trigger-event"],
  },
  {
    code: "trust_transfer",
    label: "Trust transfer",
    definition: "Borrows credibility from an already-trusted reference point.",
    techniques: ["competitor-objections", "persona", "format-swipe"],
  },
] as const);

const ANGLE_BY_CODE = new Map(IDEATION_ANGLE_TAXONOMY.map((angle) => [angle.code, angle]));

export function ideationAngleDefinition(code: string): IdeationAngleDefinition | null {
  return ANGLE_BY_CODE.get(code) ?? null;
}

export function ideationAnglesForTechnique(slug: string): IdeationAngleDefinition[] {
  return IDEATION_ANGLE_TAXONOMY.filter((angle) =>
    (angle.techniques as readonly string[]).includes(slug)
  );
}

/**
 * Deterministic classification fallback. Permitted ONLY for the strategic
 * classification field, and only when the technique has exactly one coherent
 * default. It asserts no client fact, so it cannot fabricate content.
 */
export const IDEATION_ANGLE_TECHNIQUE_DEFAULT: Record<string, string> = {
  persona: "identity_alignment",
  "review-mined-pain-language": "problem_agitation",
  "competitor-objections": "objection_resolution",
  "end-customer-complaints": "problem_agitation",
  "live-objection-log": "objection_resolution",
  "trigger-event": "trigger_event",
  "format-swipe": "practical_utility",
};

export function defaultAngleForTechnique(slug: string): IdeationAngleDefinition | null {
  const code = IDEATION_ANGLE_TECHNIQUE_DEFAULT[slug];
  if (!code) return null;
  const angle = ideationAngleDefinition(code);
  if (!angle || !(angle.techniques as readonly string[]).includes(slug)) return null;
  return angle;
}

/* ------------------------------------------- creative-framing enforcement */

/**
 * Vocabulary that asserts something rather than framing it. A creative field
 * may use ordinary connective, rhetorical, and second-person language freely,
 * but any of these categories must be carried by a referenced proposition.
 */
export const IDEATION_HIGH_RISK_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = Object.freeze([
  { code: "guarantee", pattern: /\b(?:guarantee[ds]?|guarantees|promise[ds]?|assured?)\b/i },
  { code: "certainty", pattern: /\b(?:certainly|inevitabl[ey]|definitely)\b/i },
  { code: "superiority", pattern: /\b(?:best|better|superior|outperform\w*|beat(?:s|ing)?)\b/i },
  { code: "leadership", pattern: /\b(?:number\s+one|#1|market\s+leader|category\s+leader|leading\s+(?:agency|firm|provider))\b/i },
  { code: "fastest", pattern: /\b(?:fastest|quickest)\b/i },
  { code: "universal", pattern: /\b(?:always|never|every\s+\w+|everyone|nobody|all\s+(?:clients|customers|buyers|businesses))\b/i },
  { code: "competitor", pattern: /\bcompetitors?\b/i },
  { code: "outcome", pattern: /\b(?:revenue|profit|margins?|roi|sales|leads?|conversions?|pipeline|growth|grow(?:s|ing)?|double|triple|multiply|scale)\b/i },
  { code: "causal", pattern: /\b(?:causes?|caused|causing|results?\s+in|leads?\s+to|drives?|generates?|produces?|delivers?|ensures?|guarantees?)\b/i },
  { code: "scarcity", pattern: /\b(?:limited\s+(?:time|spots|places)|only\s+\d+\s+(?:spots|places|left)|last\s+chance|closing\s+soon|deadline)\b/i },
  { code: "urgency", pattern: /\b(?:act\s+now|today\s+only|hurry|don't\s+miss\s+out)\b/i },
]);

export function detectHighRiskCategories(value: string): string[] {
  return IDEATION_HIGH_RISK_PATTERNS
    .filter((entry) => entry.pattern.test(value))
    .map((entry) => entry.code);
}

/** Frozen policy manifest, hashed into the Stage 1 configuration snapshot. */
export const IDEATION_CANDIDATE_FIELD_MANIFEST = Object.freeze({
  policy_version: IDEATION_CANDIDATE_FIELD_POLICY_VERSION,
  proposition_schema_version: IDEATION_PROPOSITION_SCHEMA_VERSION,
  angle_taxonomy_version: IDEATION_ANGLE_TAXONOMY_VERSION,
  field_repair_policy_version: IDEATION_FIELD_REPAIR_POLICY_VERSION,
  semantics: IDEATION_FIELD_SEMANTICS,
  limits: IDEATION_FIELD_LIMITS,
  angle_codes: IDEATION_ANGLE_TAXONOMY.map((angle) => angle.code),
  angle_technique_defaults: IDEATION_ANGLE_TECHNIQUE_DEFAULT,
  high_risk_categories: IDEATION_HIGH_RISK_PATTERNS.map((entry) => entry.code),
  facts_are_grounded_once_in_propositions: true,
  creative_fields_may_not_introduce_facts: true,
  classification_is_code_owned: true,
  server_owns_angle_label: true,
  maximum_field_repairs_per_response: 1,
});
