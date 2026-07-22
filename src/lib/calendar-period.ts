export type CalendarPeriodView = "week" | "month";

export function startOfCalendarWeek(value: Date): Date {
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
  const day = date.getDay() || 7;
  date.setDate(date.getDate() + 1 - day);
  return date;
}

export function startOfCalendarMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

export function calendarPeriodStart(view: CalendarPeriodView, anchor: Date): Date {
  return view === "week" ? startOfCalendarWeek(anchor) : startOfCalendarMonth(anchor);
}

export function calendarPeriodEnd(view: CalendarPeriodView, anchor: Date): Date {
  const start = calendarPeriodStart(view, anchor);
  return view === "week"
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
    : new Date(start.getFullYear(), start.getMonth() + 1, 1);
}

export function shiftCalendarPeriod(view: CalendarPeriodView, anchor: Date, amount: number): Date {
  const start = calendarPeriodStart(view, anchor);
  return view === "week"
    ? new Date(start.getFullYear(), start.getMonth(), start.getDate() + amount * 7)
    : new Date(start.getFullYear(), start.getMonth() + amount, 1);
}

export function calendarPeriodLabel(view: CalendarPeriodView, anchor: Date): string {
  const start = calendarPeriodStart(view, anchor);
  if (view === "month") return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const end = new Date(calendarPeriodEnd(view, anchor).getTime() - 1);
  const startLabel = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

export function dateInCalendarPeriod(value: string, view: CalendarPeriodView, anchor: Date): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date >= calendarPeriodStart(view, anchor) && date < calendarPeriodEnd(view, anchor);
}

export function localCalendarDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function preferredRecordDate(record: Record<string, unknown>, fallback?: string | null): string | null {
  for (const key of ["published_at", "publication_date", "scheduled_publish_at", "planned_publish_date", "distribution_date", "performance_snapshot_at", "created_at"]) {
    const value = record[key];
    if (typeof value === "string" && value && !Number.isNaN(new Date(value).getTime())) return value;
  }
  return fallback && !Number.isNaN(new Date(fallback).getTime()) ? fallback : null;
}
