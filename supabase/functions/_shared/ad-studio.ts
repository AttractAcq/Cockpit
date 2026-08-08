// Programme Stage L — Ad Studio: the Ad Brief contract and the Hooks x
// Visuals x Copy x CTA x Format creative matrix generator.
//
// All pure/testable — no database or network dependency.

export interface AttributionRequirements {
  pixel_id: string | null;
  conversion_event: string | null;
}

export interface AdBriefBody {
  campaign_objective: string;
  awareness_stage: string;
  audience: string;
  offer: string;
  landing_page: string;
  primary_claim: string;
  proof_required: boolean;
  hook_variants: string[];
  visual_variants: string[];
  copy_variants: string[];
  cta_variants: string[];
  placement: string[];
  testing_role: string;
  attribution_requirements: AttributionRequirements;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown, min: number): value is string[] {
  return Array.isArray(value) && value.length >= min && value.every((v) => isNonEmptyString(v));
}

/** Strict validation — mirrors content-brief.ts's validateStructuredBrief pattern exactly. */
export function validateAdBriefBody(raw: unknown): AdBriefBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;

  const requiredStrings = ["campaign_objective", "awareness_stage", "audience", "offer", "landing_page", "primary_claim", "testing_role"];
  for (const field of requiredStrings) {
    if (!isNonEmptyString(row[field])) return null;
  }
  if (typeof row.proof_required !== "boolean") return null;
  if (!isStringArray(row.hook_variants, 1)) return null;
  if (!isStringArray(row.visual_variants, 1)) return null;
  if (!isStringArray(row.copy_variants, 1)) return null;
  if (!isStringArray(row.cta_variants, 1)) return null;
  if (!isStringArray(row.placement, 1)) return null;

  const attribution = row.attribution_requirements;
  if (typeof attribution !== "object" || attribution === null) return null;
  const attr = attribution as Record<string, unknown>;
  if (attr.pixel_id !== null && attr.pixel_id !== undefined && typeof attr.pixel_id !== "string") return null;
  if (attr.conversion_event !== null && attr.conversion_event !== undefined && typeof attr.conversion_event !== "string") return null;

  return {
    campaign_objective: row.campaign_objective as string,
    awareness_stage: row.awareness_stage as string,
    audience: row.audience as string,
    offer: row.offer as string,
    landing_page: row.landing_page as string,
    primary_claim: row.primary_claim as string,
    proof_required: row.proof_required,
    hook_variants: row.hook_variants as string[],
    visual_variants: row.visual_variants as string[],
    copy_variants: row.copy_variants as string[],
    cta_variants: row.cta_variants as string[],
    placement: row.placement as string[],
    testing_role: row.testing_role as string,
    attribution_requirements: {
      pixel_id: (attr.pixel_id as string | null | undefined) ?? null,
      conversion_event: (attr.conversion_event as string | null | undefined) ?? null,
    },
  };
}

