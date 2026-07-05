import type { ClientInputs } from "@/types/phase";

export type ContextInputKey =
  | "business_description"
  | "offer_details"
  | "target_customer"
  | "proof_notes"
  | "sales_process"
  | "current_marketing"
  | "brand_voice"
  | "competitors"
  | "constraints_approval_rules"
  | "raw_notes";

export interface ContextInputSection {
  key: ContextInputKey;
  label: string;
  hint: string;
  recommended: boolean;
}

export const CONTEXT_INPUT_SECTIONS: ContextInputSection[] = [
  { key: "business_description", label: "Business Overview", hint: "Business description, website URL, geography and target market.", recommended: true },
  { key: "offer_details", label: "Offer / Services", hint: "What is sold, at what price tier, and how is it delivered?", recommended: true },
  { key: "target_customer", label: "Ideal Customer", hint: "Who specifically you help and who you are not targeting.", recommended: true },
  { key: "proof_notes", label: "Proof / Testimonials", hint: "Verified results, testimonials, reviews, case studies and before/after outcomes. Honest only.", recommended: true },
  { key: "sales_process", label: "Sales Process", hint: "How sales happen: discovery, demo, closing steps and common objections.", recommended: true },
  { key: "current_marketing", label: "Current Marketing", hint: "What is working, channels tried, and existing content or campaigns.", recommended: true },
  { key: "brand_voice", label: "Brand Voice", hint: "Tone, language rules, and what never to say or claim.", recommended: true },
  { key: "competitors", label: "Competitors", hint: "Competitor names, what they do, and how the client is different.", recommended: false },
  { key: "constraints_approval_rules", label: "Constraints / Approval Rules", hint: "Compliance notes, sign-off requirements, and claims to avoid.", recommended: true },
  { key: "raw_notes", label: "Raw Notes", hint: "Founder or team notes and anything that does not fit above.", recommended: false },
];

export type ContextInputValues = Record<ContextInputKey, string>;
export type PatchConfidence = "mapped" | "needs review" | "unmatched";

export function emptyContextInputValues(): ContextInputValues {
  return Object.fromEntries(CONTEXT_INPUT_SECTIONS.map(({ key }) => [key, ""])) as ContextInputValues;
}

export function valuesFromInputs(inputs: ClientInputs | null): ContextInputValues {
  const values = emptyContextInputValues();
  for (const { key } of CONTEXT_INPUT_SECTIONS) values[key] = inputs?.[key] ?? "";
  return values;
}

