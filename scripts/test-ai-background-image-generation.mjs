import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const migration = readFileSync("supabase/migrations/20260720000027_ai_background_image_generation.sql", "utf8");
const edge = readFileSync("supabase/functions/generate-ai-background-image/index.ts", "utf8");
const helperSource = readFileSync("supabase/functions/_shared/ai-background-image.ts", "utf8");
const api = readFileSync("src/lib/api.ts", "utf8");
const ui = readFileSync("src/components/client/ContentCreationPanel.tsx", "utf8");
const all = `${migration}\n${edge}\n${api}\n${ui}`;

for (const name of ["client_ai_background_image_generations", "client_ai_background_image_reviews", "create_ai_background_prompt", "update_ai_background_prompt", "generate_ai_background_image"]) assert.ok(migration.includes(name), `missing ${name}`);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all[\s\S]*from public,anon,authenticated/i);
assert.match(migration, /grant select[\s\S]*to authenticated/i);
assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*to authenticated/i);
assert.equal((migration.match(/security definer set search_path = ''/gi) ?? []).length, 3);
assert.match(migration, /admin','account_manager','editor/);
assert.match(migration, /prompt_status='approved'/);
for (const predicate of ["production_brief_id is not null", "b.client_id=client_ai_background_image_generations.client_id", "b.source_ref=client_ai_background_image_generations.source_ref", "b.asset_format=client_ai_background_image_generations.format", "b.status='approved'", "brief_fingerprint_at_approval"]) assert.ok(migration.includes(predicate), `missing claim-time validation: ${predicate}`);
assert.match(migration, /brief_fingerprint_at_prompt text not null/);
assert.match(migration, /md5\(concat_ws\(E'\\n',v_brief\.title,v_brief\.source_ref,v_brief\.asset_format,v_brief\.content_md,v_brief\.version::text\)\)/);
assert.match(migration, /STALE_BRIEF: production brief changed after prompt creation/);
assert.match(migration, /length\(trim\(v_prompt\)\)=0/);
assert.match(migration, /prompt_status in \('generating'\)/);
assert.match(migration, /production brief does not belong to client/);
assert.match(migration, /source ref/);
assert.match(migration, /AI background prompt draft created/);

