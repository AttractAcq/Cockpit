import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/lib/distribution-operator.ts", import.meta.url), "utf8");
const panel = fs.readFileSync(new URL("../src/components/client/DistributionPanel.tsx", import.meta.url), "utf8");
const settings = fs.readFileSync(new URL("../src/components/client/ClientSettingsPanel.tsx", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../src/pages/ClientDetailPage.tsx", import.meta.url), "utf8");
const migration = fs.readFileSync(new URL("../supabase/migrations/20260721000031_client_distribution_accounts.sql", import.meta.url), "utf8");
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

assert.match(page, /label: "Client Settings"/);
assert.match(settings, /Distribution Accounts/);
assert.match(settings, /Credentials and API tokens are not stored here yet/);
assert.match(settings, /replace\(\/\^@\+\//);
assert.doesNotMatch(settings, /access[_ ]?token|password|credential[^s]/i);
assert.match(panel, /Distribution account/);
assert.match(panel, /selectedAccount\?\.external_account_id/);
assert.match(panel, /distribution_account_id: selectedAccount\?\.id/);
assert.match(panel, /No saved distribution account exists for this client/);
assert.match(panel, /This record has an unsaved destination/);
assert.match(panel, /zonedWallClockToUtcIso/);
assert.match(panel, /Stories must be published one frame per record/);
assert.doesNotMatch(panel, /placeholder="@client_handle"|placeholder="numeric ig_user_id"/);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all on public\.client_distribution_accounts from anon/i);
assert.match(migration, /auth_role\(\) in \('admin','account_manager','editor'\)/i);
assert.match(migration, /publish_settings #>> '\{meta,ig_user_id\}'/);
assert.match(migration, /not exists/i);
assert.doesNotMatch(migration, /update public\.client_distribution_records|delete from public\.client_distribution_records/i);

console.log("distribution-operator tests passed");
