import type { IdeationEvidenceSource } from "./evidence.ts";
import {
  IDEATION_CLAIM_CARD_CONSTRUCTION_VERSION,
  IDEATION_CLAIM_CARD_MANIFEST,
  IDEATION_CLAIM_CARD_POLICY_VERSION,
  IDEATION_PERMISSION_LEDGER_VERSION,
  IDEATION_CANDIDATE_OUTPUT_SCHEMA_VERSION,
  type IdeationClaimCard,
} from "./claim-cards.ts";
import {
  defaultAngleForTechnique,
  IDEATION_ANGLE_TAXONOMY_VERSION,
  IDEATION_CANDIDATE_FIELD_POLICY_VERSION,
  IDEATION_PROPOSITION_SCHEMA_VERSION,
  detectHighRiskCategories,
  ideationAngleDefinition,
  IDEATION_CANDIDATE_FIELD_NAMES,
  IDEATION_FIELD_LIMITS,
  type IdeationAngleDefinition,
  type IdeationCandidateFieldName,
} from "./candidate-fields.ts";
import {
  quotableSpansForUnit,
  supportTextForUnit,
  type IdeationSupportUnit,
} from "./support-units.ts";
import type { IdeationAssetType } from "./period.ts";

export type IdeationEvidenceType = "exact_quote" | "paraphrase" | "derived_claim";

export interface GeneratedEvidenceReference {
  /** Evidence policy v2: the registered units this reference cites. */
  support_unit_ids?: string[];
  evidence_type: IdeationEvidenceType;
  source_ids: string[];
  source_ref: string;
  source_url: string;
  claim: string;
  quoted_text?: string;
  support_span?: string;
  support_note?: string;
  reasoning_note?: string;
}

export interface GeneratedIdeationCandidate {
  asset_type: IdeationAssetType;
  working_title: string;
  hook: string;
  core_message: string;
  psychological_angle: string;
  cta: string;
  evidence_references: GeneratedEvidenceReference[];
}

const ASSET_TYPES = new Set<IdeationAssetType>(["reel", "carousel", "static", "story"]);
const EVIDENCE_TYPES = new Set<IdeationEvidenceType>(["exact_quote", "paraphrase", "derived_claim"]);
const PROHIBITED_KEYS = new Set([
  "score", "rank", "ranking", "calendar_date", "distribution_date", "master_ref",
  "production_brief", "storyboard", "shot_list", "render_instructions",
]);

export function classifyIdeationProviderError(error: string): "ANTHROPIC_TIMEOUT" | "ANTHROPIC_PROVIDER_ERROR" {
  return error.toLowerCase().includes("timed out")
    ? "ANTHROPIC_TIMEOUT"
    : "ANTHROPIC_PROVIDER_ERROR";
}

export function extractIdeationJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text.trim());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
    if (fenced) {
      try {
        const parsed = JSON.parse(fenced[1]);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null;
      } catch { /* continue */ }
    }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed as Record<string, unknown>
          : null;
      } catch { /* invalid */ }
    }
    return null;
  }
}

function hasProhibitedKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasProhibitedKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
    PROHIBITED_KEYS.has(key.toLowerCase()) || hasProhibitedKey(item)
  );
}

function requiredString(
  row: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength
    ? value.trim()
    : null;
}

function optionalString(
  row: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = row[key];
  if (value === undefined || value === null || value === "") return null;
  return requiredString(row, key, maxLength);
}

function normalizedSupport(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

const SUPPORT_STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "before", "being", "could", "does",
  "from", "have", "into", "more", "only", "over", "should", "that", "their",
  "them", "then", "they", "this", "those", "through", "very", "what", "when",
  "where", "which", "with", "would", "your",
]);

// These words can retain useful context, but their overlap is too common to
// establish that a proposition is grounded.
const WEAK_CONTEXT_TOKENS = new Set([
  "audience", "buyer", "buyers", "business", "businesses", "client", "clients",
  "company", "companies", "content", "customer", "customers", "market", "people",
  "service", "services",
]);

const CONCEPT_ALIASES = new Map<string, string>([
  ["acquire", "acquisition"], ["acquired", "acquisition"], ["acquires", "acquisition"],
  ["acquiring", "acquisition"], ["acquisition", "acquisition"],
  ["always", "universal"], ["all", "universal"], ["everyone", "universal"],
  ["every", "universal"], ["never", "universal"], ["nobody", "universal"],
  ["appointment", "appointment"], ["appointments", "appointment"],
  ["best", "superiority"], ["better", "superiority"], ["superior", "superiority"],
  ["buyer", "customer"], ["buyers", "customer"], ["client", "customer"],
  ["clients", "customer"], ["customer", "customer"], ["customers", "customer"],
  ["category", "category"], ["market", "market"],
  ["cause", "causal"], ["caused", "causal"], ["causes", "causal"],
  ["causing", "causal"], ["deliver", "causal"], ["delivered", "causal"],
  ["delivers", "causal"], ["drive", "causal"], ["driven", "causal"],
  ["drives", "causal"], ["driving", "causal"], ["enable", "causal"],
  ["enabled", "causal"], ["enables", "causal"], ["ensure", "causal"],
  ["ensures", "causal"], ["generate", "causal"], ["generated", "causal"],
  ["generates", "causal"], ["leadsto", "causal"], ["produce", "causal"],
  ["produced", "causal"], ["produces", "causal"], ["resultin", "causal"],
  ["certain", "certainty"], ["certainly", "certainty"], ["certainty", "certainty"],
  ["inevitable", "certainty"], ["inevitably", "certainty"], ["will", "certainty"],
  ["conversion", "conversion"], ["conversions", "conversion"], ["convert", "conversion"],
  ["converted", "conversion"], ["converts", "conversion"],
  ["competitor", "competitor"], ["competitors", "competitor"],
  ["double", "double"], ["doubled", "double"], ["doubling", "double"],
  ["evidence", "proof"], ["proof", "proof"], ["proofs", "proof"],
  ["fastest", "fastest"], ["leading", "leadership"], ["leader", "leadership"],
  ["leaders", "leadership"], ["leadership", "leadership"], ["numberone", "number_one"],
  ["guarantee", "guarantee"], ["guaranteed", "guarantee"], ["guarantees", "guarantee"],
  ["grow", "growth"], ["grew", "growth"], ["grown", "growth"], ["growth", "growth"],
  ["increase", "growth"], ["increased", "growth"], ["increases", "growth"],
  ["increasing", "growth"],
  ["hidden", "hidden"], ["hide", "hidden"], ["hides", "hidden"], ["hiding", "hidden"],
  ["improve", "improvement"], ["improved", "improvement"], ["improvement", "improvement"],
  ["improves", "improvement"], ["improving", "improvement"],
  ["invisible", "invisible"], ["invisibility", "invisible"],
  ["lead", "lead"], ["leads", "lead"], ["prospect", "lead"], ["prospects", "lead"],
  ["multiply", "multiply"], ["multiplied", "multiply"], ["multiplying", "multiply"],
  ["outcome", "outcome"], ["outcomes", "outcome"], ["performance", "performance"],
  ["pipeline", "pipeline"], ["pipelines", "pipeline"], ["profit", "profit"],
  ["profits", "profit"], ["margin", "profit"], ["margins", "profit"],
  ["result", "result"], ["results", "result"], ["return", "return"], ["returns", "return"],
  ["revenue", "revenue"], ["revenues", "revenue"], ["roi", "roi"],
  ["sale", "sales"], ["sales", "sales"], ["selling", "sales"],
  ["show", "visible"], ["shown", "visible"], ["shows", "visible"],
  ["reveal", "visible"], ["revealed", "visible"], ["reveals", "visible"],
  ["visible", "visible"], ["visibility", "visible"],
  ["triple", "triple"], ["tripled", "triple"], ["tripling", "triple"],
  ["uncertain", "uncertainty"], ["uncertainty", "uncertainty"], ["doubt", "uncertainty"],
]);

const WEAK_CONTEXT_CONCEPTS = new Set(["customer", "market"]);

