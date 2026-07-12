import type { CalendarCellRow, MasterRow, MasterTable } from "@/types/phase";

export type QaSeverity = "block" | "warn";
export interface QaFlag { code: string; label: string; severity: QaSeverity }

function textOf(row: MasterRow): string {
  return Object.values(row).filter((value) => typeof value === "string").join(" ");
}

export function masterDate(row: MasterRow): string | null {
  if ("distribution_date" in row) return row.distribution_date;
  return row.start_date;
}

export function masterType(table: MasterTable, row: MasterRow): string {
  if (table === "organic_master" && "content_type" in row) return row.content_type;
  if (table === "story_master" && "story_type" in row) return row.story_type ?? "Story";
  return "lane" in row ? row.lane : "Ad";
}

function isoRange(start: string, end: string): string[] {
  const first = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || first > last) return [];
  const dates: string[] = [];
  for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
  return dates;
}

export function qaFlags(table: MasterTable, row: MasterRow, cells?: CalendarCellRow[]): QaFlag[] {
  const flags: QaFlag[] = [];
  const text = textOf(row);
  const linked = cells?.filter((cell) => cell.ref === row.ref) ?? [];
  const affirmativeProofRisk = [
    /our clients (?:achieved|generated|saw|increased|grew)/i,
    /trusted by (?:hundreds|thousands|leading|top)/i,
    /guaranteed (?:leads|results|revenue|roi)/i,
    /\b(?:roi of|\d+(?:\.\d+)?x roi|\d+(?:\.\d+)?% roi)\b/i,
    /\btestimonial:\s*(?!not provided|none|absent|unavailable)/i,
    /\bcase stud(?:y|ies):\s*(?!not provided|none|absent|unavailable)/i,
  ].some((pattern) => pattern.test(text));
  if (affirmativeProofRisk) flags.push({ code: "proof-risk", label: "Proof risk", severity: "block" });

  if (table === "organic_master" && "notes" in row && !row.notes) flags.push({ code: "proof-boundary", label: "Missing proof notes", severity: "warn" });
  if (table === "story_master" && "proof_used" in row && (!row.proof_used || !row.what_not_to_claim)) flags.push({ code: "proof-boundary", label: "Missing proof boundary", severity: "warn" });
  if (table === "ads_master" && "creative_source" in row && (!row.creative_source || !row.notes)) flags.push({ code: "proof-boundary", label: "Missing proof source", severity: "warn" });

  if (table === "ads_master" && "start_date" in row) {
    if (!row.start_date || !row.end_date) flags.push({ code: "date", label: "Missing ad range", severity: "block" });
    else {
      const expectedDates = isoRange(row.start_date, row.end_date);
      const linkedDates = new Set(linked.map((cell) => cell.date));
      if (!expectedDates.length) flags.push({ code: "date", label: "Invalid ad range", severity: "block" });
      else if (cells && expectedDates.some((date) => !linkedDates.has(date))) flags.push({ code: "calendar", label: "Incomplete ad coverage", severity: "block" });
    }
  } else if ("distribution_date" in row) {
    if (!row.distribution_date) flags.push({ code: "date", label: "Missing publish date", severity: "block" });
    else if (cells && !linked.some((cell) => cell.date === row.distribution_date)) flags.push({ code: "calendar", label: "Calendar link missing", severity: "block" });
  }
  if (cells && !linked.length) flags.push({ code: "calendar", label: "No calendar cells", severity: "block" });
  if (cells && linked.some((cell) => cell.review_state !== row.review_state)) flags.push({ code: "review-sync", label: "Review state mismatch", severity: "warn" });
  return flags.filter((flag, index, all) => all.findIndex((candidate) => candidate.code === flag.code) === index);
}

export function proofRisk(flags: QaFlag[]): boolean {
  return flags.some((flag) => flag.code === "proof-risk" || flag.code === "proof-boundary");
}
