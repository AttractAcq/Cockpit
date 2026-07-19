import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/performance-intelligence.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const perf = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const base = { distributionRecordId:"d1",sourceRef:"JUL-FP-001",contentFormat:"feed_post",platform:"instagram",publishedAt:"2026-07-01T00:00:00Z" };

const missing = perf.calculatePerformanceScore(base,new Date("2026-07-10T00:00:00Z"));
assert.equal(missing.sample_quality,"insufficient");
assert.equal(missing.score_status,"pending_metrics");
assert.equal(missing.overall_score,0);

const zero = perf.calculatePerformanceScore({...base,metricSnapshotId:"m0",metrics:{reach:0,likes:0}},new Date("2026-07-10T00:00:00Z"));
assert.equal(zero.sample_quality,"insufficient");
assert.match(zero.score_reasons.join(" "),/insufficient data, not underperformance/i);

const usableInput = {...base,metricSnapshotId:"m1",metrics:{reach:800,likes:100,comments:20,shares:30,saves:50,profile_visits:20}};
const usable = perf.calculatePerformanceScore(usableInput,new Date("2026-07-03T00:00:00Z"));
assert.equal(usable.sample_quality,"usable");
assert.ok(usable.overall_score>0);
assert.ok(usable.score_reasons.some((reason)=>reason.includes("Signal detected, not a conclusion")));

const winner = perf.generateInsightCandidates({...usable,overall_score:80},usableInput,[30,40,45,50]);
assert.ok(winner.some((item)=>item.insight_type==="winner"));
const matureLow = {...usable,overall_score:10,attention_score:10,engagement_score:10,sample_quality:"mature"};
assert.ok(perf.generateInsightCandidates(matureLow,{...usableInput,businessSignalSnapshotId:"b1"},[50,55,60]).some((item)=>item.insight_type==="underperformer"));

const ctaInput = {...usableInput,metrics:{reach:200,profile_visits:25},businessSignals:{inbound_dms:0}};
assert.ok(perf.generateInsightCandidates(perf.calculatePerformanceScore(ctaInput,new Date("2026-07-03T00:00:00Z")),ctaInput,[]).some((item)=>item.insight_type==="cta_signal"));
const conversionInput = {...usableInput,businessSignalSnapshotId:"b1",businessSignals:{inbound_dms:20,qualified_dms:10,appointments:8,show_ups:5,cash_collected:5000}};
assert.ok(perf.generateInsightCandidates(perf.calculatePerformanceScore(conversionInput,new Date("2026-07-10T00:00:00Z")),conversionInput,[20,30,40]).some((item)=>item.insight_type==="conversion_signal"));

const story = perf.calculatePerformanceScore({...base,contentFormat:"story_sequence",metricSnapshotId:"m2",metrics:{reach:100,replies:10,shares:5,taps_back:20}},new Date("2026-07-02T00:00:00Z"));
assert.ok(story.engagement_score>0);

const api = fs.readFileSync(new URL("../src/lib/api.ts",import.meta.url),"utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260719000022_gate_d_performance_intelligence.sql",import.meta.url),"utf8");
const ownershipFix = fs.readFileSync(new URL("../supabase/migrations/20260719000023_gate_d_snapshot_ownership_fix.sql",import.meta.url),"utf8");
assert.doesNotMatch(source+api+migration+ownershipFix,/openai|anthropic|launch[_ ]ads|media_publish|converted_to_iteration.*update/i);
assert.doesNotMatch(api,/client_distribution_records"\)\.update|client_metric_snapshots"\)\.update|client_business_signal_snapshots"\)\.update/);
assert.doesNotMatch(migration,/update public\.client_distribution_records|update public\.client_metric_snapshots|update public\.client_business_signal_snapshots/);
assert.match(migration,/security definer set search_path=''/);
assert.match(migration,/revoke all on public\.client_performance_analysis_runs,public\.client_performance_scores,public\.client_performance_insights from public,anon,authenticated/);
assert.match(ownershipFix,/s\.id = p_latest_metric_snapshot_id[\s\S]*s\.client_id = d\.client_id[\s\S]*s\.distribution_record_id = d\.id/);
assert.match(ownershipFix,/metric snapshot does not belong to this distribution record/);
assert.match(ownershipFix,/s\.id = p_latest_business_signal_snapshot_id[\s\S]*s\.client_id = d\.client_id[\s\S]*s\.distribution_record_id = d\.id/);
assert.match(ownershipFix,/business signal snapshot does not belong to this distribution record/);
assert.match(ownershipFix,/p_latest_metric_snapshot_id is not null/);
assert.match(ownershipFix,/p_latest_business_signal_snapshot_id is not null/);
assert.match(ownershipFix,/security definer\s+set search_path = ''/);
assert.doesNotMatch(ownershipFix,/update public\.client_distribution_records|update public\.client_metric_snapshots|update public\.client_business_signal_snapshots/);
console.log("performance-intelligence tests passed");