function rawTokens(value: string): string[] {
  return normalizedSupport(value).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function conceptForToken(token: string): string {
  const aliased = CONCEPT_ALIASES.get(token);
  if (aliased) return aliased;
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ing") && token.length > 6) return token.slice(0, -3);
  if (token.endsWith("ed") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 4) return token.slice(0, -1);
  return token;
}

function meaningfulConcepts(value: string, includeWeak = false): Set<string> {
  return new Set(rawTokens(value)
    .filter((token) => token.length >= 3 && !SUPPORT_STOP_WORDS.has(token))
    .filter((token) => includeWeak || !WEAK_CONTEXT_TOKENS.has(token))
    .map(conceptForToken)
    .filter((concept) => includeWeak || !WEAK_CONTEXT_CONCEPTS.has(concept)));
}

function supportThreshold(claimConceptCount: number): number {
  if (claimConceptCount <= 1) return claimConceptCount;
  if (claimConceptCount <= 4) return 2;
  if (claimConceptCount <= 7) return 3;
  return Math.max(3, Math.ceil(claimConceptCount * 0.4));
}

function hasLexicalOrPhraseRelationship(claim: string, supportText: string): boolean {
  const normalizedClaim = normalizedSupport(claim).toLowerCase();
  const normalizedEvidence = normalizedSupport(supportText).toLowerCase();
  const claimConcepts = meaningfulConcepts(claim);
  if (claimConcepts.size === 0) return false;
  if (normalizedEvidence.includes(normalizedClaim)) return true;
  const supportConcepts = meaningfulConcepts(supportText);
  const shared = [...claimConcepts].filter((concept) => supportConcepts.has(concept));
  return shared.length >= supportThreshold(claimConcepts.size);
}

export function numericalTokens(value: string): string[] {
  const matches = value.normalize("NFKC").match(
    /(?:USD|EUR|GBP|ZAR)\s*\d+(?:,\d{3})*(?:\.\d+)?%?|[$€£]\s*\d+(?:,\d{3})*(?:\.\d+)?%?|\d+(?:,\d{3})*(?:\.\d+)?%?/gi,
  ) ?? [];
  return matches.map((token) => token
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/,/g, "")
    .replace(/(\.\d*?)0+(%?)$/, "$1$2")
    .replace(/\.(%?)$/, "$1"));
}

const OUTCOME_CONCEPTS = new Set([
  "acquisition", "appointment", "conversion", "customer", "double", "growth",
  "improvement", "lead", "multiply", "outcome", "performance", "pipeline",
  "profit", "result", "return", "revenue", "roi", "sales", "triple",
]);
const HIGH_RISK_REQUIRED_CONCEPTS = new Set([
  "causal", "certainty", "competitor", "fastest", "guarantee", "leadership",
  "number_one", "superiority", "universal",
]);
const CAUSAL_LANGUAGE_PATTERN = /\b(?:cause[ds]?|causing|decreases?|decreasing|leads?\s+to|lessens?|lowers?|makes?|made|results?\s+in|drives?|produces?|generates?|reduces?|increases?|improves?|boosts?|delivers?|enables?|ensures?)\b/i;

function sentences(value: string): string[] {
  return normalizedSupport(value).split(/(?<=[.!?])\s+|\n+/).map((item) => item.trim()).filter(Boolean);
}

function materialRiskConcepts(value: string): Set<string> {
  const concepts = meaningfulConcepts(value, true);
  const material = new Set([...concepts].filter((concept) =>
    OUTCOME_CONCEPTS.has(concept) || HIGH_RISK_REQUIRED_CONCEPTS.has(concept)
  ));
  if (/\bleads?\s+to\b/i.test(value) && !/\bleads?\b(?!\s+to)/i.test(value)) {
    material.delete("lead");
  }
  return material;
}

function hasHighRiskClaim(value: string): boolean {
  const concepts = materialRiskConcepts(value);
  if (concepts.size > 0) return true;
  return /\b(?:category|industry|market)\s+leader\b|\bnumber\s+one\b|\b(?:best|fastest|leading)\b|\b(?:always|never|every|everyone|all|nobody)\b|\b(?:guarantee|guaranteed|guarantees|certain|certainly|inevitable|inevitably|will)\b|\bcompetitors?\b/i.test(value)
    || CAUSAL_LANGUAGE_PATTERN.test(value);
}

function hasDirectHighRiskSupport(claim: string, supportText: string): boolean {
  const required = materialRiskConcepts(claim);
  const requiresCausalLanguage = CAUSAL_LANGUAGE_PATTERN.test(claim);
  const requiresNumberOne = /\bnumber\s+one\b/i.test(claim);
  if (/\bnumber\s+one\b/i.test(claim)) required.add("number_one");
  if (/\b(?:category|industry|market)\s+leader\b/i.test(claim)) required.add("leadership");
  if (/\b(?:best|better|superior)\b/i.test(claim)) required.add("superiority");
  if (/\bfastest\b/i.test(claim)) required.add("fastest");
  if (/\b(?:always|never|every|everyone|all|nobody)\b/i.test(claim)) required.add("universal");
  if (/\b(?:guarantee|guaranteed|guarantees)\b/i.test(claim)) required.add("guarantee");
  if (/\b(?:certain|certainly|certainty|inevitable|inevitably|will)\b/i.test(claim)) required.add("certainty");
  if (/\bcompetitors?\b/i.test(claim)) required.add("competitor");

  return sentences(supportText).some((sentence) => {
    if (!hasLexicalOrPhraseRelationship(claim, sentence)) return false;
    const supportConcepts = meaningfulConcepts(sentence, true);
    if (requiresCausalLanguage && !CAUSAL_LANGUAGE_PATTERN.test(sentence)) {
      return false;
    }
    if (requiresNumberOne && !/\bnumber\s+one\b/i.test(sentence)) return false;
    return [...required]
      .filter((concept) => concept !== "number_one")
      .every((concept) => supportConcepts.has(concept));
  });
}

function unsupportedClaims(value: string, supportText: string): string[] {
  return sentences(value).filter((claim) =>
    hasHighRiskClaim(claim) && !hasDirectHighRiskSupport(claim, supportText)
  );
}

function validateClaimGrounding(
  claim: string,
  supportText: string,
): { ok: true } | { ok: false; error: string } {
  if (!hasLexicalOrPhraseRelationship(claim, supportText)) {
    return { ok: false, error: "Claim lacks proposition-level lexical support in the cited evidence." };
  }
  const supportNumbers = new Set(numericalTokens(supportText));
  const unsupportedNumbers = numericalTokens(claim).filter((token) => !supportNumbers.has(token));
  if (unsupportedNumbers.length > 0) {
    return {
      ok: false,
      error: `Claim contains unsupported numerical outcomes: ${[...new Set(unsupportedNumbers)].join(", ")}.`,
    };
  }
  if (unsupportedClaims(claim, supportText).length > 0) {
    return { ok: false, error: "High-risk or outcome claim lacks direct support in the cited evidence span." };
  }
  return { ok: true };
}

function validateClaimBearingMetadata(
  value: string,
  supportText: string,
): { ok: true } | { ok: false; error: string } {
  const supportNumbers = new Set(numericalTokens(supportText));
  const unsupportedNumbers = numericalTokens(value).filter((token) => !supportNumbers.has(token));
  if (unsupportedNumbers.length > 0) {
    return {
      ok: false,
      error: `Evidence metadata contains unsupported numerical outcomes: ${[...new Set(unsupportedNumbers)].join(", ")}.`,
    };
  }
  if (unsupportedClaims(value, supportText).length > 0) {
    return { ok: false, error: "Evidence metadata contains an unsupported high-risk claim." };
  }
  return { ok: true };
}

/**
 * Evidence policy v2 reference validation.
 *
 * The model cites a registered support_unit_id; the SERVER owns the exact raw
 * span. This is strictly stronger than v1, where the model chose which part of
 * a 4000-character excerpt to point at, and it is what makes bullet and table
 * evidence expressible at all — a table proposition spans a header row and a
 * data row, which are never contiguous, so no valid v1 span could exist.
 */
