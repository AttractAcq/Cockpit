// Ideation Stage 3 — deterministic, non-operational candidate display reference.
//
// Operational content refs look like `JUL26-CR-001` and are allocated by the
// database advisory-lock RPC. Stage 3 must NOT create or imitate one: no
// operational row exists yet. This reference is display and provenance only.
// The leading `IDEATION/` segment and the slashes make it unmistakably
// non-operational, and it is derived purely from immutable identity, so it is
// stable across regeneration and safe for Stage 4 to record as provenance.

const TECHNIQUE_ABBREVIATIONS: Record<string, string> = {
  "persona": "PSN",
  "review-mined-pain-language": "RMP",
  "competitor-objections": "CMO",
  "end-customer-complaints": "ECC",
  "live-objection-log": "LOL",
  "trigger-event": "TRG",
  "format-swipe": "FMT",
};

const ASSET_TYPE_ABBREVIATIONS: Record<string, string> = {
  reel: "RL",
  carousel: "CR",
  static: "FP",
  story: "ST",
};

export const IDEATION_DISPLAY_REFERENCE_VERSION = "aa.ideation.display-ref.v1";

/**
 * `IDEATION/{cycle8}/{TECH}-{ASSET}-{index2}`
 *
 * e.g. IDEATION/691f99b6/RMP-RL-01
 */
export function ideationCandidateDisplayReference(input: {
  ideationCycleId: string;
  techniqueSlug: string;
  assetType: string;
  candidateIndex: number;
}): string {
  const cycle = input.ideationCycleId.replace(/-/g, "").slice(0, 8).toLowerCase();
  const technique = TECHNIQUE_ABBREVIATIONS[input.techniqueSlug]
    ?? input.techniqueSlug.slice(0, 3).toUpperCase();
  const asset = ASSET_TYPE_ABBREVIATIONS[input.assetType] ?? input.assetType.slice(0, 2).toUpperCase();
  const index = String(input.candidateIndex + 1).padStart(2, "0");
  return `IDEATION/${cycle}/${technique}-${asset}-${index}`;
}

/** True only for a Stage 3 display reference, never an operational ref. */
export function isIdeationDisplayReference(value: string): boolean {
  return /^IDEATION\/[0-9a-f]{8}\/[A-Z]{3}-[A-Z]{2}-\d{2}$/.test(value);
}
