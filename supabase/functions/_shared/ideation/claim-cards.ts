// Ideation claim cards — server-owned factual layer.
//
// Why this exists: even with evidence policy v2 and candidate-fields v2, the
// MODEL still authored the factual proposition text. It could select perfectly
// valid evidence and then write "the number 1 pain" or an outcome verb into the
// proposition, and because every candidate must pass exactly, one stray word
// failed the whole cycle. The last two live cycles failed precisely that way.
//
// The fix removes factual authorship from the model. The server derives claim
// cards deterministically from already-validated support units, owns their
// canonical text, and computes a permission ledger. The model only SELECTS card
// ids and writes creative copy around them. It can no longer introduce a fact,
// because it never writes the factual layer at all.
//
// Nothing here uses a model, semantic similarity, or invented prose.

import { sha256 } from "./hash.ts";
import {
  IDEATION_EVIDENCE_POLICY_VERSION,
  IDEATION_SUPPORT_UNIT_PARSER_VERSION,
  type IdeationSupportUnit,
} from "./support-units.ts";
import { detectHighRiskCategories } from "./candidate-fields.ts";
import { numericalTokens } from "./output.ts";

export const IDEATION_CLAIM_CARD_POLICY_VERSION = "aa.ideation.claim-cards.v1";
export const IDEATION_CLAIM_CARD_CONSTRUCTION_VERSION = "aa.ideation.claim-card-construction.v1";
export const IDEATION_PERMISSION_LEDGER_VERSION = "aa.ideation.claim-permissions.v1";
export const IDEATION_CANDIDATE_OUTPUT_SCHEMA_VERSION = "aa.ideation.candidate-output.v3";

export type IdeationClaimCardType = "direct" | "table_fact" | "support_bundle";
export type IdeationClaimMode = "source_text" | "normalized_table_meaning" | "source_bundle";

/**
 * Server-owned permissions. A creative field may only assert what the ledger
 * records. Absence of a permission means the field may not introduce it.
 */
export interface IdeationClaimPermissions {
  numbers: string[];
  entities: string[];
  audience_terms: string[];
  high_risk_categories: string[];
  allows_causal: boolean;
  allows_comparison: boolean;
  allows_superiority: boolean;
  allows_leadership: boolean;
  allows_guarantee: boolean;
  allows_universal: boolean;
  allows_competitor: boolean;
  allows_urgency: boolean;
  allows_scarcity: boolean;
  allows_outcome: boolean;
  ledger_version: string;
}

export interface IdeationClaimCard {
  claim_card_id: string;
  card_type: IdeationClaimCardType;
  claim_mode: IdeationClaimMode;
  source_id: string;
  source_ref: string;
  source_type: string;
  source_url: string;
  source_content_hash: string;
  support_unit_ids: string[];
  support_span_hashes: string[];
  /** Server-owned factual text. Never model-authored. */
  canonical_text: string;
  /** Whitespace-folded comparison form of canonical_text. */
  normalized_text: string;
  /** Exact registered raw spans, quotable verbatim. Table meaning is not here. */
  quotable_spans: string[];
  permissions: IdeationClaimPermissions;
  policy_version: string;
  construction_version: string;
  parser_version: string;
  evidence_policy_version: string;
  card_hash: string;
}

/* ------------------------------------------------- canonical factual text */

/**
 * Deterministic, meaning-preserving removal of Markdown transport markers.
 * Vocabulary, numbers, and order are never changed; only emphasis and inline
 * code markers that carry no meaning are dropped.
 */
export function canonicalFactualText(unit: IdeationSupportUnit): string {
  if (unit.unit_type === "table_row") {
    // Already server-owned by evidence v2: registered header cells paired with
    // registered row cells. This is normalized MEANING, never a quotation.
    return unit.normalized_text;
  }
  return unit.raw_span
    .replace(/\*\*/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*)[*_](?=\s|$)/g, "$1$2")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function foldWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/* -------------------------------------------------------- permissions */

const AUDIENCE_TERMS = [
  "buyer", "buyers", "client", "clients", "customer", "customers", "founder",
  "founders", "operator", "operators", "owner", "owners", "prospect", "prospects",
  "agency", "agencies", "business", "businesses", "team", "teams",
];

/** Capitalised multi-word or proper nouns the card actually contains. */
function detectEntities(value: string): string[] {
  const matches = value.match(/\b[A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]{2,})*\b/g) ?? [];
  return [...new Set(matches.map((entity) => entity.trim()))].sort();
}

function detectAudienceTerms(value: string): string[] {
  const lower = value.toLowerCase();
  return AUDIENCE_TERMS.filter((term) => new RegExp(`\\b${term}\\b`).test(lower));
}