function validateEvidenceReferenceV2(
  value: unknown,
  registry: Map<string, IdeationEvidenceSource>,
  units: Map<string, IdeationSupportUnit>,
  candidateFields: string[],
): { ok: true; reference: GeneratedEvidenceReference } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Evidence reference must be an object." };
  }
  const row = value as Record<string, unknown>;
  const evidenceType = row.evidence_type;
  if (typeof evidenceType !== "string" || !EVIDENCE_TYPES.has(evidenceType as IdeationEvidenceType)) {
    return { ok: false, error: "Evidence reference has an unsupported evidence_type." };
  }

  // Either spelling is accepted for every evidence type: the array form is what
  // the prompt asks for, and the singular form stays valid so a model that
  // cites exactly one unit is never rejected on shape alone.
  const rawUnitIds = row.support_unit_ids ?? row.support_unit_id;
  const unitIdList = Array.isArray(rawUnitIds)
    ? rawUnitIds
    : typeof rawUnitIds === "string"
      ? [rawUnitIds]
      : null;
  if (!unitIdList || unitIdList.length === 0 || unitIdList.length > 5) {
    return { ok: false, error: "Evidence reference requires one to five registered support_unit_ids." };
  }
  const unitIds = unitIdList.map((id) => typeof id === "string" ? id.trim() : "");
  if (unitIds.some((id) => !id) || new Set(unitIds).size !== unitIds.length) {
    return { ok: false, error: "Evidence reference contains invalid or duplicate support_unit_ids." };
  }
  const resolvedUnits = unitIds.map((id) => units.get(id));
  if (resolvedUnits.some((unit) => !unit)) {
    return { ok: false, error: "Evidence reference contains an unknown support_unit_id." };
  }
  const citedUnits = resolvedUnits as IdeationSupportUnit[];
  // An exact quotation is always one unit: a quote spans one exact source run.
  // A paraphrase may cite up to three units from the SAME source, because a
  // proposition often lives across a bullet and its sibling, or a row and its
  // neighbour. This remains strictly stronger than the v1 contract, where the
  // model chose its own span anywhere inside a 4000-character excerpt: here
  // every span is server-owned, exact, and individually registered.
  if (evidenceType === "exact_quote" && citedUnits.length !== 1) {
    return { ok: false, error: "An exact quotation must cite exactly one support unit." };
  }
  if (evidenceType === "paraphrase" && citedUnits.length > 3) {
    return { ok: false, error: "A paraphrase may cite at most three support units." };
  }

  // Every cited unit must belong to a source this candidate is allowed to use,
  // and a single reference may never straddle two sources.
  const citedSourceIds = [...new Set(citedUnits.map((unit) => unit.source_id))];
  if (citedSourceIds.some((sourceId) => !registry.has(sourceId))) {
    return { ok: false, error: "Evidence reference cites a support unit outside the allowed registry." };
  }
  if (evidenceType !== "derived_claim" && citedSourceIds.length !== 1) {
    return { ok: false, error: "Evidence reference cites support units from more than one source." };
  }
  for (const unit of citedUnits) {
    const source = registry.get(unit.source_id)!;
    if (unit.source_content_hash !== source.content_hash) {
      return { ok: false, error: "Evidence reference cites a support unit from a changed source." };
    }
  }

  const declaredSourceIds = Array.isArray(row.source_ids)
    ? row.source_ids.map((id) => typeof id === "string" ? id.trim() : "")
    : null;
  if (!declaredSourceIds || declaredSourceIds.length === 0
    || declaredSourceIds.some((id) => !registry.has(id))) {
    return { ok: false, error: "Evidence reference contains an unknown source_id." };
  }
  if (new Set(declaredSourceIds).size !== declaredSourceIds.length) {
    return { ok: false, error: "Evidence reference contains duplicate source_ids." };
  }
  // The declared sources must be exactly the sources the cited units come from.
  if (declaredSourceIds.length !== citedSourceIds.length
    || citedSourceIds.some((sourceId) => !declaredSourceIds.includes(sourceId))) {
    return { ok: false, error: "Evidence reference source_ids do not match its cited support units." };
  }

  const primary = registry.get(citedUnits[0].source_id)!;
  const sourceRef = requiredString(row, "source_ref", 300);
  const sourceUrl = requiredString(row, "source_url", 2048);
  if (!sourceRef || !sourceUrl || sourceRef !== primary.source_ref || sourceUrl !== primary.source_url) {
    return { ok: false, error: "Evidence reference contains an unsupported source_ref/source_url pair." };
  }

  const quotedText = optionalString(row, "quoted_text", 1000);
  const claim = requiredString(row, "claim", 3000);
  const supportNote = optionalString(row, "support_note", 500);
  const reasoningNote = optionalString(row, "reasoning_note", 700);
  if (!claim || !candidateFields.includes(claim)) {
    return { ok: false, error: "Evidence claim must exactly match one persisted candidate field." };
  }
  // The span is server-owned in v2; a caller-supplied one is a contract breach.
  if (row.support_span !== undefined) {
    return { ok: false, error: "support_span is server-owned under evidence policy v2 and must not be supplied." };
  }

  let supportText: string;
  if (evidenceType === "exact_quote") {
    const quotable = quotableSpansForUnit(citedUnits[0]);
    if (!quotedText || !quotable.some((span) => normalizedSupport(span).includes(normalizedSupport(quotedText)))) {
      return { ok: false, error: "Exact quotation is absent or altered in the cited support unit." };
    }
    supportText = quotedText;
  } else if (evidenceType === "paraphrase") {
    if (quotedText) {
      return { ok: false, error: "Paraphrase cannot include quoted_text." };
    }
    if (!supportNote) {
      return { ok: false, error: "Paraphrase requires a support_note." };
    }
    const paraphraseParts = citedUnits.map(supportTextForUnit).filter(Boolean);
    if (paraphraseParts.length === 0) {
      return {
        ok: false,
        error: "A heading alone cannot support a claim; cite the bullet, row, or sentence that states it.",
      };
    }
    supportText = paraphraseParts.join("\n");
  } else {
    if (!reasoningNote || quotedText) {
      return { ok: false, error: "Derived claim requires reasoning_note and cannot include quoted_text." };
    }
    const parts = citedUnits.map(supportTextForUnit).filter(Boolean);
    if (parts.length === 0) {
      return { ok: false, error: "Derived claim cites no unit that can support a proposition." };
    }
    supportText = parts.join("\n");
  }

  const grounding = validateClaimGrounding(claim, supportText);
  if (!grounding.ok) return grounding;
  for (const metadata of [supportNote, reasoningNote]) {
    if (!metadata) continue;
    const metadataGrounding = validateClaimBearingMetadata(metadata, supportText);
    if (!metadataGrounding.ok) return metadataGrounding;
  }

  return {
    ok: true,
    reference: {
      evidence_type: evidenceType as IdeationEvidenceType,
      source_ids: declaredSourceIds,
      source_ref: sourceRef,
      source_url: sourceUrl,
      claim,
      support_unit_ids: unitIds,
      // Persisted for provenance and display. Server-derived, never model text.
      support_span: citedUnits.map((unit) => unit.raw_span).join("\n"),
      ...(quotedText ? { quoted_text: quotedText } : {}),
      ...(supportNote ? { support_note: supportNote } : {}),
      ...(reasoningNote ? { reasoning_note: reasoningNote } : {}),
    },
  };
}

function validateEvidenceReference(
  value: unknown,
  registry: Map<string, IdeationEvidenceSource>,
  candidateFields: string[],
): { ok: true; reference: GeneratedEvidenceReference } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Evidence reference must be an object." };
  }
  const row = value as Record<string, unknown>;
  const evidenceType = row.evidence_type;
  if (typeof evidenceType !== "string" || !EVIDENCE_TYPES.has(evidenceType as IdeationEvidenceType)) {
    return { ok: false, error: "Evidence reference has an unsupported evidence_type." };
  }
  if (!Array.isArray(row.source_ids) || row.source_ids.length === 0 || row.source_ids.length > 5) {
    return { ok: false, error: "Evidence reference requires one to five source_ids." };
  }
  const sourceIds = row.source_ids.map((sourceId) => typeof sourceId === "string" ? sourceId.trim() : "");
  if (sourceIds.some((sourceId) => !sourceId) || new Set(sourceIds).size !== sourceIds.length) {
    return { ok: false, error: "Evidence reference contains invalid or duplicate source_ids." };
  }
  const sources = sourceIds.map((sourceId) => registry.get(sourceId));
  if (sources.some((source) => !source)) {
    return { ok: false, error: "Evidence reference contains an unknown source_id." };
  }
  const resolved = sources as IdeationEvidenceSource[];
  const sourceRef = requiredString(row, "source_ref", 300);
  const sourceUrl = requiredString(row, "source_url", 2048);
  if (!sourceRef || !sourceUrl || !resolved.some((source) =>
    source.source_ref === sourceRef && source.source_url === sourceUrl
  )) {
    return { ok: false, error: "Evidence reference contains an unsupported source_ref/source_url pair." };
  }

  const quotedText = optionalString(row, "quoted_text", 1000);
  const claim = requiredString(row, "claim", 3000);
  const supportSpan = optionalString(row, "support_span", 1000);
  const supportNote = optionalString(row, "support_note", 500);
  const reasoningNote = optionalString(row, "reasoning_note", 700);
  if (!claim || !candidateFields.includes(claim)) {
    return { ok: false, error: "Evidence claim must exactly match one persisted candidate field." };
  }
  if (evidenceType === "exact_quote") {
    if (resolved.length !== 1 || !quotedText || !resolved[0].bounded_excerpt.includes(quotedText)) {
      return { ok: false, error: "Exact quotation is absent or altered in the supplied bounded excerpt." };
    }
    if (supportNote === null && row.support_note !== undefined) {
      return { ok: false, error: "Exact quotation support_note is invalid." };
    }
  } else if (evidenceType === "paraphrase") {
    if (resolved.length !== 1 || !supportSpan || !supportNote || quotedText) {
      return {
        ok: false,
        error: "Paraphrase requires one source, a verbatim support_span, support_note, and no quoted_text.",
      };
    }
    if (!normalizedSupport(resolved[0].bounded_excerpt).includes(normalizedSupport(supportSpan))) {
      return { ok: false, error: "Paraphrase support_span is absent or altered in the supplied bounded excerpt." };
    }
  } else if (!reasoningNote || quotedText) {
    return { ok: false, error: "Derived claim requires reasoning_note and cannot include quoted_text." };
  }

  const supportText = evidenceType === "exact_quote"
    ? quotedText!
    : evidenceType === "paraphrase"
      ? supportSpan!
      : resolved.map((source) => source.bounded_excerpt).join("\n");
  const grounding = validateClaimGrounding(claim, supportText);
  if (!grounding.ok) return grounding;
  for (const metadata of [supportNote, reasoningNote]) {
    if (!metadata) continue;
    const metadataGrounding = validateClaimBearingMetadata(metadata, supportText);
    if (!metadataGrounding.ok) return metadataGrounding;
  }

  return {
    ok: true,
    reference: {
      evidence_type: evidenceType as IdeationEvidenceType,
      source_ids: sourceIds,
      source_ref: sourceRef,
      source_url: sourceUrl,
      claim,
      ...(quotedText ? { quoted_text: quotedText } : {}),
      ...(supportSpan ? { support_span: supportSpan } : {}),
      ...(supportNote ? { support_note: supportNote } : {}),
      ...(reasoningNote ? { reasoning_note: reasoningNote } : {}),
    },
  };
}

