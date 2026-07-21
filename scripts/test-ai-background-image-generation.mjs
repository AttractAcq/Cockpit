import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const migration = readFileSync("supabase/migrations/20260720000027_ai_background_image_generation.sql", "utf8");
const repairMigration = readFileSync("supabase/migrations/20260720000028_ai_background_prompt_validation_repair.sql", "utf8");
const recoveryMigration = readFileSync("supabase/migrations/20260721000029_ai_background_stale_generation_recovery.sql", "utf8");
const asyncMigration = readFileSync("supabase/migrations/20260721000030_ai_background_async_provider.sql", "utf8");
const submitEdge = readFileSync("supabase/functions/generate-ai-background-image/index.ts", "utf8");
const checkEdge = readFileSync("supabase/functions/check-ai-background-image/index.ts", "utf8");
const helperSource = readFileSync("supabase/functions/_shared/ai-background-image.ts", "utf8");
const api = readFileSync("src/lib/api.ts", "utf8");
const ui = readFileSync("src/components/client/ContentCreationPanel.tsx", "utf8");
const all = `${migration}\n${repairMigration}\n${recoveryMigration}\n${asyncMigration}\n${submitEdge}\n${checkEdge}\n${api}\n${ui}`;

for (const name of ["client_ai_background_image_generations", "client_ai_background_image_reviews", "create_ai_background_prompt", "update_ai_background_prompt", "generate_ai_background_image"]) assert.ok(migration.includes(name), `missing ${name}`);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all[\s\S]*from public,anon,authenticated/i);
assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*to authenticated/i);
for (const predicate of ["production_brief_id is not null", "b.client_id=client_ai_background_image_generations.client_id", "b.source_ref=client_ai_background_image_generations.source_ref", "b.asset_format=client_ai_background_image_generations.format", "b.status='approved'", "brief_fingerprint_at_approval"]) assert.ok(migration.includes(predicate), `missing claim-time validation: ${predicate}`);
assert.match(migration, /STALE_BRIEF: production brief changed after prompt creation/);
assert.match(repairMigration, /VALIDATION: prompt text cannot be blank/);
assert.match(recoveryMigration, /recover_stale_ai_background_generation/);

for (const field of ["provider_request_id", "provider_input_file_id", "provider_status", "provider_submitted_at", "provider_checked_at", "provider_completed_at", "provider_expires_at", "last_provider_error", "check_count"]) assert.match(asyncMigration, new RegExp(field), `missing async field ${field}`);
for (const status of ["provider_submitted", "checking"]) assert.match(asyncMigration, new RegExp(status), `missing async status ${status}`);
for (const predicate of ["prompt_status in ('generating','provider_submitted','checking')", "storage_path is null", "generated_at is null", "provider_response='{}'::jsonb", "updated_at<now()-interval '5 minutes'"]) assert.ok(asyncMigration.includes(predicate), `missing async recovery predicate: ${predicate}`);
assert.doesNotMatch(asyncMigration, /client_assets|client_distribution_records|client_metric_snapshots|client_business_signal_snapshots|client_performance_scores|client_context_files|client_execution_files|generate-phase-3|openai|cron\./i);

