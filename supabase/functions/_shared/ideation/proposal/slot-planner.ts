// Ideation Stage 3 — deterministic proposed-Calendar slot planner.
//
// Phase 3's planWindowSlots is cadence-driven: it emits whatever count the
// weekday cadence yields for a window. Stage 3 needs the opposite guarantee —
// EXACTLY the immutable Stage 1 quantity allocation, reconciled per asset type.
// This planner is therefore Stage 3 specific and versioned, but it reuses Phase 3
// conventions verbatim: UTC-safe inclusive date iteration, the same system
// default weekday cadence, and the same `{date}:{format}:{ordinal}` slot-key
// shape. Phase 3 behaviour is not modified or called.

export const IDEATION_SLOT_PLANNER_VERSION = "aa.ideation.slot-planner.v1";

export type IdeationAssetType = "reel" | "carousel" | "static" | "story";

export const IDEATION_ASSET_TYPES: readonly IdeationAssetType[] = [
  "reel",
  "carousel",
  "static",
  "story",
] as const;

/**
 * Stage 1 asset type -> operational calendar_row_type, for conflict detection
 * only. Stage 3 never writes a calendar row; this mapping exists so an existing
 * operational placement on the same date and lane can be recognised.
 */
export const IDEATION_ASSET_TYPE_TO_CALENDAR_ROW: Record<IdeationAssetType, string> = {
  reel: "reel",
  carousel: "carousels",
  static: "feed_posts",
  story: "stories",
};

/**
 * System default weekday cadence (0=Sun … 6=Sat), matching the existing Phase 3
 * scoped planner so Stage 3 proposals land on the same days the application
 * already treats as canonical. Used only when approved Execution authority
 * carries no explicit schedule contract.
 */
export const IDEATION_DEFAULT_WEEKDAYS: Record<IdeationAssetType, number[]> = {
  reel: [1, 2, 4, 6],
  carousel: [3, 5],
  static: [0, 3],
  story: [0, 1, 2, 3, 4, 5, 6],
};

export interface IdeationScheduleContract {
  source: "approved_execution" | "system_default";
  source_file: string | null;
  weekdays: Record<IdeationAssetType, number[]>;
}

const SCHEDULE_HEADING = "Ideation Schedule Contract";
const WEEKDAY_FIELDS: Record<IdeationAssetType, string> = {
  reel: "reel_weekdays",
  carousel: "carousel_weekdays",
  static: "static_weekdays",
  story: "story_weekdays",
};

/**
 * Optional explicit scheduling authority.
 *
 * If an approved Execution File carries an "## Ideation Schedule Contract"
 * section, its weekday lists take precedence over the system default. Exactly
 * one such contract may exist; more than one is ambiguous and fails closed.
 */
export function parseScheduleContract(
  files: Array<{ file_name: string; content_md: string }>,
): IdeationScheduleContract {
  const found: Array<{ file_name: string; weekdays: Record<IdeationAssetType, number[]> }> = [];
  for (const file of files) {
    const index = file.content_md.indexOf(SCHEDULE_HEADING);
    if (index < 0) continue;
    const section = file.content_md.slice(index, index + 1200);
    const weekdays = {} as Record<IdeationAssetType, number[]>;
    let complete = true;
    for (const assetType of IDEATION_ASSET_TYPES) {
      const match = section.match(new RegExp(`${WEEKDAY_FIELDS[assetType]}\\s*:\\s*([0-9,\\s]+)`));
      if (!match) {
        complete = false;
        break;
      }
      const days = match[1]
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);
      if (days.length === 0) {
        complete = false;
        break;
      }
      weekdays[assetType] = [...new Set(days)].sort((a, b) => a - b);
    }
    if (complete) found.push({ file_name: file.file_name, weekdays });
  }
  if (found.length > 1) {
    throw new Error("More than one approved Ideation Schedule Contract was found.");
  }
  if (found.length === 1) {
    return {
      source: "approved_execution",
      source_file: found[0].file_name,
      weekdays: found[0].weekdays,
    };
  }
  return {
    source: "system_default",
    source_file: null,
    weekdays: { ...IDEATION_DEFAULT_WEEKDAYS },
  };
}

