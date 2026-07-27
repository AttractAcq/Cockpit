import type { IdeationEvidenceSource } from "./evidence.ts";
import type { IdeationAssetType } from "./period.ts";

export type IdeationEvidenceType = "exact_quote" | "paraphrase" | "derived_claim";

export interface GeneratedEvidenceReference {
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

export function validateIdeationCandidateOutput(
  value: Record<string, unknown>,
  expectedAssetTypes: IdeationAssetType[],
  evidenceRegistry: IdeationEvidenceSource[],
): { ok: true; candidates: GeneratedIdeationCandidate[]; structuredFindings: Record<string, string[]> } | { ok: false; error: string } {
  if (hasProhibitedKey(value)) {
    return { ok: false, error: "Model output contains a prohibited downstream field." };
  }
  const registry = new Map(evidenceRegistry.map((source) => [source.source_id, source]));
  if (registry.size !== evidenceRegistry.length || evidenceRegistry.length === 0) {
    return { ok: false, error: "The allowed evidence registry is empty or contains duplicate source IDs." };
  }

  const rawFindings = value.structured_findings;
  const findingKeys = ["pain_language", "objections", "desired_outcomes", "content_opportunities"] as const;
  if (!rawFindings || typeof rawFindings !== "object" || Array.isArray(rawFindings)) {
    return { ok: false, error: "Model output requires structured_findings." };
  }
  const structuredFindings: Record<string, string[]> = {};
  let findingCount = 0;
  for (const key of findingKeys) {
    const items = (rawFindings as Record<string, unknown>)[key];
    if (!Array.isArray(items) || items.length > 20 || items.some((item) =>
      typeof item !== "string" || !item.trim() || item.trim().length > 500
    )) {
      return { ok: false, error: `structured_findings.${key} must be a bounded string array.` };
    }
    structuredFindings[key] = items.map((item) => (item as string).trim());
    findingCount += structuredFindings[key].length;
  }
  if (findingCount === 0) {
    return { ok: false, error: "Structured findings cannot consist only of empty arrays." };
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
    return { ok: false, error: "Structured findings contain an unsupported high-risk claim." };
  }
  for (const finding of Object.values(structuredFindings).flat()) {
    const grounding = validateClaimGrounding(finding, registrySupport);
    if (!grounding.ok) {
      return { ok: false, error: `Structured finding is not grounded: ${grounding.error}` };
    }
  }
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
      const result = validateEvidenceReference(rawReference, registry, candidateFields);
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