assert.match(submitEdge, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
assert.ok(submitEdge.indexOf("const config=resolveImageConfiguration") < submitEdge.indexOf('sb.rpc("generate_ai_background_image"'), "configuration validation must precede claim");
assert.ok(submitEdge.indexOf('sb.rpc("generate_ai_background_image"') < submitEdge.indexOf("submitAiBackgroundBatch({"), "claim must precede provider submission");
assert.match(submitEdge, /prompt_status:"provider_submitted"/);
assert.match(submitEdge, /provider_request_id:submitted\.batchId/);
assert.doesNotMatch(submitEdge, /storage\.from|client-assets|generate-feed-post-asset|publish|generate-phase-3/);

assert.match(helperSource, /https:\/\/api\.openai\.com\/v1\/files/);
assert.match(helperSource, /https:\/\/api\.openai\.com\/v1\/batches/);
assert.match(helperSource, /endpoint: "\/v1\/images\/generations"/);
assert.match(helperSource, /completion_window: "24h"/);
assert.match(checkEdge, /provider_request_id/);
assert.match(checkEdge, /prompt_status: "checking"/);
assert.match(checkEdge, /prompt_status: "provider_submitted"/);
assert.match(checkEdge, /prompt_status: "generated"/);
assert.match(checkEdge, /prompt_status: "failed"/);
assert.match(checkEdge, /upsert: false/);
assert.match(checkEdge, /storage\.from\(BUCKET\)\.remove/);
assert.doesNotMatch(checkEdge, /\/v1\/images\/generations|submitAiBackgroundBatch|generate-feed-post-asset|publish|generate-phase-3/);
assert.match(api, /check-ai-background-image/);
assert.match(ui, /Check result/);
assert.match(ui, /provider_submitted/);
assert.match(ui, /Final assets still require the normal Produce Asset flow/);
assert.match(ui, /Publishing is not triggered/);
assert.match(ui, /Use as background for this asset/);
const visualOptions = ui.match(/\(\[([\s\S]*?)\] as \[AiVisualMode, string, string\]\[\]\)\.map/)?.[1] ?? "";
for (const mode of ["text_only", "uploaded_background", "uploaded_insert", "generated_background"]) assert.match(visualOptions, new RegExp(`\\["${mode}"`), `missing Visual Direction option ${mode}`);
assert.equal((visualOptions.match(/^\s*\["/gm) ?? []).length, 4);
assert.doesNotMatch(all, /VITE_OPENAI|sk-[A-Za-z0-9_-]{8,}/);

const compiled = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpers = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const config = helpers.resolveImageConfiguration({ model: "gpt-image-2", defaultSize: "1024x1024", defaultQuality: "high" });
assert.deepEqual(config, { model: "gpt-image-2", size: "1024x1024", quality: "high" });

let jsonl = "";
let batchBody;
const submitted = await helpers.submitAiBackgroundBatch({
  apiKey: "mock-key",
  generationId: "generation-1",
  prompt: "approved prompt",
  config,
  fetchImpl: async (url, init) => {
    if (url.endsWith("/files")) {
      jsonl = await init.body.get("file").text();
      return new Response(JSON.stringify({ id: "file-1" }), { status: 200 });
    }
    batchBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "batch-1", status: "validating", expires_at: 2_000_000_000 }), { status: 200 });
  },
});
assert.equal(submitted.batchId, "batch-1");
assert.equal(jsonl.trim().split("\n").length, 1, "batch must contain exactly one provider generation");
const request = JSON.parse(jsonl);
assert.deepEqual({ model: request.body.model, quality: request.body.quality, size: request.body.size }, config);
assert.equal(request.url, "/v1/images/generations");
assert.deepEqual(batchBody, { input_file_id: "file-1", endpoint: "/v1/images/generations", completion_window: "24h", metadata: { generation_id: "generation-1" } });

const running = await helpers.checkAiBackgroundBatch({ apiKey: "mock", batchId: "batch-1", generationId: "generation-1", fetchImpl: async () => new Response(JSON.stringify({ status: "in_progress" }), { status: 200 }) });
assert.deepEqual(running, { status: "in_progress" });
let checkCalls = 0;
const completed = await helpers.checkAiBackgroundBatch({
  apiKey: "mock",
  batchId: "batch-1",
  generationId: "generation-1",
  fetchImpl: async () => {
    checkCalls += 1;
    if (checkCalls === 1) return new Response(JSON.stringify({ status: "completed", output_file_id: "output-1" }), { status: 200 });
    return new Response(`${JSON.stringify({ custom_id: "generation-1", response: { status_code: 200, body: { data: [{ b64_json: "aW1hZ2U=", revised_prompt: "safe" }] } } })}\n`, { status: 200 });
  },
});
assert.equal(completed.status, "completed");
assert.equal(completed.base64, "aW1hZ2U=");
for (const status of ["failed", "expired", "cancelled"]) {
  const result = await helpers.checkAiBackgroundBatch({ apiKey: "mock", batchId: "batch-1", generationId: "generation-1", fetchImpl: async () => new Response(JSON.stringify({ status }), { status: 200 }) });
  assert.equal(result.status, status);
  assert.match(result.error, new RegExp(status));
}
assert.equal(helpers.buildAiBackgroundStoragePath("client-1", "JUL20-FP-010", "generation-1"), "client-1/ai-backgrounds/JUL20-FP-010/generation-1.png");
assert.equal(helpers.safeGenerationError(new Error("provider sk-secret-value\nfailed")), "provider [redacted] failed");

console.log("AI background async provider checks passed.");
