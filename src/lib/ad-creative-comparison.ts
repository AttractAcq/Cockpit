// Programme Stage M — Experimentation: paid creative-variant comparison.
//
// Scope note: this is the paid half of the build plan's Experimentation
// list only (hook/format/CTA comparison). Ad Creative Variants already
// carry structured hook_text/visual_ref/copy_text/cta_text/format columns
// (Stage L) to group by. The organic side has no equivalent structured
// "hook variant" field on a Content Item or distribution record — grouping
// would mean clustering free-text titles/captions, which is a real,
// separate piece of work, not a natural extension of this comparison
// function. It is deliberately not built in this pass; see
// docs/programme/status/Stage_M_Status.md. Creative-fatigue detection
// (declining engagement over repeated exposure of the same creative) is
// also deferred — it needs a volume of repeated real exposure this project
// has none of yet.
//
// Pure aggregation, no network/DB dependency.

export type ComparisonDimension = "hook" | "visual" | "copy" | "cta" | "format";

export interface AdCreativeVariantForComparison {
  id: string;
  hook_text: string; visual_ref: string; copy_text: string; cta_text: string; format: string;
}

export interface VariantPerformanceInput {
  variant: AdCreativeVariantForComparison;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
}

export interface DimensionGroupResult {
  dimensionValue: string;
  variantCount: number;
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  averageCtr: number | null;
  averageCpc: number | null;
  averageConversionRate: number | null;
}

function dimensionValue(variant: AdCreativeVariantForComparison, dimension: ComparisonDimension): string {
  if (dimension === "hook") return variant.hook_text;
  if (dimension === "visual") return variant.visual_ref;
  if (dimension === "copy") return variant.copy_text;
  if (dimension === "cta") return variant.cta_text;
  return variant.format;
}

const round4 = (value: number) => Math.round(value * 10000) / 10000;

/**
 * Groups variant-level spend/impressions/clicks/conversions by one creative
 * dimension (hook, visual, copy, CTA, or format) and returns aggregate CTR/
 * CPC/conversion-rate per group, sorted by total spend descending so the
 * highest-spend groups — the ones with the most reliable signal — surface
 * first. Returns an empty array (never fabricates a comparison) when there
 * is nothing to compare.
 */
export function comparePaidCreativePerformance(
  inputs: readonly VariantPerformanceInput[],
  dimension: ComparisonDimension,
): DimensionGroupResult[] {
  const groups = new Map<string, VariantPerformanceInput[]>();
  for (const item of inputs) {
    const key = dimensionValue(item.variant, dimension);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const results: DimensionGroupResult[] = [];
  for (const [dimensionValueKey, items] of groups) {
    const totalSpend = items.reduce((sum, item) => sum + Math.max(0, item.spend), 0);
    const totalImpressions = items.reduce((sum, item) => sum + Math.max(0, item.impressions), 0);
    const totalClicks = items.reduce((sum, item) => sum + Math.max(0, item.clicks), 0);
    const totalConversions = items.reduce((sum, item) => sum + Math.max(0, item.conversions), 0);
    results.push({
      dimensionValue: dimensionValueKey,
      variantCount: items.length,
      totalSpend: round4(totalSpend),
      totalImpressions,
      totalClicks,
      totalConversions,
      averageCtr: totalImpressions > 0 ? round4((totalClicks / totalImpressions) * 100) : null,
      averageCpc: totalClicks > 0 ? round4(totalSpend / totalClicks) : null,
      averageConversionRate: totalClicks > 0 ? round4((totalConversions / totalClicks) * 100) : null,
    });
  }
  return results.sort((a, b) => b.totalSpend - a.totalSpend);
}
