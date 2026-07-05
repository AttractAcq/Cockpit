export const PHASE3_EXPECTED_COUNTS = {
  organic: 32,
  story: 28,
  ads: 4,
} as const;

export interface CanonicalAdRange {
  lane: "Ad 1" | "Ad 2" | "Ad 3";
  startDay: number;
  endDay: number;
}

export function daysInExecutionMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

// Four monthly stints across three concurrent calendar lanes. The fourth
// reuses Ad 1 only after its first stint has ended.
export function canonicalAdRanges(month: string): CanonicalAdRange[] {
  const days = daysInExecutionMonth(month);
  return [
    { lane: "Ad 1", startDay: 1, endDay: Math.min(14, days) },
    { lane: "Ad 2", startDay: Math.min(8, days), endDay: Math.min(21, days) },
    { lane: "Ad 3", startDay: Math.min(15, days), endDay: days },
    { lane: "Ad 1", startDay: Math.min(22, days), endDay: days },
  ];
}

export function expectedCalendarCellCount(month: string): number {
  const organicAndStories = PHASE3_EXPECTED_COUNTS.organic + PHASE3_EXPECTED_COUNTS.story;
  const activeAdDays = canonicalAdRanges(month).reduce((total, range) => total + range.endDay - range.startDay + 1, 0);
  return organicAndStories + activeAdDays;
}
