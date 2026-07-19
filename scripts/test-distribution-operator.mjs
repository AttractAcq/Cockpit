import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/distribution-operator.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const record = (asset_format, content_type, mediaCount) => ({
  asset_format,
  publish_settings: { content_type },
  publish_payload: { media: Array.from({ length: mediaCount }, () => ({})) },
});

assert.equal(module.validateStoryRecord(record("story_sequence", "STORIES", 2)).valid, false);
assert.equal(module.validateStoryRecord(record("story_sequence", "STORIES", 1)).valid, true);
assert.equal(module.validateStoryRecord(record("feed_post", "IMAGE", 2)).valid, true);
assert.equal(module.validateStoryRecord(record("carousel", "CAROUSEL", 4)).valid, true);
assert.equal(module.normalizeDestinationDisplay("attract acq"), "@attractacq");
assert.equal(module.normalizeDestinationDisplay("attractacq"), "@attractacq");
assert.equal(module.normalizeDestinationDisplay("@attractacq"), "@attractacq");
assert.equal(module.normalizeDestinationDisplay("@client"), "@client");
assert.equal(module.hasExternalEvidence({ external_post_id: "123", published_at: null, published_url: null }), true);
assert.equal(module.errorCategory("[container_not_ready, retryable] waiting"), "container_not_ready");

console.log("distribution-operator tests passed");