/**
 * Structured findings are graded against the whole registry. Extracted so the
 * claim-first path enforces exactly the same rule, with no second contract.
 */
export function validateStructuredFindings(
  value: Record<string, unknown>,
  evidenceRegistry: IdeationEvidenceSource[],
): { ok: true; structuredFindings: Record<string, string[]> } | { ok: false; error: string } {
  const rawFindings = value.structured_findings;
  const findingKeys = ["pain_language", "objections", "desired_outcomes", "content_opportunities"] as const;
  if (!rawFindings || typeof rawFindings !== "object" || Array.isArray(rawFindings)) {
    return { ok: false as const, error: "Model output requires structured_findings." };
  }
  const structuredFindings: Record<string, string[]> = {};
  let findingCount = 0;
  for (const key of findingKeys) {
    const items = (rawFindings as Record<string, unknown>)[key];
    if (!Array.isArray(items) || items.length > 20 || items.some((item) =>
      typeof item !== "string" || !item.trim() || item.trim().length > 500
    )) {
      return { ok: false as const, error: `structured_findings.${key} must be a bounded string array.` };
    }
    structuredFindings[key] = items.map((item) => (item as string).trim());
    findingCount += structuredFindings[key].length;
  }
  if (findingCount === 0) {
    return { ok: false as const, error: "Structured findings cannot consist only of empty arrays." };
  }
  const registrySupport = evidenceRegistry.map((source) => source.bounded_excerpt).join("\n");
  const registryNumbers = new Set(numericalTokens(registrySupport));
  const findingText = Object.values(structuredFindings).flat().join("\n");
  const unsupportedFindingNumbers = numericalTokens(findingText)
    .filter((token) => !registryNumbers.has(token));
  if (unsupportedFindingNumbers.length > 0) {
    return {
      ok: false,
      error: `Structured findings contain unsupported numerical claims: ${[...new Set(unsupportedFindingNumbers)].join(", ")}.`,
    };
  }
  if (unsupportedClaims(findingText, registrySupport).length > 0) {
    return { ok: false as const, error: "Structured findings contain an unsupported high-risk claim." };
  }
  for (const finding of Object.values(structuredFindings).flat()) {
    const grounding = validateClaimGrounding(finding, registrySupport);
    if (!grounding.ok) {
      return { ok: false as const, error: `Structured finding is not grounded: ${grounding.error}` };
    }
  }
  return { ok: true, structuredFindings };
}

export function validateIdeationCandidateOutput(
  value: Record<string, unknown>,
  expectedAssetTypes: IdeationAssetType[],
  evidenceRegistry: IdeationEvidenceSource[],
  /**
   * Evidence policy v2 support units. When supplied, references are validated
   * against server-owned spans. Omitted for historical v1 records, which keep
   * their original contract and are never rewritten.
   */
  supportUnits?: IdeationSupportUnit[],
): { ok: true; candidates: GeneratedIdeationCandidate[]; structuredFindings: Record<string, string[]> } | { ok: false; error: string } {
  if (hasProhibitedKey(value)) {
    return { ok: false, error: "Model output contains a prohibited downstream field." };
  }
  const registry = new Map(evidenceRegistry.map((source) => [source.source_id, source]));
  if (registry.size !== evidenceRegistry.length || evidenceRegistry.length === 0) {
    return { ok: false, error: "The allowed evidence registry is empty or contains duplicate source IDs." };
  }
  const unitRegistry = new Map((supportUnits ?? []).map((unit) => [unit.support_unit_id, unit]));
  if (supportUnits && unitRegistry.size !== supportUnits.length) {
    return { ok: false, error: "The support-unit registry contains duplicate support_unit_ids." };
  }
  if (supportUnits && supportUnits.length === 0) {
    return { ok: false, error: "The support-unit registry is empty." };
  }

  const findingsResult = validateStructuredFindings(value, evidenceRegistry);
  if (!findingsResult.ok) return { ok: false, error: findingsResult.error };
  const structuredFindings = findingsResult.structuredFindings;
  if (!Array.isArray(value.candidates) || value.candidates.length !== expectedAssetTypes.length) {
    return { ok: false, error: `Model output must contain exactly ${expectedAssetTypes.length} candidates.` };
  }

  const candidates: GeneratedIdeationCandidate[] = [];
  for (let index = 0; index < value.candidates.length; index += 1) {
    const raw = value.candidates[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `Candidate ${index + 1} is not an object.` };
    }
    const row = raw as Record<string, unknown>;
    const assetType = row.asset_type;
    const title = requiredString(row, "working_title", 300);
    const hook = requiredString(row, "hook", 1000);
    const coreMessage = requiredString(row, "core_message", 3000);
    const angle = requiredString(row, "psychological_angle", 1000);
    const cta = requiredString(row, "cta", 1000);
    if (!ASSET_TYPES.has(assetType as IdeationAssetType) || assetType !== expectedAssetTypes[index]) {
      return { ok: false, error: `Candidate ${index + 1} has the wrong asset_type.` };
    }
    if (!title || !hook || !coreMessage || !angle || !cta) {
      return { ok: false, error: `Candidate ${index + 1} is missing a required bounded text field.` };
    }
    if (!Array.isArray(row.evidence_references) || row.evidence_references.length === 0) {
      return { ok: false, error: `Candidate ${index + 1} requires evidence_references.` };
    }
    const candidateFields = [title, hook, coreMessage, angle, cta];
    const evidence: GeneratedEvidenceReference[] = [];
    for (const rawReference of row.evidence_references) {
      const result = supportUnits
        ? validateEvidenceReferenceV2(rawReference, registry, unitRegistry, candidateFields)
        : validateEvidenceReference(rawReference, registry, candidateFields);
      if (!result.ok) return { ok: false, error: `Candidate ${index + 1}: ${result.error}` };
      evidence.push(result.reference);
    }
    const supportedClaims = new Set(evidence.map((reference) => reference.claim));
    const unsupportedFields = candidateFields.filter((field) => !supportedClaims.has(field));
    if (unsupportedFields.length > 0) {
      return {
        ok: false,
        error: `Candidate ${index + 1} has persisted fields without an explicit evidence claim.`,
      };
    }
    const referencedExcerpts = evidence
      .flatMap((reference) => reference.source_ids)
      .map((sourceId) => registry.get(sourceId)?.bounded_excerpt ?? "")
      .join("\n");
    const referencedNumbers = new Set(numericalTokens(referencedExcerpts));
    const evidenceNotes = evidence.map((reference) =>
      [reference.claim, reference.support_note, reference.reasoning_note].filter(Boolean).join("\n")
    ).join("\n");
    const persistedClaimText = [...candidateFields, evidenceNotes].join("\n");
    const unsupportedNumbers = numericalTokens(persistedClaimText)
      .filter((token) => !referencedNumbers.has(token));
    if (unsupportedNumbers.length > 0) {
      return {
        ok: false,
        error: `Candidate ${index + 1} contains unsupported numerical claims: ${[...new Set(unsupportedNumbers)].join(", ")}.`,
      };
    }
    if (unsupportedClaims(persistedClaimText, referencedExcerpts).length > 0) {
      return { ok: false, error: `Candidate ${index + 1} contains an unsupported high-risk claim.` };
    }
    candidates.push({
      asset_type: assetType as IdeationAssetType,
      working_title: title,
      hook,
      core_message: coreMessage,
      psychological_angle: angle,
      cta,
      evidence_references: evidence,
    });
  }
  return { ok: true, candidates, structuredFindings };
}

