import { Button } from "@/components/primitives";
import { calendarPeriodLabel, shiftCalendarPeriod, type CalendarPeriodView } from "@/lib/calendar-period";

export function CalendarPeriodControls({ view, anchor, onViewChange, onAnchorChange }: {
  view: CalendarPeriodView; anchor: Date;
  onViewChange: (view: CalendarPeriodView) => void;
  onAnchorChange: (date: Date) => void;
}) {
  return <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-ink-200 px-4 py-3">
    <div className="min-w-40"><div className="text-sm font-medium text-paper">{calendarPeriodLabel(view, anchor)}</div><div className="mt-1 text-2xs text-paper-3">Browser local time</div></div>
    <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label={`Previous ${view}`} onClick={() => onAnchorChange(shiftCalendarPeriod(view, anchor, -1))}>← Previous</Button><Button size="sm" variant="ghost" onClick={() => onAnchorChange(new Date())}>Today</Button><Button size="sm" variant="ghost" aria-label={`Next ${view}`} onClick={() => onAnchorChange(shiftCalendarPeriod(view, anchor, 1))}>Next →</Button></div>
    <div className="ml-auto flex rounded-md border border-line bg-ink p-0.5" role="group" aria-label="Calendar view">
      {(["week", "month"] as const).map((option) => <button key={option} aria-pressed={view === option} className={`rounded px-3 py-1 text-xs ${view === option ? "bg-teal/15 text-teal" : "text-paper-3"}`} onClick={() => onViewChange(option)}>{option === "week" ? "Week" : "Month"}</button>)}
    </div>
  </div>;
}
