import assert from "node:assert/strict";
import fs from "node:fs";

const analytics = fs.readFileSync(new URL("../src/components/client/AnalyticsPanel.tsx", import.meta.url), "utf8");
const overview = fs.readFileSync(new URL("../src/components/client/ClientOverviewPanel.tsx", import.meta.url), "utf8");
const calendar = fs.readFileSync(new URL("../src/components/client/Phase3CalendarPanel.tsx", import.meta.url), "utf8");
const detail = fs.readFileSync(new URL("../src/pages/ClientDetailPage.tsx", import.meta.url), "utf8");

assert.match(analytics, /h-full min-h-0 flex-1[^"\n]*overflow-y-auto/, "Analytics must own a bounded vertical scroll viewport");
assert.match(overview, /fetchPipelineMetrics\(clientId, executionMonth\)/, "Overview must load live Pipeline metrics");
assert.doesNotMatch(overview, /data source not connected/, "Overview must not show the disconnected Pipeline placeholder");
assert.match(detail, /ClientOverviewPanel[^>]*executionMonth=\{currentMonth\(\)\}/, "Overview must receive the active execution month");
assert.match(calendar, /useState<View>\("week"\)/, "Calendar must default to week view");
assert.match(calendar, /useState\(\(\) => monday\(localTodayAsUtc\(\)\)\)/, "Calendar must initialize to the current local week");

console.log("core UI navigation tests passed");