/* ==========================================================================
 * Candidate-field policy v2 — claim-first candidate validation.
 *
 * Facts are grounded ONCE, in the proposition registry, under exactly the same
 * evidence-policy-v2 rules as before. Creative fields then reference validated
 * propositions and are checked for what they must not do. Nothing about
 * grounding is relaxed: every number, outcome, causal statement, guarantee,
 * comparison, and superlative must still be carried by a validated proposition.
 * ======================================================================== */

export interface ValidatedProposition {
  proposition_id: string;
  text: string;
  evidence_mode: IdeationEvidenceType;
  source_ids: string[];
  source_ref: string;
  source_url: string;
  support_unit_ids: string[];
  support_span: string;
  support_note?: string;
  reasoning_note?: string;
  quoted_text?: string;
}

export interface ClaimFirstCandidate {
  asset_type: IdeationAssetType;
  working_title: string;
  hook: string;
  core_message: string;
  psychological_angle: string;
  psychological_angle_code: string;
  cta: string;
  propositions: ValidatedProposition[];
  field_propositions: Record<string, string[]>;
  angle_source: "model" | "technique_default";
}

export interface CandidateFieldFailure {
  candidate_index: number;
  field: string;
  code: string;
  message: string;
}

/** Everything a creative field is measured against: its cited propositions. */
/**
 * True when a creative field shares at least one distinctive concept with its
 * propositions. Weak/generic vocabulary is excluded by meaningfulConcepts, so
 * this can never be satisfied by a generic token alone.
 */
export function hasCreativeAlignment(text: string, supportText: string): boolean {
  const fieldConcepts = meaningfulConcepts(text);
  if (fieldConcepts.size === 0) return false;
  const supportConcepts = meaningfulConcepts(supportText);
  for (const concept of fieldConcepts) {
    if (supportConcepts.has(concept)) return true;
  }
  return false;
}

function propositionSupportText(propositions: ValidatedProposition[]): string {
  return propositions.map((proposition) => proposition.text).join("\n");
}

/**
 * A creative field may frame a proposition in ordinary language, but it may not
 * assert anything the proposition does not. Two independent checks:
 *   1. every number must appear in the cited propositions;
 *   2. every high-risk category present in the field must also be present in
 *      the cited propositions, and survive the existing direct-support rule.
 * Ordinary connective and rhetorical wording is deliberately not measured
 * against source vocabulary — it asserts nothing.
 */
export function validateCreativeField(input: {
  field: string;
  text: string;
  propositions: ValidatedProposition[];
}): { ok: true } | { ok: false; code: string; message: string } {
  const support = propositionSupportText(input.propositions);
  if (input.propositions.length === 0) {
    return {
      ok: false,
      code: "FIELD_HAS_NO_PROPOSITION",
      message: `${input.field} must reference at least one validated proposition.`,
    };
  }

  const supportNumbers = new Set(numericalTokens(support));
  const unsupportedNumbers = numericalTokens(input.text).filter((token) => !supportNumbers.has(token));
  if (unsupportedNumbers.length > 0) {
    return {
      ok: false,
      code: "FIELD_UNSUPPORTED_NUMBER",
      message: `${input.field} contains a number its cited propositions do not carry.`,
    };
  }

  const fieldRisks = detectHighRiskCategories(input.text);
  const supportRisks = new Set(detectHighRiskCategories(support));
  const introduced = fieldRisks.filter((code) => !supportRisks.has(code));
  if (introduced.length > 0) {
    return {
      ok: false,
      code: "FIELD_UNSUPPORTED_CLAIM",
      message: `${input.field} introduces an unsupported ${introduced[0]} claim.`,
    };
  }
  // Even when the category is present on both sides, the existing direct-support
  // rule still decides whether this particular sentence is carried.
  if (unsupportedClaims(input.text, support).length > 0) {
    return {
      ok: false,
      code: "FIELD_UNSUPPORTED_CLAIM",
      message: `${input.field} makes a high-risk claim its cited propositions do not directly support.`,
    };
  }

  // Aboutness, calibrated for creative copy. A hook or CTA is not a factual
  // claim, so it is not measured by the proposition-level overlap threshold —
  // that threshold is what rejected valid framing. It must still be recognisably
  // about its propositions: at least one DISTINCTIVE concept must be shared.
  // Generic tokens (buyer, business, client, content, market, service, …) are
  // dropped by meaningfulConcepts before this runs, so a single generic overlap
  // still counts for nothing.
  if (!hasCreativeAlignment(input.text, support)) {
    return {
      ok: false,
      code: "FIELD_UNRELATED_TO_PROPOSITION",
      message: `${input.field} is not recognisably about the propositions it cites.`,
    };
  }
  return { ok: true };
}

/** core_message is a proposition, so it keeps the full grounding contract. */
export function validateCoreMessageField(input: {
  text: string;
  propositions: ValidatedProposition[];
}): { ok: true } | { ok: false; code: string; message: string } {
  if (input.propositions.length === 0) {
    return {
      ok: false,
      code: "FIELD_HAS_NO_PROPOSITION",
      message: "core_message must reference at least one validated proposition.",
    };
  }
  const support = propositionSupportText(input.propositions);
  const grounding = validateClaimGrounding(input.text, support);
  if (!grounding.ok) {
    return { ok: false, code: "FIELD_UNSUPPORTED_CLAIM", message: `core_message: ${grounding.error}` };
  }
  return { ok: true };
}

export function validatePsychologicalAngle(input: {
  code: unknown;
  techniqueSlug: string;
  /** Optional: the claim-card path proves support through selected cards. */
  propositions?: ValidatedProposition[];
}): { ok: true; angle: IdeationAngleDefinition } | { ok: false; code: string; message: string } {
  if (typeof input.code !== "string" || !input.code.trim()) {
    return {
      ok: false,
      code: "ANGLE_MISSING",
      message: "psychological_angle must be a taxonomy code.",
    };
  }
  const angle = ideationAngleDefinition(input.code.trim());
  if (!angle) {
    return {
      ok: false,
      code: "ANGLE_UNKNOWN",
      message: "psychological_angle is not an allowed taxonomy code.",
    };
  }
  if (!(angle.techniques as readonly string[]).includes(input.techniqueSlug)) {
    return {
      ok: false,
      code: "ANGLE_TECHNIQUE_INCOMPATIBLE",
      message: "psychological_angle is not compatible with this technique.",
    };
  }
  if (input.propositions !== undefined && input.propositions.length === 0) {
    return {
      ok: false,
      code: "FIELD_HAS_NO_PROPOSITION",
      message: "psychological_angle must reference at least one validated proposition.",
    };
  }
  return { ok: true, angle };
}

export type ClaimFirstValidation =
  | { ok: true; candidates: ClaimFirstCandidate[]; structuredFindings: Record<string, string[]> }
  | { ok: false; error: string; failures: CandidateFieldFailure[] };

/**
 * Validates one claim-first model response.
 *
 * Order matters: propositions are validated first and independently, so a
 * creative field can only ever be measured against evidence that has already
 * passed the full evidence-policy-v2 contract.
 */