/**
 * Builds the permission ledger from the card's own server-owned content only.
 *
 * Nothing outside the registered source can grant a permission: not a candidate
 * index, not a card id, not a schema version, not an array position.
 */
export function buildPermissions(canonicalText: string, quotableSpans: string[]): IdeationClaimPermissions {
  // Numbers are read from the server-owned factual content and the registered
  // raw spans — never from any identifier or metadata.
  const factualSurface = [canonicalText, ...quotableSpans].join("\n");
  const numbers = [...new Set(numericalTokens(factualSurface))].sort();
  const highRisk = detectHighRiskCategories(factualSurface);
  const has = (code: string) => highRisk.includes(code);
  return {
    numbers,
    entities: detectEntities(factualSurface),
    audience_terms: detectAudienceTerms(factualSurface),
    high_risk_categories: highRisk,
    allows_causal: has("causal"),
    allows_comparison: has("superiority") || has("competitor"),
    allows_superiority: has("superiority"),
    allows_leadership: has("leadership"),
    allows_guarantee: has("guarantee"),
    allows_universal: has("universal"),
    allows_competitor: has("competitor"),
    allows_urgency: has("urgency"),
    allows_scarcity: has("scarcity"),
    allows_outcome: has("outcome"),
    ledger_version: IDEATION_PERMISSION_LEDGER_VERSION,
  };
}

/* --------------------------------------------------- card construction */

/**
 * A heading states no proposition on its own, so it never becomes a card. Very
 * short fragments carry nothing citable either.
 */
function isCardable(unit: IdeationSupportUnit): boolean {
  if (unit.unit_type === "heading") return false;
  return foldWhitespace(canonicalFactualText(unit)).length >= 12;
}

async function buildCard(input: {
  units: IdeationSupportUnit[];
  cardType: IdeationClaimCardType;
  claimMode: IdeationClaimMode;
  canonicalText: string;
  quotableSpans: string[];
}): Promise<IdeationClaimCard> {
  const primary = input.units[0];
  const supportUnitIds = input.units.map((unit) => unit.support_unit_id);
  const spanHashes = input.units.map((unit) => unit.excerpt_hash);
  const identity = [
    IDEATION_CLAIM_CARD_CONSTRUCTION_VERSION,
    primary.source_id,
    primary.source_content_hash,
    input.cardType,
    supportUnitIds.join(","),
    input.canonicalText,
  ].join("|");
  const cardHash = await sha256(identity);
  return {
    claim_card_id: `cc_${cardHash.slice(0, 12)}`,
    card_type: input.cardType,
    claim_mode: input.claimMode,
    source_id: primary.source_id,
    source_ref: primary.source_ref,
    source_type: primary.source_type,
    source_url: primary.source_url,
    source_content_hash: primary.source_content_hash,
    support_unit_ids: supportUnitIds,
    support_span_hashes: spanHashes,
    canonical_text: input.canonicalText,
    normalized_text: foldWhitespace(input.canonicalText),
    quotable_spans: input.quotableSpans,
    permissions: buildPermissions(input.canonicalText, input.quotableSpans),
    policy_version: IDEATION_CLAIM_CARD_POLICY_VERSION,
    construction_version: IDEATION_CLAIM_CARD_CONSTRUCTION_VERSION,
    parser_version: IDEATION_SUPPORT_UNIT_PARSER_VERSION,
    evidence_policy_version: IDEATION_EVIDENCE_POLICY_VERSION,
    card_hash: cardHash,
  };
}

/**
 * Builds the deterministic claim-card registry for one technique's evidence.
 *
 * Cards appear in document order. Every card is derived from registered support
 * units only; no unit is invented, rewritten, or combined across sources.
 */
export async function buildClaimCards(units: IdeationSupportUnit[]): Promise<IdeationClaimCard[]> {
  const cards: IdeationClaimCard[] = [];
  for (const unit of units) {
    if (!isCardable(unit)) continue;
    if (unit.unit_type === "table_row") {
      cards.push(await buildCard({
        units: [unit],
        cardType: "table_fact",
        claimMode: "normalized_table_meaning",
        canonicalText: canonicalFactualText(unit),
        // The paired meaning is deliberately NOT quotable; the raw row and its
        // registered header are.
        quotableSpans: unit.table_header_raw ? [unit.raw_span, unit.table_header_raw] : [unit.raw_span],
      }));
      continue;
    }
    cards.push(await buildCard({
      units: [unit],
      cardType: "direct",
      claimMode: "source_text",
      canonicalText: canonicalFactualText(unit),
      quotableSpans: [unit.raw_span],
    }));
  }
  return cards;
}

