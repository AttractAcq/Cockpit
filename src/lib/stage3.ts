import { expectedCalendarCellCount, PHASE3_EXPECTED_COUNTS } from "../../supabase/functions/_shared/phase3-contract";

export const STAGE3_EXPECTED_COUNTS = PHASE3_EXPECTED_COUNTS;

export type Stage3Status = "not_started" | "in_progress" | "needs_review" | "complete" | "partial" | "failed";

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
  if (total === 0) return "not_started";
  const complete =
    snapshot.organicCount === STAGE3_EXPECTED_COUNTS.organic && snapshot.organicApproved === snapshot.organicCount &&
    snapshot.storyCount === STAGE3_EXPECTED_COUNTS.story && snapshot.storyApproved === snapshot.storyCount &&
    snapshot.adsCount === STAGE3_EXPECTED_COUNTS.ads && snapshot.adsApproved === snapshot.adsCount &&
    snapshot.calendarCount === snapshot.expectedCalendarCount && snapshot.calendarApproved === snapshot.calendarCount;
  if (complete) return "complete";
  const expectedPresent =
    snapshot.organicCount === STAGE3_EXPECTED_COUNTS.organic &&
    snapshot.storyCount === STAGE3_EXPECTED_COUNTS.story &&
    snapshot.adsCount === STAGE3_EXPECTED_COUNTS.ads &&
    snapshot.calendarCount === snapshot.expectedCalendarCount;
  return expectedPresent ? "needs_review" : "partial";
}

export const STAGE3_STATUS_LABELS: Record<Stage3Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_review: "Needs review",
  complete: "Complete",
  partial: "Partial",
  failed: "Failed",
};

export function currentExecutionMonth(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export { expectedCalendarCellCount };
