// Ideation Stage 3 — read-only operational Calendar conflict snapshot.
//
// Stage 3 READS calendar_cells and the content masters purely to classify
// whether a proposed placement collides with existing operational content. It
// never writes to them, and it never stores their content bodies — only the
// bounded identity needed for conflict display and drift detection.

import { sha256, stableJson } from "../hash.ts";
import type { IdeationAssetType, ProposalSlot } from "./slot-planner.ts";

export const IDEATION_CONFLICT_SNAPSHOT_VERSION = "aa.ideation.calendar-conflict.v1";

/** Canonical conflict states. Persisted and rendered as text, never colour alone. */
export const IDEATION_CONFLICT_STATUSES = [
  "clear",
  "occupied",
  "protected",
  "date_capacity_exceeded",
  "stale_calendar_snapshot",
] as const;

export type IdeationConflictStatus = typeof IDEATION_CONFLICT_STATUSES[number];

/** A conflict that must be resolved before a proposal can be approved. */
export const BLOCKING_CONFLICT_STATUSES: readonly IdeationConflictStatus[] = [
  "protected",
  "date_capacity_exceeded",
  "stale_calendar_snapshot",
] as const;

export function isBlockingConflict(status: string): boolean {
  return (BLOCKING_CONFLICT_STATUSES as readonly string[]).includes(status);
}

/** Bounded projection of one operational calendar row. No content body. */
export interface CalendarOccupancyRow {
  id: string;
  date: string;
  row_type: string;
  ref: string;
  review_state: string;
  updated_at: string;
}

export interface CalendarConflictSnapshot {
  version: string;
  period_start: string;
  period_end: string;
  /** Bounded operational rows overlapping the period, in stable order. */
  occupancy: CalendarOccupancyRow[];
  /** Digest used to detect Calendar drift between proposal and approval. */
  digest: string;
  captured_row_count: number;
}

/**
 * An approved or archived operational row is protected: a proposal must not
 * silently plan over it. A needs_review or rejected row is merely occupied and
 * the operator may knowingly proceed.
 */
function isProtected(row: CalendarOccupancyRow): boolean {
  return row.review_state === "approved" || row.review_state === "archived";
}

export async function buildCalendarConflictSnapshot(input: {
  periodStart: string;
  periodEnd: string;
  rows: CalendarOccupancyRow[];
}): Promise<CalendarConflictSnapshot> {
  const occupancy = [...input.rows]
    .map((row) => ({
      id: row.id,
      date: row.date,
      row_type: row.row_type,
      ref: row.ref,
      review_state: row.review_state,
      updated_at: row.updated_at,
    }))
    .sort((left, right) =>
      left.date < right.date ? -1
      : left.date > right.date ? 1
      : left.row_type < right.row_type ? -1
      : left.row_type > right.row_type ? 1
      : left.id.localeCompare(right.id)
    );
  return {
    version: IDEATION_CONFLICT_SNAPSHOT_VERSION,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    occupancy,
    digest: await sha256(stableJson(occupancy)),
    captured_row_count: occupancy.length,
  };
}

export interface SlotConflict {
  proposal_slot_key: string;
  conflict_status: IdeationConflictStatus;
  conflict_details: {
    matched_rows: Array<{ id: string; ref: string; review_state: string; row_type: string }>;
    reason: string | null;
    date_capacity?: { placed: number; existing: number };
  };
}

/**
 * Classifies every planned slot against the bounded Calendar snapshot.
 *
 * A slot is protected when an approved or archived operational row already holds
 * the same date and lane; occupied when an unapproved row does; and capacity
 * exceeded when the proposal itself would place more items of one asset type on
 * one date than the Calendar plus proposal can carry without collision.
 */
export function classifySlotConflicts(input: {
  slots: ProposalSlot[];
  snapshot: CalendarConflictSnapshot;
}): SlotConflict[] {
  const byDateAndRow = new Map<string, CalendarOccupancyRow[]>();
  for (const row of input.snapshot.occupancy) {
    const key = `${row.date}:${row.row_type}`;
    byDateAndRow.set(key, [...(byDateAndRow.get(key) ?? []), row]);
  }

  // How many proposal slots target each (date, row_type) pair.
  const proposalDensity = new Map<string, number>();
  for (const slot of input.slots) {
    const key = `${slot.proposed_date}:${slot.calendar_row_type}`;
    proposalDensity.set(key, (proposalDensity.get(key) ?? 0) + 1);
  }

  return input.slots.map((slot) => {
    const key = `${slot.proposed_date}:${slot.calendar_row_type}`;
    const matched = byDateAndRow.get(key) ?? [];
    const protectedRows = matched.filter(isProtected);
    const placed = proposalDensity.get(key) ?? 0;

    if (protectedRows.length > 0) {
      return {
        proposal_slot_key: slot.proposal_slot_key,
        conflict_status: "protected" as const,
        conflict_details: {
          matched_rows: protectedRows.map((row) => ({
            id: row.id,
            ref: row.ref,
            review_state: row.review_state,
            row_type: row.row_type,
          })),
          reason: "Approved operational content already occupies this date and lane.",
        },
      };
    }
    if (matched.length > 0) {
      return {
        proposal_slot_key: slot.proposal_slot_key,
        conflict_status: "occupied" as const,
        conflict_details: {
          matched_rows: matched.map((row) => ({
            id: row.id,
            ref: row.ref,
            review_state: row.review_state,
            row_type: row.row_type,
          })),
          reason: "Unapproved operational content already occupies this date and lane.",
        },
      };
    }
    if (placed > 1 && placed + matched.length > MAX_PER_DATE_AND_LANE) {
      return {
        proposal_slot_key: slot.proposal_slot_key,
        conflict_status: "date_capacity_exceeded" as const,
        conflict_details: {
          matched_rows: [],
          reason: "More placements target this date and lane than it can carry.",
          date_capacity: { placed, existing: matched.length },
        },
      };
    }
    return {
      proposal_slot_key: slot.proposal_slot_key,
      conflict_status: "clear" as const,
      conflict_details: { matched_rows: [], reason: null },
    };
  });
}

/**
 * Maximum placements of one asset type on one date before the proposal is
 * treated as over-concentrated. Two is tolerated because a short period with a
 * high quantity contract legitimately doubles up.
 */
export const MAX_PER_DATE_AND_LANE = 2;

/** True when the live Calendar has drifted from the snapshot the proposal used. */
export function calendarSnapshotIsStale(
  snapshot: CalendarConflictSnapshot,
  currentDigest: string,
): boolean {
  return snapshot.digest !== currentDigest;
}
