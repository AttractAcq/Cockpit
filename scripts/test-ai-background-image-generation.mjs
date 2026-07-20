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
assert.match(edge, /resolveImageConfiguration/);
assert.doesNotMatch(edge, /OPENAI_IMAGE_MODEL"\) \?\?/);
assert.ok(edge.indexOf("resolveImageConfiguration") < edge.indexOf('rpc("generate_ai_background_image"'), "configuration validation must precede claim");
assert.ok(edge.indexOf('rpc("generate_ai_background_image"') < edge.indexOf("const provider = await requestAiBackgroundImage"), "atomic claim must precede provider call");
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
const defaults = helpers.resolveImageConfiguration({ model: "gpt-image-2" });
assert.deepEqual(defaults, { model: "gpt-image-2", size: "1024x1024", quality: "high" });
for (const quality of ["low", "medium", "high"]) assert.equal(helpers.resolveImageConfiguration({ model: "gpt-image-2", requestedQuality: quality }).quality, quality);
for (const size of ["1024x1024", "1024x1536", "1536x1024"]) assert.equal(helpers.resolveImageConfiguration({ model: "gpt-image-2", requestedSize: size }).size, size);
for (const input of [
  { model: "gpt-image-2", requestedQuality: "ultra" },
  { model: "gpt-image-2", requestedSize: "2048x2048" },
  { model: "unknown-model" },
  { model: "" },
  { model: "gpt-image-2", defaultQuality: "ultra" },
  { model: "gpt-image-2", defaultSize: "2048x2048" },
]) assert.throws(() => helpers.resolveImageConfiguration(input));
assert.equal(helpers.resolveImageConfiguration({ model: "gpt-image-1" }).model, "gpt-image-1", "fallback profile is explicit only");

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
console.log("AI background image generation foundation checks passed.");
