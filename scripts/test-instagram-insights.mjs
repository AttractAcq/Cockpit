import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const helperSource = fs.readFileSync(new URL("../supabase/functions/_shared/instagram-insights.ts", import.meta.url), "utf8");
const js = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const insights = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const publishedAt = "2026-07-01T00:00:00.000Z";
const feed = { publish_status: "published", external_post_id: "123", published_at: publishedAt, platform: "instagram", asset_format: "feed_post", publish_settings: { content_type: "IMAGE" } };
const carousel = { ...feed, asset_format: "carousel", publish_settings: { content_type: "CAROUSEL" } };
const story = { ...feed, asset_format: "story_sequence", publish_settings: { content_type: "STORIES" } };

assert.equal(insights.nextDueSnapshot(feed, [], new Date("2026-07-01T00:59:59Z")), null);
assert.equal(insights.nextDueSnapshot(feed, [], new Date("2026-07-01T01:00:00Z")).label, "t_plus_1h");
assert.equal(insights.nextDueSnapshot(carousel, ["t_plus_1h"], new Date("2026-07-01T06:00:00Z")).label, "t_plus_6h");
assert.equal(insights.nextDueSnapshot(feed, ["t_plus_1h","t_plus_6h","t_plus_24h","t_plus_48h"], new Date("2026-07-08T00:00:00Z")).label, "t_plus_7d");
assert.equal(insights.nextDueSnapshot(story, [], new Date("2026-07-01T01:00:00Z")).label, "story_t_plus_1h");
assert.equal(insights.nextDueSnapshot(story, ["story_t_plus_1h","story_t_plus_6h"], new Date("2026-07-01T23:00:00Z")).label, "story_t_plus_23h");
assert.equal(insights.nextDueSnapshot(story, [], new Date("2026-07-02T01:00:00Z")).expired, true);
assert.equal(insights.clampBatchSize(0), 1);
assert.equal(insights.clampBatchSize(99), 20);
assert.equal(insights.clampBatchSize("bad"), 5);
assert.equal(insights.metricsForKind("feed").includes("saved"), true);
assert.equal(insights.metricsForKind("story").includes("navigation"), true);
assert.equal(insights.metricsForKind("unsupported").length, 0);
assert.deepEqual(insights.normalizeMetaInsights([{ name: "reach", values: [{ value: 12 }] }, { name: "saved", value: 3 }, { name: "navigation", value: { taps_forward: 2 } }]), { reach: 12, saves: 3 });
assert.equal(insights.classifyInsightsError(400, { error: { code: 100, message: "Unsupported metric" } }), "meta_unsupported_metric");
assert.equal(insights.classifyInsightsError(401, { error: { code: 190 } }), "meta_authentication");
for (const status of ["ready","scheduled","failed","cancelled"]) assert.equal(insights.isCollectable({ ...feed, publish_status: status }), false);
assert.equal(insights.isCollectable({ ...feed, external_post_id: null }), false);
assert.equal(insights.isCollectable(feed), true);

const worker = fs.readFileSync(new URL("../supabase/functions/collect-instagram-insights/index.ts", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260719000021_gate_c_instagram_insights_collection.sql", import.meta.url), "utf8");
const functionConfig = fs.readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
const dryStart = worker.indexOf("if (dryRun)");
const liveWrite = worker.indexOf('from("client_insights_collection_runs").insert');
assert.ok(dryStart > 0 && liveWrite > dryStart && worker.slice(dryStart, liveWrite).includes("return json"), "dry run must return before writes");
assert.ok(worker.indexOf('Deno.env.get("CRON_SECRET")') < worker.indexOf("const sb = svc()"), "secret gate must precede service-role client creation");
assert.match(worker, /GRAPH_VERSION = "v24\.0"/);
assert.doesNotMatch(worker, /client_distribution_records"\)\.update|publish_status\s*:/);
assert.doesNotMatch(worker, /media_publish|schedule_distribution|retry_distribution|reconcile_distribution|cancel_distribution/);
assert.match(worker, /rpc\("persist_instagram_insights_collection"/);
assert.match(migration, /where collection_method = 'api'/);
assert.match(migration, /unique index if not exists client_metric_snapshots_api_label_unique/);
assert.match(migration, /security definer set search_path = ''/);
assert.match(migration, /revoke all on function public\.persist_instagram_insights_collection[^;]+from public,anon,authenticated/);
assert.doesNotMatch(migration, /delete from public\.client_metric_snapshots|update public\.client_distribution_records/);
assert.match(functionConfig, /\[functions\.collect-instagram-insights\]\s+verify_jwt = false/);
const workerCompile = ts.transpileModule(worker, { reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
assert.equal((workerCompile.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error).length, 0, "worker must parse as TypeScript");

console.log("instagram-insights tests passed");