/**
 * A same-source bundle of up to three cards. It represents a COLLECTION of
 * independently registered facts — never a new conclusion. No causal or outcome
 * relationship is created between the components, and the permission ledger is
 * the union of the components' own permissions, nothing more.
 */
export async function buildSupportBundle(cards: IdeationClaimCard[]): Promise<IdeationClaimCard | null> {
  if (cards.length < 2 || cards.length > 3) return null;
  const sourceId = cards[0].source_id;
  if (cards.some((card) => card.source_id !== sourceId)) return null;
  const canonical = cards.map((card) => card.canonical_text).join("\n");
  const quotable = cards.flatMap((card) => card.quotable_spans);
  const identity = [
    IDEATION_CLAIM_CARD_CONSTRUCTION_VERSION,
    sourceId,
    cards[0].source_content_hash,
    "support_bundle",
    cards.map((card) => card.claim_card_id).join(","),
  ].join("|");
  const cardHash = await sha256(identity);
  return {
    ...cards[0],
    claim_card_id: `cc_${cardHash.slice(0, 12)}`,
    card_type: "support_bundle",
    claim_mode: "source_bundle",
    support_unit_ids: cards.flatMap((card) => card.support_unit_ids),
    support_span_hashes: cards.flatMap((card) => card.support_span_hashes),
    canonical_text: canonical,
    normalized_text: foldWhitespace(canonical),
    quotable_spans: quotable,
    permissions: buildPermissions(canonical, quotable),
    card_hash: cardHash,
  };
}

function serializeCard(card: IdeationClaimCard): string {
  {
    const permissions = card.permissions;
    const notes: string[] = [];
    if (permissions.numbers.length > 0) notes.push(`numbers you may use: ${permissions.numbers.join(", ")}`);
    if (permissions.high_risk_categories.length > 0) {
      notes.push(`claim types you may use: ${permissions.high_risk_categories.join(", ")}`);
    }
    const label = card.claim_mode === "normalized_table_meaning" ? "MEANING" : "FACT";
    return `  ${card.claim_card_id}\n    ${label}: ${card.normalized_text}${
      notes.length > 0 ? `\n    ALLOWED: ${notes.join("; ")}` : "\n    ALLOWED: no numbers, no outcome or comparison claims"
    }`;
  }
}

/** Compact prompt serialization. Each card appears exactly once. */
export function serializeClaimCards(cards: IdeationClaimCard[]): string {
  return cards.map(serializeCard).join("\n");
}

/**
 * Serializes one trust-classified group of sources as its claim cards.
 *
 * The cards ARE the authority presentation now: each source's facts appear
 * exactly once, under that source's own trust classification. No excerpt, unit,
 * or card text is ever printed twice.
 */
export function serializeSourceCardSection(
  sources: Array<{ source_id: string; source_ref: string; source_type: string; source_url: string; content_hash: string }>,
  cards: IdeationClaimCard[],
): string {
  return sources.map((source) => {
    const own = cards.filter((card) => card.source_id === source.source_id);
    const header = [
      `SOURCE_ID: ${source.source_id}`,
      `SOURCE_REF: ${source.source_ref}`,
      `SOURCE_TYPE: ${source.source_type}`,
      `SOURCE_URL: ${source.source_url}`,
      `CONTENT_HASH: ${source.content_hash}`,
    ].join("\n");
    const body = own.length
      ? own.map(serializeCard).join("\n")
      : "  (no citable claim card was derived from this source)";
    return `${header}\n${body}`;
  }).join("\n\n");
}

/** Frozen manifest, hashed into the Stage 1 configuration snapshot. */
export const IDEATION_CLAIM_CARD_MANIFEST = Object.freeze({
  policy_version: IDEATION_CLAIM_CARD_POLICY_VERSION,
  construction_version: IDEATION_CLAIM_CARD_CONSTRUCTION_VERSION,
  permission_ledger_version: IDEATION_PERMISSION_LEDGER_VERSION,
  candidate_output_schema_version: IDEATION_CANDIDATE_OUTPUT_SCHEMA_VERSION,
  card_types: ["direct", "table_fact", "support_bundle"],
  // Derived cards are disabled: no deterministic derivation exists that adds
  // meaning without risking an unsupported outcome or causal link.
  derived_cards_enabled: false,
  model_authors_factual_text: false,
  headings_never_become_cards: true,
  table_meaning_is_not_quotable: true,
  bundles_are_same_source_only: true,
  bundle_creates_no_new_relationship: true,
  max_cards_per_candidate: 3,
  permissions_derive_only_from_registered_source: true,
});
