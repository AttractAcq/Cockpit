import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const periodSource = fs.readFileSync(new URL("../src/lib/calendar-period.ts", import.meta.url), "utf8");
const periodJs = ts.transpileModule(periodSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const period = await import(`data:text/javascript;base64,${Buffer.from(periodJs).toString("base64")}`);

const anchor = new Date(2026, 6, 22, 12);
assert.equal(period.startOfCalendarWeek(anchor).getDay(), 1, "weeks start Monday");
assert.equal(period.shiftCalendarPeriod("week", anchor, -1).getDate(), 13, "previous week moves seven days");
assert.equal(period.shiftCalendarPeriod("week", anchor, 1).getDate(), 27, "next week moves seven days");
assert.equal(period.shiftCalendarPeriod("month", anchor, 1).getMonth(), 7, "next month advances one month");
assert.match(period.calendarPeriodLabel("week", anchor), /2026/, "week label includes a clear range and year");
assert.match(period.calendarPeriodLabel("month", anchor), /2026/, "month label includes month and year");
assert.equal(period.dateInCalendarPeriod(new Date(2026, 6, 22, 12).toISOString(), "week", anchor), true);
assert.equal(period.dateInCalendarPeriod(new Date(2026, 6, 12, 12).toISOString(), "week", anchor), false);
assert.equal(period.dateInCalendarPeriod(new Date(2026, 6, 31, 12).toISOString(), "month", anchor), true);
assert.equal(period.preferredRecordDate({ published_at:"2026-07-20", planned_publish_date:"2026-07-19", created_at:"2026-07-18" }), "2026-07-20");
assert.equal(period.preferredRecordDate({ published_at:null, planned_publish_date:"2026-07-19", created_at:"2026-07-18" }), "2026-07-19");
assert.equal(period.preferredRecordDate({ created_at:"2026-07-18" }, "2026-07-17"), "2026-07-18");
assert.equal(period.preferredRecordDate({ performance_snapshot_at:"2026-07-17", created_at:"2026-07-18" }), "2026-07-17");

const controls = fs.readFileSync(new URL("../src/components/client/CalendarPeriodControls.tsx", import.meta.url), "utf8");
const analytics = fs.readFileSync(new URL("../src/components/client/AnalyticsPanel.tsx", import.meta.url), "utf8");
const performance = fs.readFileSync(new URL("../src/components/client/PerformanceIterationPanel.tsx", import.meta.url), "utf8");
assert.match(controls, /Previous/); assert.match(controls, /Today/); assert.match(controls, /Next/); assert.match(controls, /Week/); assert.match(controls, /Month/);
assert.match(analytics, /useState<CalendarPeriodView>\("week"\)/); assert.match(performance, /useState<CalendarPeriodView>\("week"\)/);
assert.match(analytics, /No analytics records for this \{periodView\}/); assert.match(performance, /No performance records for this \{periodView\}/);
assert.match(analytics, /h-full min-h-0 flex-1[^"\n]*overflow-y-auto/);
assert.match(performance, /Scored assets/); assert.match(performance, /Average score/); assert.match(performance, /Top asset/); assert.match(performance, /Lowest asset/); assert.match(performance, /Iteration candidates/);
assert.match(performance, /onClick=\{\(\)=>setScorecardId\(summary\.record\.id\)\}/, "asset ref opens scorecard modal");
assert.match(performance, /role="dialog"/); assert.match(performance, /aria-modal="true"/); assert.match(performance, /event\.key === "Escape"/);
assert.match(performance, /Metric breakdown/); assert.match(performance, /Business signals/); assert.match(performance, /Iteration recommendation \/ status/);
assert.match(performance, />Asset<\/Link>/); assert.match(performance, />Distribution record<\/Link>/); assert.match(performance, />Analytics record<\/Link>/);
assert.doesNotMatch(performance.slice(performance.indexOf("function ScorecardModal"), performance.indexOf("export function PerformanceIterationPanel")), /createIterationCandidate|runDeterministicPerformanceAnalysis|updateIterationCandidateStatus/, "opening/rendering the modal is read-only");
assert.match(performance, /onClick=\{\(\)=>void analyze\(\)\}/, "performance analysis remains explicit");
assert.match(performance, /onClick=\{\(\)=>void createCandidate\(\)\}/, "candidate creation remains explicit");

console.log("calendarized analytics/performance tests passed");