export function validateClaimFirstCandidateOutput(
  value: Record<string, unknown>,
  expectedAssetTypes: IdeationAssetType[],
  evidenceRegistry: IdeationEvidenceSource[],
  supportUnits: IdeationSupportUnit[],
  techniqueSlug: string,
): ClaimFirstValidation {
  const fail = (error: string, failures: CandidateFieldFailure[] = []): ClaimFirstValidation =>
    ({ ok: false, error, failures });

  if (hasProhibitedKey(value)) {
    return fail("Model output contains a prohibited downstream field.");
  }
  const registry = new Map(evidenceRegistry.map((source) => [source.source_id, source]));
  if (registry.size !== evidenceRegistry.length || evidenceRegistry.length === 0) {
    return fail("The allowed evidence registry is empty or contains duplicate source IDs.");
  }
  const unitRegistry = new Map(supportUnits.map((unit) => [unit.support_unit_id, unit]));
  if (unitRegistry.size !== supportUnits.length || supportUnits.length === 0) {
    return fail("The support-unit registry is empty or contains duplicate support_unit_ids.");
  }

  const findings = validateStructuredFindings(value, evidenceRegistry);
  if (!findings.ok) return fail(findings.error);

  if (!Array.isArray(value.candidates) || value.candidates.length !== expectedAssetTypes.length) {
    return fail(`Model output must contain exactly ${expectedAssetTypes.length} candidates.`);
  }

  const candidates: ClaimFirstCandidate[] = [];
  const failures: CandidateFieldFailure[] = [];

  for (let index = 0; index < value.candidates.length; index += 1) {
    const raw = value.candidates[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return fail(`Candidate ${index + 1} is not an object.`);
    }
    const row = raw as Record<string, unknown>;
    const allowedKeys = new Set([
      "candidate_index", "asset_type", "grounded_propositions",
      ...IDEATION_CANDIDATE_FIELD_NAMES,
    ]);
    for (const key of Object.keys(row)) {
      if (!allowedKeys.has(key)) {
        return fail(`Candidate ${index + 1} contains the unexpected field ${key}.`);
      }
    }
    if (row.asset_type !== expectedAssetTypes[index]) {
      return fail(`Candidate ${index + 1} has the wrong asset_type.`);
    }

    /* ---- 1. propositions, validated independently and first ---- */
    const rawPropositions = row.grounded_propositions;
    if (!Array.isArray(rawPropositions)
      || rawPropositions.length < IDEATION_FIELD_LIMITS.min_propositions_per_candidate
      || rawPropositions.length > IDEATION_FIELD_LIMITS.max_propositions_per_candidate) {
      return fail(`Candidate ${index + 1} requires one to ${IDEATION_FIELD_LIMITS.max_propositions_per_candidate} grounded_propositions.`);
    }
    const byId = new Map<string, ValidatedProposition>();
    for (const rawProposition of rawPropositions) {
      if (!rawProposition || typeof rawProposition !== "object" || Array.isArray(rawProposition)) {
        return fail(`Candidate ${index + 1} has a malformed grounded proposition.`);
      }
      const proposition = rawProposition as Record<string, unknown>;
      const propositionId = typeof proposition.proposition_id === "string"
        ? proposition.proposition_id.trim()
        : "";
      if (!propositionId || propositionId.length > 16) {
        return fail(`Candidate ${index + 1} has a proposition without a usable proposition_id.`);
      }
      if (byId.has(propositionId)) {
        return fail(`Candidate ${index + 1} repeats proposition_id ${propositionId}.`);
      }
      const text = requiredString(proposition, "text", IDEATION_FIELD_LIMITS.proposition_text);
      if (!text) {
        return fail(`Candidate ${index + 1} proposition ${propositionId} has no bounded text.`);
      }
      // A proposition is validated exactly like a v2 evidence reference, with
      // its own text as the claim.
      const reference = validateEvidenceReferenceV2(
        {
          evidence_type: proposition.evidence_mode ?? proposition.evidence_type,
          support_unit_ids: proposition.support_unit_ids ?? proposition.support_unit_id,
          source_ids: proposition.source_ids
            ?? (typeof proposition.source_id === "string" ? [proposition.source_id] : undefined),
          source_ref: proposition.source_ref,
          source_url: proposition.source_url,
          support_note: proposition.support_note,
          reasoning_note: proposition.reasoning_note,
          quoted_text: proposition.quoted_text,
          claim: text,
        },
        registry,
        unitRegistry,
        [text],
      );
      if (!reference.ok) {
        failures.push({
          candidate_index: index + 1,
          field: `grounded_propositions.${propositionId}`,
          code: "PROPOSITION_UNSUPPORTED",
          message: reference.error,
        });
        continue;
      }
      byId.set(propositionId, {
        proposition_id: propositionId,
        text,
        evidence_mode: reference.reference.evidence_type,
        source_ids: reference.reference.source_ids,
        source_ref: reference.reference.source_ref,
        source_url: reference.reference.source_url,
        support_unit_ids: reference.reference.support_unit_ids ?? [],
        support_span: reference.reference.support_span ?? "",
        ...(reference.reference.support_note ? { support_note: reference.reference.support_note } : {}),
        ...(reference.reference.reasoning_note ? { reasoning_note: reference.reference.reasoning_note } : {}),
        ...(reference.reference.quoted_text ? { quoted_text: reference.reference.quoted_text } : {}),
      });
    }
    // An unsupported proposition fails before any field is considered.
    if (failures.some((failure) => failure.candidate_index === index + 1)) continue;

    /* ---- 2. fields, each measured by its own semantics ---- */
    const fieldPropositions: Record<string, string[]> = {};
    const resolveField = (field: IdeationCandidateFieldName): {
      text: string | null;
      code: string | null;
      propositions: ValidatedProposition[];
      error: string | null;
    } => {
      const rawField = row[field];
      if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) {
        return { text: null, code: null, propositions: [], error: `${field} must be an object.` };
      }
      const entry = rawField as Record<string, unknown>;
      const ids = Array.isArray(entry.proposition_ids)
        ? entry.proposition_ids.map((id) => typeof id === "string" ? id.trim() : "")
        : [];
      if (ids.length === 0 || ids.length > IDEATION_FIELD_LIMITS.max_propositions_per_field) {
        return { text: null, code: null, propositions: [], error: `${field} must cite one to ${IDEATION_FIELD_LIMITS.max_propositions_per_field} proposition_ids.` };
      }
      if (new Set(ids).size !== ids.length) {
        return { text: null, code: null, propositions: [], error: `${field} repeats a proposition_id.` };
      }
      const resolved: ValidatedProposition[] = [];
      for (const id of ids) {
        const proposition = byId.get(id);
        if (!proposition) {
          return { text: null, code: null, propositions: [], error: `${field} cites unknown proposition_id ${id}.` };
        }
        resolved.push(proposition);
      }
      fieldPropositions[field] = ids;
      const text = typeof entry.text === "string" ? entry.text.trim() : null;
      const code = typeof entry.code === "string" ? entry.code.trim() : null;
      return { text, code, propositions: resolved, error: null };
    };

    const parts: Partial<Record<IdeationCandidateFieldName, { text: string; propositions: ValidatedProposition[] }>> = {};
    let angleDefinition: IdeationAngleDefinition | null = null;
    let angleSource: "model" | "technique_default" = "model";

    for (const field of IDEATION_CANDIDATE_FIELD_NAMES) {
      const resolved = resolveField(field);
      if (resolved.error) {
        failures.push({ candidate_index: index + 1, field, code: "FIELD_MALFORMED", message: resolved.error });
        continue;
      }
      if (field === "psychological_angle") {
        const angle = validatePsychologicalAngle({
          code: resolved.code,
          techniqueSlug,
          propositions: resolved.propositions,
        });
        if (!angle.ok) {
          // Deterministic classification fallback: allowed for this field only,
          // because a taxonomy label asserts no client fact.
          const fallback = defaultAngleForTechnique(techniqueSlug);
          if (fallback && resolved.propositions.length > 0
            && (angle.code === "ANGLE_MISSING" || angle.code === "ANGLE_UNKNOWN"
              || angle.code === "ANGLE_TECHNIQUE_INCOMPATIBLE")) {
            angleDefinition = fallback;
            angleSource = "technique_default";
          } else {
            failures.push({ candidate_index: index + 1, field, code: angle.code, message: angle.message });
            continue;
          }
        } else {
          angleDefinition = angle.angle;
        }
        continue;
      }
      const text = resolved.text;
      if (!text || text.length > IDEATION_FIELD_LIMITS[field]) {
        failures.push({
          candidate_index: index + 1, field, code: "FIELD_MALFORMED",
          message: `${field} must be bounded non-empty text.`,
        });
        continue;
      }
      const check = field === "core_message"
        ? validateCoreMessageField({ text, propositions: resolved.propositions })
        : validateCreativeField({ field, text, propositions: resolved.propositions });
      if (!check.ok) {
        failures.push({ candidate_index: index + 1, field, code: check.code, message: check.message });
        continue;
      }
      parts[field] = { text, propositions: resolved.propositions };
    }

    if (failures.some((failure) => failure.candidate_index === index + 1)) continue;
    if (!parts.working_title || !parts.hook || !parts.core_message || !parts.cta || !angleDefinition) {
      failures.push({
        candidate_index: index + 1, field: "candidate", code: "FIELD_MALFORMED",
        message: "Candidate is missing a required field.",
      });
      continue;
    }

    candidates.push({
      asset_type: expectedAssetTypes[index],
      working_title: parts.working_title.text,
      hook: parts.hook.text,
      core_message: parts.core_message.text,
      psychological_angle: angleDefinition.label,
      psychological_angle_code: angleDefinition.code,
      cta: parts.cta.text,
      propositions: [...byId.values()],
      field_propositions: fieldPropositions,
      angle_source: angleSource,
    });
  }

  if (failures.length > 0) {
    return fail(
      `${failures[0].field}: ${failures[0].message}`,
      failures,
    );
  }
  return { ok: true, candidates, structuredFindings: findings.structuredFindings };
}

