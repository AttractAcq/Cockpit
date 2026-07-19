import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../src/lib/lifecycle-date.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {}, require, console, Intl, Date, Map, Set };
vm.runInNewContext(output, context);
const lifecycle = context.exports;

assert.equal(lifecycle.normalizeDateKey("2026-07-14"), "2026-07-14");
assert.equal(lifecycle.normalizeDateKey("2026-07-14T23:30:00Z", "UTC"), "2026-07-14");
assert.equal(lifecycle.normalizeDateKey("2026-07-14T23:30:00Z", "Europe/Rome"), "2026-07-15");

const contextMaps = {
  mastersByRef: new Map([
    ["REF1", { ref: "REF1", distribution_date: "2026-07-20", content_type: "carousel" }],
    ["REF2", { ref: "REF2", distribution_date: null, content_type: "feed_post" }],
  ]),
  calendarDateByRef: new Map([["REF2", "2026-07-21"]]),
  briefsById: new Map([["BR1", { id: "BR1", source_ref: "REF1", asset_format: "carousel" }]]),
  briefsByRef: new Map([["REF1", { id: "BR1", source_ref: "REF1", asset_format: "carousel" }]]),
  distributionById: new Map([["DIST1", { id: "DIST1", source_ref: "REF1", planned_publish_date: "2026-07-22" }]]),
  distributionByRef: new Map([["REF1", { id: "DIST1", source_ref: "REF1", planned_publish_date: "2026-07-22" }]]),
};

assert.equal(lifecycle.resolveCanonicalPublishDate({ source_ref: "REF1", production_brief_id: "BR1" }, "asset", contextMaps).date, "2026-07-20");
assert.equal(lifecycle.resolveCanonicalPublishDate({ source_ref: "REF2", metadata: { calendar: [{ date: "2026-07-23" }] } }, "brief", contextMaps).date, "2026-07-21");
assert.equal(lifecycle.resolveCanonicalPublishDate({ source_ref: "REF3" }, "content", contextMaps).date, null);
assert.equal(lifecycle.resolveCanonicalPublishDate({ source_ref: "REF1", scheduled_publish_at: "2026-07-24T20:00:00Z", published_at: "2026-07-25T12:00:00Z" }, "distribution", contextMaps).date, "2026-07-24");
assert.equal(lifecycle.resolveCanonicalPublishDate({ source_ref: "REF1", distribution_record_id: "DIST1", published_at: "2026-07-25T12:00:00Z" }, "analytics", contextMaps).date, "2026-07-20");

const groups = lifecycle.groupLifecycleRecordsByDate([
  { source_ref: "REF1", production_brief_id: "BR1" },
  { source_ref: "REF3" },
  { source_ref: "REF2" },
], { lifecycleStage: "asset", context: contextMaps, direction: "asc" });
assert.equal(JSON.stringify(groups.map((group) => group.date)), JSON.stringify(["2026-07-20", "2026-07-21", null]));
assert.equal(groups.reduce((count, group) => count + group.records.length, 0), 3);

assert.equal(lifecycle.resolveLifecycleContentType({ asset_format: "feed_post" }).label, "Feed Post");
assert.equal(lifecycle.resolveLifecycleContentType({ asset_format: "carousel" }).label, "Carousel");
assert.equal(lifecycle.resolveLifecycleContentType({ asset_format: "reel_video" }).label, "Reel");
assert.equal(lifecycle.resolveLifecycleContentType({ story_type: "education" }).label, "Story");
assert.equal(lifecycle.resolveLifecycleContentType({ lane: "awareness" }).label, "Static Ad");
assert.equal(lifecycle.resolveLifecycleContentType({ asset_format: "legacy" }).label, "Legacy / Unknown");

console.log("lifecycle-date tests passed");