assert.match(edge, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
assert.match(edge, /runAiBackgroundGeneration/);
assert.doesNotMatch(edge, /OPENAI_IMAGE_MODEL"\) \?\?/);
assert.ok(helperSource.indexOf("resolveImageConfiguration(input.configuration)") < helperSource.indexOf("input.claimGeneration(config)"), "configuration validation must precede claim");
assert.ok(helperSource.indexOf("input.claimGeneration(config)") < helperSource.indexOf("input.callProvider(claim, config)"), "atomic claim must precede provider call");
assert.match(edge, /p_client_id: clientId/);
assert.match(edge, /\/v1\/images\/generations/);
assert.match(edge, /client-assets/);
assert.match(helperSource, /ai-backgrounds/);
assert.match(helperSource, /upsert: false/);
assert.match(edge, /prompt_status: "generated"/);
assert.doesNotMatch(edge, /generate-phase-3|publish|client_distribution_records|client_metric_snapshots|client_business_signal_snapshots|client_performance_scores/);

assert.match(api, /generate-ai-background-image/);
assert.match(ui, /Prompt must be human-approved before image generation/);
assert.match(ui, /Final assets still require the normal Produce Asset flow/);
assert.match(ui, /Publishing is not triggered/);
assert.match(ui, /Use as background for this asset/);
const visualOptions = ui.match(/\(\[([\s\S]*?)\] as \[AiVisualMode, string, string\]\[\]\)\.map/)?.[1] ?? "";
for (const mode of ["text_only", "uploaded_background", "uploaded_insert", "generated_background"]) assert.match(visualOptions, new RegExp(`\\["${mode}"`), `missing Visual Direction option ${mode}`);
assert.equal((visualOptions.match(/^\s*\["/gm) ?? []).length, 4, "Visual Direction must have exactly four options");
assert.equal((visualOptions.match(/\["generated_background", "Generate AI background image",/g) ?? []).length, 1, "Generate AI background image must be one Visual Direction option");
assert.match(ui, /visualMode === "generated_background" && <div className="mt-4"><AiBackgroundPanel/);
assert.match(ui, /active\.prompt_status === "approved"/);
assert.match(ui, /visualMode === "generated_background" && uploadedImage \? "uploaded_background" : visualMode/);
assert.match(ui, /uploaded_image_path: uploadedImage\?\.path \?\? null/);
assert.match(ui, /visualMode === "generated_background" && !uploadedImage/);
assert.match(ui, /requiresUpload && !uploadedImage/);
assert.match(ui, /\["uploaded_background", "Upload background image"/);
assert.match(ui, /\["uploaded_insert", "Upload image to include"/);
assert.match(ui, /\["text_only", "Text \/ Layout only"/);
assert.doesNotMatch(edge, /start-carousel-generation|generate-feed-post-asset|generate-carousel-slide/);
assert.doesNotMatch(all, /VITE_OPENAI|GPT 2\.0/i);

// Execute the production pure helpers with mocked provider and storage dependencies.
const compiled = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpers = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const productionConfiguration = { model: "gpt-image-2", defaultSize: "1024x1024", defaultQuality: "high" };
const defaults = helpers.resolveImageConfiguration(productionConfiguration);
assert.deepEqual(defaults, { model: "gpt-image-2", size: "1024x1024", quality: "high" });
for (const quality of ["low", "medium", "high"]) assert.equal(helpers.resolveImageConfiguration({ ...productionConfiguration, requestedQuality: quality }).quality, quality);
for (const size of ["1024x1024", "1024x1536", "1536x1024"]) assert.equal(helpers.resolveImageConfiguration({ ...productionConfiguration, requestedSize: size }).size, size);
for (const input of [
  { model: "gpt-image-2", requestedQuality: "ultra" },
  { model: "gpt-image-2", requestedSize: "2048x2048" },
  { model: "unknown-model" },
  { model: "" },
  { model: "gpt-image-2", defaultQuality: "ultra" },
  { model: "gpt-image-2", defaultSize: "2048x2048" },
  { model: "gpt-image-2", defaultQuality: "high" },
  { model: "gpt-image-2", defaultSize: "1024x1024" },
]) assert.throws(() => helpers.resolveImageConfiguration(input));
assert.equal(helpers.resolveImageConfiguration({ model: "gpt-image-1", defaultSize: "1024x1024", defaultQuality: "high" }).model, "gpt-image-1", "fallback profile is explicit only");

let providerBody;
const providerResult = await helpers.requestAiBackgroundImage({
  fetchImpl: async (_url, init) => { providerBody = JSON.parse(init.body); return new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=", revised_prompt: "safe" }] }), { status: 200 }); },
  url: "https://example.invalid/images", apiKey: "mock-key", prompt: "approved prompt", config: defaults,
});
assert.deepEqual({ model: providerBody.model, quality: providerBody.quality, size: providerBody.size }, defaults);
assert.equal(providerResult.base64, "aW1hZ2U=");
await assert.rejects(() => helpers.requestAiBackgroundImage({ fetchImpl: async () => new Response(JSON.stringify({ error: { message: "mock provider failure" } }), { status: 500 }), url: "https://example.invalid", apiKey: "mock", prompt: "p", config: defaults }), /mock provider failure/);

const expectedPath = "client-1/ai-backgrounds/JUL28-FP-009/generation-1.png";
assert.equal(helpers.buildAiBackgroundStoragePath("client-1", "JUL28-FP-009", "generation-1"), expectedPath);
let uploaded = false; let saved = false; let removed = false;
await helpers.persistAiBackgroundImage({ path: expectedPath, bytes: new Uint8Array([1]), upload: async (path, _bytes, options) => { assert.equal(path, expectedPath); assert.equal(options.upsert, false); uploaded = true; }, save: async () => { saved = true; }, remove: async () => { removed = true; } });
assert.ok(uploaded && saved && !removed);
await assert.rejects(() => helpers.persistAiBackgroundImage({ path: expectedPath, bytes: new Uint8Array([1]), upload: async () => {}, save: async () => { throw new Error("metadata update failed"); }, remove: async () => { removed = true; } }), /metadata update failed/);
assert.ok(removed, "metadata failure attempts storage cleanup");
await assert.rejects(() => helpers.persistAiBackgroundImage({ path: expectedPath, bytes: new Uint8Array([1]), upload: async () => {}, save: async () => { throw new Error("metadata update failed"); }, remove: async () => { throw new Error("cleanup failed"); } }), /cleanup also failed/);
await assert.rejects(() => helpers.persistAiBackgroundImage({ path: expectedPath, bytes: new Uint8Array([1]), upload: async () => { throw new Error("upload failed"); }, save: async () => { throw new Error("must not save"); }, remove: async () => { throw new Error("must not clean"); } }), /upload failed/);
assert.equal(helpers.safeGenerationError(new Error("provider sk-secret-value\nfailed")), "provider [redacted] failed");

const validClaim = { id: "generation-1", client_id: "client-1", source_ref: "JUL28-FP-009", prompt_text: "approved prompt" };
function runtimeHarness(overrides = {}) {
  const calls = { auth: 0, claim: 0, provider: 0, upload: 0, generated: 0, failed: 0, cleanup: 0, finalAsset: 0, publish: 0, phase3: 0 };
  const state = { failedMessage: null, providerConfig: null, uploadPath: null, uploadOptions: null };
  const input = {
    configuration: { model: "gpt-image-2", defaultSize: "1024x1024", defaultQuality: "high" },
    authorize: async () => { calls.auth += 1; },
    claimGeneration: async () => { calls.claim += 1; return validClaim; },
    callProvider: async (_claim, config) => { calls.provider += 1; state.providerConfig = config; return { bytes: new Uint8Array([1, 2]), metadata: { revised_prompt: "safe" } }; },
    uploadImage: async (path, _bytes, options) => { calls.upload += 1; state.uploadPath = path; state.uploadOptions = options; },
    markGenerated: async () => { calls.generated += 1; return { prompt_status: "generated" }; },
    markFailed: async (_claim, message) => { calls.failed += 1; state.failedMessage = message; },
    cleanupStorage: async () => { calls.cleanup += 1; },
    ...overrides,
  };
  return { input, calls, state };
}

// claim_failure_blocks_provider: no-row, rejected, and stale-fingerprint claims cannot reach downstream effects.
for (const claimFailure of [
  async () => null,
  async () => { throw new Error("VALIDATION: linked brief is rejected"); },
  async () => { throw new Error("STALE_BRIEF: fingerprint mismatch sk-test-secret"); },
]) {
  const harness = runtimeHarness();
  harness.input.claimGeneration = async () => { harness.calls.claim += 1; return claimFailure(); };
  await assert.rejects(() => helpers.runAiBackgroundGeneration(harness.input), (error) => error.stage === "claim" && !error.message.includes("sk-test-secret"));
  assert.equal(harness.calls.auth, 1);
  assert.equal(harness.calls.claim, 1);
  assert.deepEqual({ provider: harness.calls.provider, upload: harness.calls.upload, generated: harness.calls.generated, failed: harness.calls.failed }, { provider: 0, upload: 0, generated: 0, failed: 0 });
  assert.deepEqual({ finalAsset: harness.calls.finalAsset, publish: harness.calls.publish, phase3: harness.calls.phase3 }, { finalAsset: 0, publish: 0, phase3: 0 });
}

// claim_success_allows_provider.
{
  const harness = runtimeHarness();
  const result = await helpers.runAiBackgroundGeneration(harness.input);
  assert.deepEqual(harness.state.providerConfig, defaults);
  assert.equal(harness.state.uploadPath, expectedPath);
  assert.equal(harness.state.uploadOptions.upsert, false);
  assert.deepEqual({ auth: harness.calls.auth, claim: harness.calls.claim, provider: harness.calls.provider, upload: harness.calls.upload, generated: harness.calls.generated, failed: harness.calls.failed }, { auth: 1, claim: 1, provider: 1, upload: 1, generated: 1, failed: 0 });
  assert.equal(result.generated.prompt_status, "generated");
  assert.deepEqual({ finalAsset: harness.calls.finalAsset, publish: harness.calls.publish, phase3: harness.calls.phase3 }, { finalAsset: 0, publish: 0, phase3: 0 });
}

for (const scenario of [
  { name: "provider_failure_marks_failed", message: "provider sk-provider-secret failed" },
  { name: "provider_invalid_response_marks_failed", message: "Provider response did not contain image data." },
]) {
  const harness = runtimeHarness();
  harness.input.callProvider = async () => { harness.calls.provider += 1; throw new Error(scenario.message); };
  await assert.rejects(() => helpers.runAiBackgroundGeneration(harness.input), (error) => error.stage === "generate" && !error.message.includes("sk-provider-secret"), scenario.name);
  assert.deepEqual({ provider: harness.calls.provider, upload: harness.calls.upload, generated: harness.calls.generated, failed: harness.calls.failed, cleanup: harness.calls.cleanup }, { provider: 1, upload: 0, generated: 0, failed: 1, cleanup: 0 }, scenario.name);
  assert.deepEqual({ finalAsset: harness.calls.finalAsset, publish: harness.calls.publish, phase3: harness.calls.phase3 }, { finalAsset: 0, publish: 0, phase3: 0 }, scenario.name);
}
{
  const harness = runtimeHarness();
  harness.input.uploadImage = async () => { harness.calls.upload += 1; throw new Error("Storage upload failed: private detail"); };
  await assert.rejects(() => helpers.runAiBackgroundGeneration(harness.input), (error) => error.stage === "generate");
  assert.deepEqual({ provider: harness.calls.provider, upload: harness.calls.upload, generated: harness.calls.generated, failed: harness.calls.failed, cleanup: harness.calls.cleanup }, { provider: 1, upload: 1, generated: 0, failed: 1, cleanup: 0 }, "upload_failure_marks_failed");
}

// metadata_update_failure_attempts_cleanup.
{
  const harness = runtimeHarness({ markGenerated: async () => { harness.calls.generated += 1; throw new Error("metadata update failed"); } });
  await assert.rejects(() => helpers.runAiBackgroundGeneration(harness.input), /metadata update failed/);
  assert.deepEqual({ generated: harness.calls.generated, cleanup: harness.calls.cleanup, failed: harness.calls.failed }, { generated: 1, cleanup: 1, failed: 1 });
}

// cleanup_failure_is_reported_safely.
{
  const harness = runtimeHarness({ markGenerated: async () => { throw new Error("metadata sk-hidden failed"); }, cleanupStorage: async () => { harness.calls.cleanup += 1; throw new Error("cleanup sk-other failed"); } });
  await assert.rejects(() => helpers.runAiBackgroundGeneration(harness.input), (error) => error.stage === "generate" && /cleanup also failed/.test(error.message) && !error.message.includes("sk-hidden") && !error.message.includes("sk-other"));
  assert.equal(harness.calls.cleanup, 1);
  assert.equal(harness.calls.failed, 1);
}
console.log("AI background image generation foundation checks passed.");
