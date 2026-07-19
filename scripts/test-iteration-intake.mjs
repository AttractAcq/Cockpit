import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const helperSource = fs.readFileSync(new URL("../src/lib/iteration-intake.ts", import.meta.url), "utf8");
const js = ts.transpileModule(helperSource,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const intake = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const migration = fs.readFileSync(new URL("../supabase/migrations/20260719000024_gate_e_iteration_intake.sql", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
const analytics = fs.readFileSync(new URL("../src/components/client/AnalyticsPanel.tsx", import.meta.url), "utf8");
const archive = fs.readFileSync(new URL("../src/components/client/ArchivePanel.tsx", import.meta.url), "utf8");
const scope = helperSource + migration + api + analytics + archive;

assert.equal(intake.validIterationTransition("needs_review","approved"),true);
assert.equal(intake.validIterationTransition("needs_review","dismissed"),true);
assert.equal(intake.validIterationTransition("approved","converted"),true);
assert.equal(intake.validIterationTransition("approved","dismissed"),true);
assert.equal(intake.validIterationTransition("dismissed","dismissed"),true);
assert.equal(intake.validIterationTransition("dismissed","approved"),false);
assert.equal(intake.validIterationTransition("converted","approved"),false);
assert.equal(intake.validIterationTransition("converted","dismissed"),false);

const evidence = intake.iterationEvidenceFromScore({overall_score:42,attention_score:40,engagement_score:41,trust_score:43,conversion_signal_score:44,sample_quality:"usable",score_status:"scored",score_reasons:["Signal detected, not a conclusion."]},{reach:100});
assert.equal(evidence.overall_score,42);
assert.deepEqual(evidence.latest_metrics,{reach:100});

// Score-backed creation works even when no performance insight exists; insight-backed intake is also supported.
assert.match(analytics,/performanceScoreId:summary\.performance_score\.id/);
assert.match(analytics,/createdFrom:insightId\?"performance_insight":"performance_score"/);
assert.match(analytics,/Performance scorecard/);
assert.match(analytics,/Performance insight:/);

// Every supplied reference is resolved and checked against client, distribution, and source ownership.
assert.match(migration,/from public\.client_performance_scores where id=p_performance_score_id and client_id=p_client_id/);
assert.match(migration,/performance score does not belong to distribution record/);
assert.match(migration,/performance score does not belong to source ref/);
assert.match(migration,/from public\.client_performance_insights where id=p_performance_insight_id and client_id=p_client_id/);
assert.match(migration,/performance insight does not belong to distribution record/);
assert.match(migration,/performance insight does not belong to source ref/);
assert.match(migration,/distribution record does not belong to client/);

// Only active candidates dedupe; dismissed/converted history does not block a later proposal.
assert.match(migration,/create unique index client_iteration_candidates_open_unique[\s\S]*where status in \('needs_review','approved'\)/);
assert.doesNotMatch(migration,/where status in \([^)]*dismissed|where status in \([^)]*converted/);

assert.match(migration,/security definer set search_path=''/);
assert.match(migration,/revoke all on public\.client_iteration_candidates,public\.client_iteration_reviews from public,anon,authenticated/);
assert.match(migration,/grant select on public\.client_iteration_candidates,public\.client_iteration_reviews to authenticated/);
assert.match(migration,/iteration_candidate_created/);
assert.match(migration,/iteration_candidate_approved/);
assert.match(migration,/iteration_candidate_dismissed/);
assert.match(migration,/iteration_candidate_converted/);
assert.match(api,/rpc\("create_iteration_candidate"/);
assert.match(api,/rpc\("update_iteration_candidate_status"/);
assert.doesNotMatch(api,/from\("client_iteration_(?:candidates|reviews)"\)\.(?:insert|update|delete)/);

assert.doesNotMatch(scope,/update public\.client_distribution_records|update public\.client_metric_snapshots|update public\.client_business_signal_snapshots|update public\.client_performance_scores/);
assert.doesNotMatch(scope,/openai|anthropic|launch[_ ]ads|media_publish|generate[_ ](?:content|asset)|update (?:strategy|context)|calendar.*insert/i);
assert.match(archive,/Approved candidates do not automatically change strategy/);
assert.match(archive,/Converted means reviewed for future workflow; no files are changed in this gate/);

console.log("iteration-intake tests passed");