/**
 * Adapts a validated claim-first candidate to the EXACT persisted shape Stages
 * 2, 3, and 4 already consume. The public candidate contract is unchanged:
 * five strings plus evidence_references. The claim-first structure is preserved
 * as provenance, never as a new required column.
 */
export function toPersistedIdeationCandidate(candidate: ClaimFirstCandidate): {
  asset_type: IdeationAssetType;
  working_title: string;
  hook: string;
  core_message: string;
  psychological_angle: string;
  cta: string;
  evidence_references: GeneratedEvidenceReference[];
  candidate_field_provenance: Record<string, unknown>;
} {
  const evidence: GeneratedEvidenceReference[] = candidate.propositions.map((proposition) => ({
    evidence_type: proposition.evidence_mode,
    source_ids: proposition.source_ids,
    source_ref: proposition.source_ref,
    source_url: proposition.source_url,
    claim: proposition.text,
    support_unit_ids: proposition.support_unit_ids,
    support_span: proposition.support_span,
    ...(proposition.support_note ? { support_note: proposition.support_note } : {}),
    ...(proposition.reasoning_note ? { reasoning_note: proposition.reasoning_note } : {}),
    ...(proposition.quoted_text ? { quoted_text: proposition.quoted_text } : {}),
  }));
  return {
    asset_type: candidate.asset_type,
    working_title: candidate.working_title,
    hook: candidate.hook,
    core_message: candidate.core_message,
    psychological_angle: candidate.psychological_angle,
    cta: candidate.cta,
    evidence_references: evidence,
    candidate_field_provenance: {
      candidate_field_policy_version: IDEATION_CANDIDATE_FIELD_POLICY_VERSION,
      proposition_schema_version: IDEATION_PROPOSITION_SCHEMA_VERSION,
      angle_taxonomy_version: IDEATION_ANGLE_TAXONOMY_VERSION,
      psychological_angle_code: candidate.psychological_angle_code,
      psychological_angle_source: candidate.angle_source,
      field_propositions: candidate.field_propositions,
      propositions: candidate.propositions.map((proposition) => ({
        proposition_id: proposition.proposition_id,
        evidence_mode: proposition.evidence_mode,
        support_unit_ids: proposition.support_unit_ids,
        source_ids: proposition.source_ids,
      })),
    },
  };
}

/* ==========================================================================
 * Claim-card candidate validation — the model never authors factual text.
 *
 * The model selects registered claim-card ids and writes creative copy. Every
 * field is validated against the SERVER-OWNED permission ledger of the selected
 * cards. Nothing outside a registered card can grant a permission, so a
 * candidate index, a card id, a schema version, or an array position can never
 * become factual support.
 * ======================================================================== */

export interface ClaimCardCandidate {
  asset_type: IdeationAssetType;
  working_title: string;
  hook: string;
  core_message: string;
  psychological_angle: string;
  psychological_angle_code: string;
  cta: string;
  claim_card_ids: string[];
  cards: IdeationClaimCard[];
  angle_source: "model" | "technique_default";
}

export type ClaimCardValidation =
  | { ok: true; candidates: ClaimCardCandidate[]; structuredFindings: Record<string, string[]> }
  | { ok: false; error: string; failures: CandidateFieldFailure[] };

/** Union of the selected cards' server-owned permissions. */
function mergedPermissions(cards: IdeationClaimCard[]) {
  const numbers = new Set<string>();
  const categories = new Set<string>();
  const entities = new Set<string>();
  for (const card of cards) {
    for (const number of card.permissions.numbers) numbers.add(number);
    for (const category of card.permissions.high_risk_categories) categories.add(category);
    for (const entity of card.permissions.entities) entities.add(entity);
  }
  return { numbers, categories, entities };
}

/**
 * Capitalised words that genuinely assert a named thing. Sentence-initial
 * capitalisation and ordinary English words are excluded, so normal creative
 * copy is never mistaken for an entity claim.
 */
const COMMON_CAPITALISED = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "do", "does", "for",
  "from", "go", "here", "how", "if", "in", "is", "it", "its", "just", "look",
  "make", "no", "not", "now", "of", "on", "or", "our", "out", "review", "see",
  "show", "so", "start", "stop", "than", "that", "the", "their", "then",
  "there", "these", "they", "this", "to", "up", "use", "want", "was", "we",
  "what", "when", "where", "which", "who", "why", "will", "with", "you", "your",
  "every", "each", "some", "most", "more", "less", "yes", "find", "check",
]);

export function namedEntitiesRequiringSupport(text: string): string[] {
  const entities: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const words = sentence.trim().split(/\s+/);
    words.forEach((word, index) => {
      const clean = word.replace(/[^A-Za-z]/g, "");
      if (!clean || clean.length < 3) return;
      if (index === 0) return; // sentence-initial capitalisation asserts nothing
      if (!/^[A-Z]/.test(clean)) return;
      if (COMMON_CAPITALISED.has(clean.toLowerCase())) return;
      entities.push(clean);
    });
  }
  return [...new Set(entities)];
}

function cardSupportText(cards: IdeationClaimCard[]): string {
  return cards.map((card) => card.normalized_text).join("\n");
}

/**
 * Validates one creative field against the selected cards.
 *
 * Only the FIELD TEXT is scanned. No identifier, index, or version reaches this
 * function, which is what makes metadata numbers structurally incapable of
 * becoming factual claims.
 */
export function validateFieldAgainstCards(input: {
  field: string;
  text: string;
  cards: IdeationClaimCard[];
  requireProposition?: boolean;
}): { ok: true } | { ok: false; code: string; message: string } {
  if (input.cards.length === 0) {
    return { ok: false, code: "FIELD_HAS_NO_CARD", message: `${input.field} has no selected claim card.` };
  }
  const permissions = mergedPermissions(input.cards);
  const support = cardSupportText(input.cards);

  const unsupportedNumbers = numericalTokens(input.text).filter((token) => !permissions.numbers.has(token));
  if (unsupportedNumbers.length > 0) {
    return {
      ok: false,
      code: "FIELD_UNSUPPORTED_NUMBER",
      message: `${input.field} uses a number the selected claim cards do not permit.`,
    };
  }

  // Named entities require support. Without this a claim can borrow a table's
  // shared header vocabulary and then name a value from a row it did not
  // select. Only genuine proper nouns count: a word capitalised because it
  // starts a sentence, or an ordinary English word, is not an entity.
  const unsupportedEntities = namedEntitiesRequiringSupport(input.text)
    .filter((entity) => !cardSupportText(input.cards).toLowerCase().includes(entity.toLowerCase()));
  if (unsupportedEntities.length > 0) {
    return {
      ok: false,
      code: "FIELD_UNSUPPORTED_ENTITY",
      message: `${input.field} names ${unsupportedEntities[0]}, which the selected claim cards do not support.`,
    };
  }

  const introduced = detectHighRiskCategories(input.text)
    .filter((category) => !permissions.categories.has(category));
  if (introduced.length > 0) {
    return {
      ok: false,
      code: "FIELD_UNSUPPORTED_CLAIM",
      message: `${input.field} introduces an unsupported ${introduced[0]} claim.`,
    };
  }
  // Category permission alone is not enough: the existing direct-support rule
  // still decides whether this particular sentence is carried.
  if (unsupportedClaims(input.text, support).length > 0) {
    return {
      ok: false,
      code: "FIELD_UNSUPPORTED_CLAIM",
      message: `${input.field} makes a claim the selected cards do not directly support.`,
    };
  }

  if (input.requireProposition) {
    const grounding = validateClaimGrounding(input.text, support);
    if (!grounding.ok) {
      return { ok: false, code: "FIELD_UNSUPPORTED_CLAIM", message: `${input.field}: ${grounding.error}` };
    }
    return { ok: true };
  }

  if (!hasCreativeAlignment(input.text, support)) {
    return {
      ok: false,
      code: "FIELD_UNRELATED_TO_CARD",
      message: `${input.field} is not recognisably about the claim cards it selects.`,
    };
  }
  return { ok: true };
}

const CLAIM_CARD_CANDIDATE_KEYS = new Set([
  "candidate_index", "asset_type", "claim_card_ids",
  "working_title", "hook", "core_message", "psychological_angle", "cta",
]);

/** Fields a model must never supply now that the server owns the factual layer. */
const FORBIDDEN_MODEL_KEYS = [
  "grounded_propositions", "propositions", "evidence_references", "support_span",
  "support_unit_ids", "support_note", "quoted_text", "reasoning_note", "source_ids",
];