export function renderAdBriefMarkdown(brief: AdBriefBody): string {
  const lines = [
    `# Ad Brief`,
    ``,
    `**Objective:** ${brief.campaign_objective}`,
    `**Awareness stage:** ${brief.awareness_stage}`,
    `**Audience:** ${brief.audience}`,
    `**Offer:** ${brief.offer}`,
    `**Landing page:** ${brief.landing_page}`,
    ``,
    `## Primary claim`,
    brief.primary_claim,
    brief.proof_required ? `\n_Proof required before this claim can run._` : ``,
    ``,
    `## Hook variants`,
    ...brief.hook_variants.map((h, i) => `${i + 1}. ${h}`),
    ``,
    `## Visual variants`,
    ...brief.visual_variants.map((v, i) => `${i + 1}. ${v}`),
    ``,
    `## Copy variants`,
    ...brief.copy_variants.map((c, i) => `${i + 1}. ${c}`),
    ``,
    `## CTA variants`,
    ...brief.cta_variants.map((c, i) => `${i + 1}. ${c}`),
    ``,
    `## Placement`,
    brief.placement.join(", "),
    ``,
    `**Testing role:** ${brief.testing_role}`,
    brief.attribution_requirements.pixel_id ? `**Pixel:** ${brief.attribution_requirements.pixel_id}` : ``,
    brief.attribution_requirements.conversion_event ? `**Conversion event:** ${brief.attribution_requirements.conversion_event}` : ``,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/**
 * "Unsupported claims fail": mirrors content-brief.ts's checkProofGate
 * exactly — an Ad Brief that self-flags proof_required cannot approve or
 * launch without at least one verified Proof linked.
 */
export function checkAdClaimGate(proofRequired: boolean, linkedVerifiedProofCount: number): { passed: boolean; reason: string | null } {
  if (!proofRequired) return { passed: true, reason: null };
  if (linkedVerifiedProofCount > 0) return { passed: true, reason: null };
  return { passed: false, reason: "This Brief's primary claim is self-flagged as requiring proof, but no verified Proof is linked. Unsupported claims cannot run." };
}

// ---------------------------------------------------------------------------
// Creative matrix: Hooks x Visuals x Copy x CTA x Format
// ---------------------------------------------------------------------------

export interface VariantCombination {
  hookIndex: number;
  visualIndex: number;
  copyIndex: number;
  ctaIndex: number;
  format: string;
  hookText: string;
  visualRef: string;
  copyText: string;
  ctaText: string;
}

export interface CreativeMatrixResult {
  ok: boolean;
  combinations: VariantCombination[];
  totalCombinations: number;
  estimatedCostUnits: number;
  error: string | null;
}

/** A conservative, documented-as-an-estimate unit cost per variant (never real billing). */
export const ESTIMATED_COST_UNITS_PER_VARIANT = 1;

/** Hard ceiling on how many variants one brief can generate in a single pass. */
export const MAX_VARIANTS_PER_BRIEF = 24;

/**
 * The full cartesian product of hooks x visuals x copy x CTAs x formats,
 * bounded by MAX_VARIANTS_PER_BRIEF ("controlled variant counts and cost
 * limits" — Stage L's own scope line). Fails closed (ok: false, no
 * combinations) rather than silently truncating, since a silently-truncated
 * matrix would hide which combinations were dropped.
 */
export function generateCreativeMatrix(
  brief: Pick<AdBriefBody, "hook_variants" | "visual_variants" | "copy_variants" | "cta_variants">,
  formats: string[],
): CreativeMatrixResult {
  if (formats.length === 0) {
    return { ok: false, combinations: [], totalCombinations: 0, estimatedCostUnits: 0, error: "At least one format is required." };
  }
  const total = brief.hook_variants.length * brief.visual_variants.length * brief.copy_variants.length * brief.cta_variants.length * formats.length;
  if (total > MAX_VARIANTS_PER_BRIEF) {
    return {
      ok: false, combinations: [], totalCombinations: total, estimatedCostUnits: total * ESTIMATED_COST_UNITS_PER_VARIANT,
      error: `The full matrix would produce ${total} variants, exceeding the ${MAX_VARIANTS_PER_BRIEF}-variant limit. Reduce hooks, visuals, copy, CTAs or formats before generating.`,
    };
  }
  const combinations: VariantCombination[] = [];
  for (let h = 0; h < brief.hook_variants.length; h++) {
    for (let v = 0; v < brief.visual_variants.length; v++) {
      for (let c = 0; c < brief.copy_variants.length; c++) {
        for (let t = 0; t < brief.cta_variants.length; t++) {
          for (const format of formats) {
            combinations.push({
              hookIndex: h, visualIndex: v, copyIndex: c, ctaIndex: t, format,
              hookText: brief.hook_variants[h], visualRef: brief.visual_variants[v],
              copyText: brief.copy_variants[c], ctaText: brief.cta_variants[t],
            });
          }
        }
      }
    }
  }
  return { ok: true, combinations, totalCombinations: total, estimatedCostUnits: total * ESTIMATED_COST_UNITS_PER_VARIANT, error: null };
}
