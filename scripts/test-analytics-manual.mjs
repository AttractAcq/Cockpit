import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/analytics-manual.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const analytics = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

assert.equal(analytics.analyticsContentKind("story_sequence", null), "story");
assert.equal(analytics.analyticsContentKind("feed_post", "IMAGE"), "feed");
assert.equal(analytics.metricFieldsForFormat("story_sequence").includes("taps_forward"), true);
assert.equal(analytics.metricFieldsForFormat("carousel").includes("saves"), true);
assert.deepEqual(analytics.sanitizeMetricPayload({ reach: "12", likes: "", impressions: "0" }, ["reach", "likes", "impressions"]), { reach: 12, impressions: 0 });
assert.throws(() => analytics.sanitizeMetricPayload({ reach: "-1" }, ["reach"]), /non-negative/);
assert.throws(() => analytics.sanitizeMetricPayload({ completion_rate: "101" }, ["completion_rate"]), /between 0 and 100/);
assert.deepEqual(analytics.sanitizeBusinessSignals({ inbound_dms: "2", cash_collected: "0", appointments: "" }), { inbound_dms: 2, cash_collected: 0, appointments: null });
assert.equal(analytics.deriveManualAnalyticsStatus(0, 0), "no_metrics");
assert.equal(analytics.deriveManualAnalyticsStatus(1, 0, 3), "metrics_entered");
assert.equal(analytics.deriveManualAnalyticsStatus(1, 1, 3), "business_signals_entered");
assert.equal(/publish|schedule|retry|reconcile|cancel/.test(Object.keys(analytics).join(" ")), false);

const apiSource = fs.readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260719000020_gate_b_manual_analytics.sql", import.meta.url), "utf8");
assert.match(apiSource, /rpc\("upsert_manual_metric_snapshot"/);
assert.match(apiSource, /rpc\("upsert_business_signal_snapshot"/);
assert.doesNotMatch(apiSource, /from\("client_metric_snapshots"\)\.insert/);
assert.doesNotMatch(apiSource, /from\("client_business_signal_snapshots"\)\.insert/);
assert.match(migration, /security definer set search_path = ''/);
assert.match(migration, /analytics requires a published or evidence-bearing distribution record/);
assert.match(migration, /revoke all on public\.client_metric_snapshots from public, anon, authenticated/);
assert.doesNotMatch(migration, /publish_distribution_record|retry_distribution_record|schedule_distribution_record|reconcile_distribution_record/);
assert.doesNotMatch(migration, /update public\.client_distribution_records/);
assert.doesNotMatch(migration, /update public\.client_analytics_records/);

console.log("analytics-manual tests passed");
