import { expectedCalendarCellCount, PHASE3_EXPECTED_COUNTS } from "../../supabase/functions/_shared/phase3-contract";

export const STAGE3_EXPECTED_COUNTS = PHASE3_EXPECTED_COUNTS;

export type Stage3Status = "not_run" | "needs_review" | "complete";

export interface Stage3Snapshot {
  organicCount: number;
  storyCount: number;
  adsCount: number;
  calendarCount: number;
  organicApproved: number;
  storyApproved: number;
  adsApproved: number;
  calendarApproved: number;
  expectedCalendarCount: number;
}

export const EMPTY_STAGE3_SNAPSHOT: Stage3Snapshot = {
  organicCount: 0, storyCount: 0, adsCount: 0, calendarCount: 0,
  organicApproved: 0, storyApproved: 0, adsApproved: 0, calendarApproved: 0,
  expectedCalendarCount: 0,
};

export function deriveStage3Status(snapshot: Stage3Snapshot): Stage3Status {
  const total = snapshot.organicCount + snapshot.storyCount + snapshot.adsCount + snapshot.calendarCount;
  if (total === 0) return "not_run";
  const complete =
    snapshot.organicCount === STAGE3_EXPECTED_COUNTS.organic && snapshot.organicApproved === snapshot.organicCount &&
    snapshot.storyCount === STAGE3_EXPECTED_COUNTS.story && snapshot.storyApproved === snapshot.storyCount &&
    snapshot.adsCount === STAGE3_EXPECTED_COUNTS.ads && snapshot.adsApproved === snapshot.adsCount &&
    snapshot.calendarCount === snapshot.expectedCalendarCount && snapshot.calendarApproved === snapshot.calendarCount;
  return complete ? "complete" : "needs_review";
}

export function currentExecutionMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export { expectedCalendarCellCount };