/** Inclusive, UTC-safe date enumeration. Mirrors the Phase 3 convention. */
export function eachDateInclusive(start: string, end: string): string[] {
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) {
    throw new Error(`Invalid period ${start}..${end}`);
  }
  if (cursor > last) throw new Error(`Period end precedes period start: ${start}..${end}`);
  const dates: string[] = [];
  for (let guard = 0; cursor <= last && guard < 400; guard += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export interface ProposalSlot {
  proposal_slot_key: string;
  proposed_date: string;
  date_slot_ordinal: number;
  required_asset_type: IdeationAssetType;
  execution_month: string;
  calendar_row_type: string;
  placement_basis: "execution_cadence" | "deterministic_spread";
}

/**
 * Picks exactly `count` dates from `candidates`, spread as evenly as the list
 * allows. Index i maps to floor(i * len / count), which is stable, monotonic,
 * and never concentrates at one end.
 */
function spreadPick(candidates: string[], count: number): string[] {
  if (count <= 0) return [];
  const picked: string[] = [];
  for (let index = 0; index < count; index += 1) {
    picked.push(candidates[Math.floor((index * candidates.length) / count)]);
  }
  return picked;
}

/**
 * Builds the canonical slot manifest for one Ideation period.
 *
 * Precedence, in order:
 *   1. explicit weekday requirements from approved Execution authority;
 *   2. the immutable per-asset-type quantity requirement (always exact);
 *   3. deterministic spread across the inclusive period.
 *
 * Guarantees, all asserted by tests:
 *   - total slots === sum of the requested per-asset-type counts;
 *   - per-asset-type totals reconcile exactly;
 *   - every slot lies inside the inclusive period;
 *   - slot keys are unique;
 *   - identical inputs always yield an identical manifest.
 *
 * When a cadence supplies fewer distinct dates than the required count, the
 * remaining placements fall back to a spread over every date in the period, and
 * only then may two slots of one asset type share a date — distinguished by an
 * ascending per-date ordinal.
 */
export function planIdeationProposalSlots(input: {
  periodStart: string;
  periodEnd: string;
  requiredByAssetType: Record<IdeationAssetType, number>;
  weekdays: Record<IdeationAssetType, number[]>;
}): ProposalSlot[] {
  const dates = eachDateInclusive(input.periodStart, input.periodEnd);
  const slots: ProposalSlot[] = [];

  for (const assetType of IDEATION_ASSET_TYPES) {
    const required = input.requiredByAssetType[assetType] ?? 0;
    if (!Number.isInteger(required) || required < 0) {
      throw new Error(`Required count for ${assetType} must be a non-negative integer.`);
    }
    if (required === 0) continue;

    const cadence = input.weekdays[assetType] ?? [];
    const preferred = dates.filter((date) => cadence.includes(weekdayOf(date)));
    let chosen: Array<{ date: string; basis: ProposalSlot["placement_basis"] }>;

    if (preferred.length >= required) {
      chosen = spreadPick(preferred, required).map((date) => ({ date, basis: "execution_cadence" as const }));
    } else {
      // Every cadence date is used first, then the shortfall is spread across the
      // whole period so placements stay distributed rather than clustered.
      const used = preferred.map((date) => ({ date, basis: "execution_cadence" as const }));
      const shortfall = required - preferred.length;
      const remaining = dates.filter((date) => !preferred.includes(date));
      const pool = remaining.length > 0 ? remaining : dates;
      const filler = spreadPick(pool, shortfall).map((date) => ({
        date,
        basis: "deterministic_spread" as const,
      }));
      chosen = [...used, ...filler];
    }

    // Stable ordering by date, then by basis so cadence placements come first on
    // a shared date, keeping ordinals deterministic.
    chosen.sort((left, right) =>
      left.date < right.date ? -1 : left.date > right.date ? 1 : left.basis.localeCompare(right.basis)
    );

    const ordinalByDate = new Map<string, number>();
    for (const entry of chosen) {
      const ordinal = (ordinalByDate.get(entry.date) ?? 0) + 1;
      ordinalByDate.set(entry.date, ordinal);
      slots.push({
        proposal_slot_key: `${entry.date}:${assetType}:${ordinal}`,
        proposed_date: entry.date,
        date_slot_ordinal: ordinal,
        required_asset_type: assetType,
        execution_month: entry.date.slice(0, 7),
        calendar_row_type: IDEATION_ASSET_TYPE_TO_CALENDAR_ROW[assetType],
        placement_basis: entry.basis,
      });
    }
  }

  slots.sort((left, right) =>
    left.proposed_date < right.proposed_date
      ? -1
      : left.proposed_date > right.proposed_date
      ? 1
      : left.proposal_slot_key.localeCompare(right.proposal_slot_key)
  );

  const keys = new Set(slots.map((slot) => slot.proposal_slot_key));
  if (keys.size !== slots.length) {
    throw new Error("Slot planning produced a duplicate slot key.");
  }
  return slots;
}

/** Frozen planner manifest, hashed into the proposal configuration snapshot. */
export const IDEATION_SLOT_PLANNER_MANIFEST = Object.freeze({
  version: IDEATION_SLOT_PLANNER_VERSION,
  precedence: [
    "approved_execution_schedule_contract",
    "immutable_quantity_allocation",
    "deterministic_spread_across_inclusive_period",
  ],
  default_weekdays: IDEATION_DEFAULT_WEEKDAYS,
  slot_key_format: "{proposed_date}:{required_asset_type}:{date_slot_ordinal}",
  date_handling: "inclusive_utc_no_local_timezone_shift",
  spread_formula: "index -> floor(index * candidates.length / count)",
  asset_type_totals_are_exact: true,
  calendar_row_type_map: IDEATION_ASSET_TYPE_TO_CALENDAR_ROW,
});