export function validateClaimCardCandidateOutput(
  value: Record<string, unknown>,
  expectedAssetTypes: IdeationAssetType[],
  evidenceRegistry: IdeationEvidenceSource[],
  claimCards: IdeationClaimCard[],
  techniqueSlug: string,
): ClaimCardValidation {
  const fail = (error: string, failures: CandidateFieldFailure[] = []): ClaimCardValidation =>
    ({ ok: false, error, failures });

  if (hasProhibitedKey(value)) return fail("Model output contains a prohibited downstream field.");
  const cardRegistry = new Map(claimCards.map((card) => [card.claim_card_id, card]));
  if (cardRegistry.size !== claimCards.length || claimCards.length === 0) {
    return fail("The claim-card registry is empty or contains duplicate ids.");
  }

  const findings = validateStructuredFindings(value, evidenceRegistry);
  if (!findings.ok) return fail(findings.error);

  if (!Array.isArray(value.candidates) || value.candidates.length !== expectedAssetTypes.length) {
    return fail(`Model output must contain exactly ${expectedAssetTypes.length} candidates.`);
  }

  const candidates: ClaimCardCandidate[] = [];
  const failures: CandidateFieldFailure[] = [];

  for (let index = 0; index < value.candidates.length; index += 1) {
    const raw = value.candidates[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return fail(`Candidate ${index + 1} is not an object.`);
    }
    const row = raw as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      if (FORBIDDEN_MODEL_KEYS.includes(key)) {
        return fail(`Candidate ${index + 1} supplied ${key}; the server owns the factual layer.`);
      }
      if (!CLAIM_CARD_CANDIDATE_KEYS.has(key)) {
        return fail(`Candidate ${index + 1} contains the unexpected field ${key}.`);
      }
    }
    if (row.asset_type !== expectedAssetTypes[index]) {
      return fail(`Candidate ${index + 1} has the wrong asset_type.`);
    }

    const rawIds = row.claim_card_ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return fail(`Candidate ${index + 1} must select at least one claim card.`);
    }
    if (rawIds.length > IDEATION_CLAIM_CARD_MANIFEST.max_cards_per_candidate) {
      return fail(`Candidate ${index + 1} selects more than ${IDEATION_CLAIM_CARD_MANIFEST.max_cards_per_candidate} claim cards.`);
    }
    const ids = rawIds.map((id) => typeof id === "string" ? id.trim() : "");
    if (ids.some((id) => !id)) return fail(`Candidate ${index + 1} has an invalid claim_card_id.`);
    if (new Set(ids).size !== ids.length) return fail(`Candidate ${index + 1} repeats a claim_card_id.`);
    const cards: IdeationClaimCard[] = [];
    for (const id of ids) {
      const card = cardRegistry.get(id);
      if (!card) return fail(`Candidate ${index + 1} selects the unknown claim card ${id}.`);
      cards.push(card);
    }
    // Cross-source combinations are refused: a candidate's facts must come from
    // one approved source unless a code-owned rule says otherwise.
    if (new Set(cards.map((card) => card.source_id)).size > 1) {
      return fail(`Candidate ${index + 1} combines claim cards from different sources.`);
    }

    const fieldText = (field: string): { text: string | null; code: string | null; error: string | null } => {
      const entry = row[field];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return { text: null, code: null, error: `${field} must be an object.` };
      }
      const record = entry as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        if (key !== "text" && key !== "code") {
          return { text: null, code: null, error: `${field} contains the unexpected key ${key}.` };
        }
      }
      return {
        text: typeof record.text === "string" ? record.text.trim() : null,
        code: typeof record.code === "string" ? record.code.trim() : null,
        error: null,
      };
    };

    let angleDefinition: IdeationAngleDefinition | null = null;
    let angleSource: "model" | "technique_default" = "model";
    const texts: Record<string, string> = {};

    for (const field of IDEATION_CANDIDATE_FIELD_NAMES) {
      const resolved = fieldText(field);
      if (resolved.error) {
        failures.push({ candidate_index: index + 1, field, code: "FIELD_MALFORMED", message: resolved.error });
        continue;
      }
      if (field === "psychological_angle") {
        const angle = validatePsychologicalAngle({ code: resolved.code, techniqueSlug });
        if (angle.ok) {
          angleDefinition = angle.angle;
        } else {
          const fallback = defaultAngleForTechnique(techniqueSlug);
          if (fallback) {
            angleDefinition = fallback;
            angleSource = "technique_default";
          } else {
            failures.push({ candidate_index: index + 1, field, code: angle.code, message: angle.message });
          }
        }
        continue;
      }
      const text = resolved.text;
      if (!text || text.length > IDEATION_FIELD_LIMITS[field]) {
        failures.push({
          candidate_index: index + 1, field, code: "FIELD_MALFORMED",
          message: `${field} must be bounded non-empty text.`,
        });
        continue;
      }
      const check = validateFieldAgainstCards({
        field,
        text,
        cards,
        requireProposition: field === "core_message",
      });
      if (!check.ok) {
        failures.push({ candidate_index: index + 1, field, code: check.code, message: check.message });
        continue;
      }
      texts[field] = text;
    }

    if (failures.some((failure) => failure.candidate_index === index + 1)) continue;
    if (!texts.working_title || !texts.hook || !texts.core_message || !texts.cta || !angleDefinition) {
      failures.push({
        candidate_index: index + 1, field: "candidate", code: "FIELD_MALFORMED",
        message: "Candidate is missing a required field.",
      });
      continue;
    }

    candidates.push({
      asset_type: expectedAssetTypes[index],
      working_title: texts.working_title,
      hook: texts.hook,
      core_message: texts.core_message,
      psychological_angle: angleDefinition.label,
      psychological_angle_code: angleDefinition.code,
      cta: texts.cta,
      claim_card_ids: ids,
      cards,
      angle_source: angleSource,
    });
  }

  if (failures.length > 0) return fail(`${failures[0].field}: ${failures[0].message}`, failures);
  return { ok: true, candidates, structuredFindings: findings.structuredFindings };
}

/**
 * Adapts a claim-card candidate to the persisted shape Stages 2-4 already
 * consume. The public contract is unchanged; claim-card provenance travels
 * alongside it.
 */
export function toPersistedClaimCardCandidate(candidate: ClaimCardCandidate): {
  asset_type: IdeationAssetType;
  working_title: string;
  hook: string;
  core_message: string;
  psychological_angle: string;
  cta: string;
  evidence_references: GeneratedEvidenceReference[];
  claim_card_provenance: Record<string, unknown>;
} {
  const evidence: GeneratedEvidenceReference[] = candidate.cards.map((card) => ({
    evidence_type: card.claim_mode === "normalized_table_meaning" ? "derived_claim" : "paraphrase",
    source_ids: [card.source_id],
    source_ref: card.source_ref,
    source_url: card.source_url,
    claim: card.normalized_text,
    support_unit_ids: card.support_unit_ids,
    support_span: card.quotable_spans.join("\n"),
    support_note: "Server-owned claim card derived from registered support units.",
  }));
  return {
    asset_type: candidate.asset_type,
    working_title: candidate.working_title,
    hook: candidate.hook,
    core_message: candidate.core_message,
    psychological_angle: candidate.psychological_angle,
    cta: candidate.cta,
    evidence_references: evidence,
    claim_card_provenance: {
      claim_card_policy_version: IDEATION_CLAIM_CARD_POLICY_VERSION,
      claim_card_construction_version: IDEATION_CLAIM_CARD_CONSTRUCTION_VERSION,
      permission_ledger_version: IDEATION_PERMISSION_LEDGER_VERSION,
      candidate_output_schema_version: IDEATION_CANDIDATE_OUTPUT_SCHEMA_VERSION,
      candidate_field_policy_version: IDEATION_CANDIDATE_FIELD_POLICY_VERSION,
      angle_taxonomy_version: IDEATION_ANGLE_TAXONOMY_VERSION,
      psychological_angle_code: candidate.psychological_angle_code,
      psychological_angle_source: candidate.angle_source,
      model_authored_factual_text: false,
      claim_cards: candidate.cards.map((card) => ({
        claim_card_id: card.claim_card_id,
        card_hash: card.card_hash,
        card_type: card.card_type,
        claim_mode: card.claim_mode,
        source_id: card.source_id,
        support_unit_ids: card.support_unit_ids,
        support_span_hashes: card.support_span_hashes,
        canonical_text: card.canonical_text,
        permitted_numbers: card.permissions.numbers,
        permitted_categories: card.permissions.high_risk_categories,
      })),
    },
  };
}
