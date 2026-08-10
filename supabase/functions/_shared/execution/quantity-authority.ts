import { IDEATION_QUANTITY_SCHEMA_VERSION } from "../ideation/config.ts";
import { parseSlotTargets, type OrganicAssetType } from "./markdown-authority.ts";

export const IDEATION_QUANTITY_HEADING = "Ideation Quantity Contract";
export const LEGACY_QUANTITY_SECTION = "Rule 2 — Monthly Slot Targets (legacy compatibility)";

const ASSET_TYPES: OrganicAssetType[] = ["reel", "carousel", "static", "story"];
const FIELD_NAMES: Record<OrganicAssetType, string> = {
  reel: "reel_per_week",
  carousel: "carousel_per_week",
  static: "static_per_week",
  story: "story_per_week",
};

export type CalendarQuantityAuthorityResult =
  | { ok: true; weeklyQuotas: Record<OrganicAssetType, number>; markdown: string }
  | { ok: false; error: string };

export function containsIdeationQuantityHeading(content: string): boolean {
  return /^#{1,6}[ \t]+Ideation Quantity Contract[ \t]*$/im.test(content.replace(/\r\n?/g, "\n"));
}

/**
 * Convert the human-authored E05 Rule 2 table into the exact machine contract.
 * All four formats must occur once, values must be bounded integers, and the
 * optional organic checksum must agree. No default is ever supplied.
 */
export function quantityAuthorityFromCalendar(content: string): CalendarQuantityAuthorityResult {
  const { targets, organic_weekly_total: declaredTotal } = parseSlotTargets(content);
  if (!targets) return { ok: false, error: "E05 must contain exactly one unambiguous Rule 2 table with a Weekly Target column." };

  const byType = new Map(targets.map((target) => [target.asset_type, target.weekly_target]));
  if (targets.length !== ASSET_TYPES.length || byType.size !== ASSET_TYPES.length) {
    return { ok: false, error: "E05 Rule 2 must declare Reel, Carousel, Static and Story weekly targets exactly once." };
  }

  const weeklyQuotas = {} as Record<OrganicAssetType, number>;
  for (const assetType of ASSET_TYPES) {
    const value = byType.get(assetType);
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > 14) {
      return { ok: false, error: `E05 Rule 2 requires one integer ${FIELD_NAMES[assetType]} between 0 and 14.` };
    }
    weeklyQuotas[assetType] = value;
  }

  const computedTotal = Object.values(weeklyQuotas).reduce((sum, value) => sum + value, 0);
  if (declaredTotal !== null && declaredTotal !== computedTotal) {
    return { ok: false, error: `E05 Rule 2 organic weekly total is ${declaredTotal}, but its format rows sum to ${computedTotal}.` };
  }

  const markdown = [
    `## ${IDEATION_QUANTITY_HEADING}`,
    `schema: ${IDEATION_QUANTITY_SCHEMA_VERSION}`,
    ...ASSET_TYPES.map((assetType) => `${FIELD_NAMES[assetType]}: ${weeklyQuotas[assetType]}`),
  ].join("\n");
  return { ok: true, weeklyQuotas, markdown };
}