export function hasContextValue(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const BATCH_C_PLACEHOLDERS = [
  "test business description for batch c deployment verification",
  "test offer details for batch c deployment verification",
  "test target customer for batch c deployment verification",
];

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isPlaceholderInput(value: unknown): boolean {
  if (!hasContextValue(value)) return false;
  const normalised = normalise(value);
  return BATCH_C_PLACEHOLDERS.some(
    (placeholder) => normalised === placeholder || normalised.includes(placeholder),
  ) || (/\b(test|placeholder|dummy)\b/.test(normalised) && /\b(batch c|deployment verification)\b/.test(normalised));
}

export interface ContextReadiness {
  status: "ready" | "needs_input" | "placeholder_detected" | "missing_recommended";
  filledCount: number;
  placeholderFields: ContextInputKey[];
  missingRecommended: ContextInputKey[];
  missingOptional: ContextInputKey[];
}

export function getContextReadiness(inputs: ClientInputs | null): ContextReadiness {
  const placeholderFields = CONTEXT_INPUT_SECTIONS
    .filter(({ key }) => isPlaceholderInput(inputs?.[key]))
    .map(({ key }) => key);
  const missingRecommended = CONTEXT_INPUT_SECTIONS
    .filter(({ key, recommended }) => recommended && !hasContextValue(inputs?.[key]))
    .map(({ key }) => key);
  const missingOptional = CONTEXT_INPUT_SECTIONS
    .filter(({ key, recommended }) => !recommended && !hasContextValue(inputs?.[key]))
    .map(({ key }) => key);
  const filledCount = CONTEXT_INPUT_SECTIONS.filter(({ key }) => hasContextValue(inputs?.[key])).length;

  return {
    status: placeholderFields.length > 0
      ? "placeholder_detected"
      : filledCount === 0
        ? "needs_input"
        : missingRecommended.length > 0
          ? "missing_recommended"
          : "ready",
    filledCount,
    placeholderFields,
    missingRecommended,
    missingOptional,
  };
}

const HEADING_ALIASES: Array<[RegExp, ContextInputKey]> = [
  [/^(business|business overview|business description|company|company overview|about)$/i, "business_description"],
  [/^(offer|offers|offer details|services|products|pricing)$/i, "offer_details"],
  [/^(ideal customer|ideal client|target customer|target audience|audience|icp|avatar)$/i, "target_customer"],
  [/^(proof|testimonials?|reviews?|case studies|results|before and after)$/i, "proof_notes"],
  [/^(sales|sales process|sales journey|closing process)$/i, "sales_process"],
  [/^(marketing|current marketing|channels|campaigns|content)$/i, "current_marketing"],
  [/^(brand voice|voice|tone|style|language)$/i, "brand_voice"],
  [/^(competitors?|competition|alternatives)$/i, "competitors"],
  [/^(constraints|approval rules|constraints and approval rules|compliance|approvals|rules|guardrails)$/i, "constraints_approval_rules"],
  [/^(raw notes|notes|other|miscellaneous|additional context)$/i, "raw_notes"],
];

const KEYWORD_RULES: Array<[ContextInputKey, RegExp]> = [
  ["proof_notes", /\b(testimonial|review|case stud|result|before.?after|proof)\b/i],
  ["sales_process", /\b(discovery call|sales process|close|objection|demo|sales call)\b/i],
  ["current_marketing", /\b(marketing|campaign|instagram|facebook|linkedin|content|ads?|seo)\b/i],
  ["brand_voice", /\b(brand voice|tone of voice|tone|language|sound like)\b/i],
  ["competitors", /\b(competitor|competition|alternative to|versus|vs\.)\b/i],
  ["constraints_approval_rules", /\b(approval|compliance|constraint|must not|cannot claim|sign.?off|prohibited)\b/i],
  ["offer_details", /\b(offer|service|product|package|pricing|price|deliverable)\b/i],
  ["target_customer", /\b(ideal customer|target customer|target audience|ideal client|icp|buyer)\b/i],
  ["business_description", /\b(we are|our business|company|founded|based in|business)\b/i],
];

function headingKey(rawHeading: string): ContextInputKey | null {
  const cleaned = rawHeading.replace(/[*_#]/g, "").replace(/[\s:–—-]+$/g, "").trim();
  return HEADING_ALIASES.find(([pattern]) => pattern.test(cleaned))?.[1] ?? null;
}

function addValue(values: ContextInputValues, key: ContextInputKey, text: string) {
  const cleaned = text.trim();
  if (!cleaned) return;
  values[key] = values[key] ? `${values[key]}\n\n${cleaned}` : cleaned;
}

export function createDraftContextPatch(raw: string): {
  values: ContextInputValues;
  confidence: Record<ContextInputKey, PatchConfidence>;
} {
  const values = emptyContextInputValues();
  const confidence = Object.fromEntries(
    CONTEXT_INPUT_SECTIONS.map(({ key }) => [key, "unmatched"]),
  ) as Record<ContextInputKey, PatchConfidence>;
  const unmatched: string[] = [];
  let currentKey: ContextInputKey | null = null;

  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const headingMatch = line.match(/^\s*(?:#{1,6}\s*)?([^:]{2,80}?)(?::\s*(.*))?\s*$/);
    const candidateKey = headingMatch ? headingKey(headingMatch[1]) : null;
    const visuallyHeading = /^\s*#{1,6}\s+/.test(line) || /:\s*/.test(line) || /^\s*[A-Z][A-Z /&-]{2,}\s*$/.test(line);

    if (candidateKey && visuallyHeading) {
      currentKey = candidateKey;
      confidence[currentKey] = "mapped";
      if (headingMatch?.[2]) addValue(values, currentKey, headingMatch[2]);
      continue;
    }

    if (currentKey) addValue(values, currentKey, line);
    else unmatched.push(line);
  }

  const unmatchedText = unmatched.join("\n").trim();
  if (unmatchedText) {
    const paragraphs = unmatchedText.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
    const stillUnmatched: string[] = [];
    for (const paragraph of paragraphs) {
      const key = KEYWORD_RULES.find(([, pattern]) => pattern.test(paragraph))?.[0];
      if (key) {
        addValue(values, key, paragraph);
        if (confidence[key] !== "mapped") confidence[key] = "needs review";
      } else {
        stillUnmatched.push(paragraph);
      }
    }
    if (stillUnmatched.length > 0) {
      addValue(values, "raw_notes", stillUnmatched.join("\n\n"));
      if (confidence.raw_notes !== "mapped") confidence.raw_notes = "unmatched";
    }
  }

  if (!CONTEXT_INPUT_SECTIONS.some(({ key }) => hasContextValue(values[key]))) {
    values.raw_notes = raw.trim();
  }
  return { values, confidence };
}

export function contextLabel(key: ContextInputKey): string {
  return CONTEXT_INPUT_SECTIONS.find((section) => section.key === key)?.label ?? key;
}
