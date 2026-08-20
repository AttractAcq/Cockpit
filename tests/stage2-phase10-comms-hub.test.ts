// Stage 2 Phase 10 — Communications Hub.
//
// Source-text/migration assertions, matching this repo's established
// convention. Live behaviour (RLS, service-role-only ingestion,
// staff-only linking, webhook idempotency on a replayed external_message_id,
// dual-link rejection, unsupported-platform rejection, and the standard
// auth-rejection pass) was verified directly against xivewedajschthjlblfb
// with disposable ZZ-TEST fixtures inside rolled-back transactions before
// this file was written — see the Phase 10 PR description for the
// transcript. The real Meta webhook/send calls themselves are NOT
// live-tested this phase — real credentials were deliberately not
// exercised yet (see the migration/PR's own honesty note).

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/20260820270000_stage2_phase10_comms_hub.sql", import.meta.url);
const commsMetaPath = new URL("../supabase/functions/_shared/comms-meta.ts", import.meta.url);
const webhookPath = new URL("../supabase/functions/meta-instagram-webhook/index.ts", import.meta.url);
const sendPath = new URL("../supabase/functions/send-instagram-message/index.ts", import.meta.url);
const registryPath = new URL("../supabase/functions/registry.json", import.meta.url);
const configPath = new URL("../supabase/config.toml", import.meta.url);
const typesPath = new URL("../src/types/comms.ts", import.meta.url);
const libPath = new URL("../src/lib/comms.ts", import.meta.url);
const listPagePath = new URL("../src/pages/CommsPage.tsx", import.meta.url);
const detailPagePath = new URL("../src/pages/CommsConversationPage.tsx", import.meta.url);
const appPath = new URL("../src/App.tsx", import.meta.url);
const constantsPath = new URL("../src/lib/constants.ts", import.meta.url);
const instagramPublishPath = new URL("../supabase/functions/_shared/instagram-publish.ts", import.meta.url);

test("comms_identities/comms_messages are additive, cross-business, v1 is Instagram-only", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create table public\.comms_identities/);
  assert.match(migration, /create table public\.comms_messages/);
  assert.match(migration, /constraint comms_identities_platform_check check \(platform in \('instagram'\)\)/);
  assert.doesNotMatch(migration, /alter table public\.(sales_leads|clients)/, "Phase 10 must not modify any existing table");
});

test("an identity may link to a lead or a client, never both -- enforced by a table CHECK", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /constraint comms_identities_single_match_check check \(not \(matched_lead_id is not null and matched_client_id is not null\)\)/);
});

test("record_comms_message is service-role-only -- never grantable to authenticated", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /revoke all on function public\.record_comms_message\([^)]*\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.record_comms_message\([^)]*\) to service_role;/);
  assert.doesNotMatch(migration, /grant execute on function public\.record_comms_message\([^)]*\) to authenticated/);
  const body = migration.split("create or replace function public.record_comms_message")[1].split("create or replace function public.link_comms_identity")[0];
  assert.match(body, /if auth\.role\(\) <> 'service_role' then raise exception 'AUTH: service role required';/);
});

test("record_comms_message is idempotent on external_message_id -- a webhook retry cannot duplicate a message", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create unique index comms_messages_external_id_idx on public\.comms_messages \(identity_id, external_message_id\) where external_message_id is not null/);
  const body = migration.split("create or replace function public.record_comms_message")[1].split("create or replace function public.link_comms_identity")[0];
  assert.match(body, /on conflict \(identity_id, external_message_id\) where external_message_id is not null do nothing/);
});

test("link_comms_identity is staff-gated (the 7-role list) and rejects linking to both a lead and a client", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const body = migration.split("create or replace function public.link_comms_identity")[1];
  assert.match(body, /not in \('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst'\) then\s*\n\s*raise exception 'AUTH: staff role required'/);
  assert.match(body, /if p_lead_id is not null and p_client_id is not null then raise exception 'VALIDATION: link to a lead or a client, not both'/);
});

test("identity resolution is deliberately manual, not automatic -- stated honestly in the migration header", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /Identity resolution is deliberately manual in v1, not automatic fuzzy\s*\n-- matching/);
});

test("comms-meta.ts reuses instagram-publish.ts's exact credential-resolution priority order, not a new scheme", async () => {
  const commsMeta = await readFile(commsMetaPath, "utf8");
  const publish = await readFile(instagramPublishPath, "utf8");
  assert.match(commsMeta, /_GLOBAL_META_SYSTEM_USER_TOKEN/);
  assert.match(commsMeta, /META_SYSTEM_USER_TOKEN/);
  assert.match(commsMeta, /readCredential/);
  assert.match(publish, /_GLOBAL_META_SYSTEM_USER_TOKEN/, "instagram-publish.ts must still be the source of this credential convention");
  assert.match(commsMeta, /graph\.facebook\.com\/\$\{GRAPH_VERSION\}/);
});

test("the webhook verifies X-Hub-Signature-256 with a constant-time-ish compare before processing any POST body", async () => {
  const commsMeta = await readFile(commsMetaPath, "utf8");
  assert.match(commsMeta, /export async function verifyMetaSignature/);
  assert.match(commsMeta, /crypto\.subtle\.(sign|importKey)/);
  const webhook = await readFile(webhookPath, "utf8");
  assert.match(webhook, /verifyMetaSignature\(rawBody, req\.headers\.get\("X-Hub-Signature-256"\), appSecret\)/);
  assert.match(webhook, /return new Response\("Invalid signature", \{ status: 401 \}\)/);
});

test("the webhook always answers Meta with HTTP 200 once the signature is valid, even on a parse or processing error", async () => {
  const webhook = await readFile(webhookPath, "utf8");
  assert.match(webhook, /catch \{ \/\* fall through to plain200 below \*\/ \}/);
  assert.match(webhook, /if \(!payload \|\| payload\.object !== "instagram"\) return plain200\(\);/);
  assert.match(webhook, /return plain200\(\);\s*\n\}\);/);
});

test("the webhook skips echoes of our own sends and attachment-only messages -- v1 is text-only, inbound-original-only", async () => {
  const webhook = await readFile(webhookPath, "utf8");
  assert.match(webhook, /if \(!msg\.message \|\| msg\.message\.is_echo\) continue;/);
  assert.match(webhook, /if \(!text\) continue;/);
});

test("send-instagram-message never records a message before Meta confirms success", async () => {
  const send = await readFile(sendPath, "utf8");
  const sendCallIdx = send.indexOf("sendInstagramMessage(");
  const recordCallIdx = send.indexOf("record_comms_message");
  assert.ok(sendCallIdx > -1 && recordCallIdx > sendCallIdx, "the Meta send call must happen before record_comms_message");
  assert.match(send, /if \(!result\.ok\) return fail\(502, "send", result\.error\);/);
});

test("send-instagram-message is staff-gated the same way create-video-project is (JWT lookup + role check)", async () => {
  const send = await readFile(sendPath, "utf8");
  assert.match(send, /sb\.auth\.getUser\(jwt\)/);
  assert.match(send, /STAFF_ROLES\.has\(operator\.role\)/);
});

test("registry.json declares both new functions with correct, distinct profiles and updated expectedCounts", async () => {
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  const webhookFn = registry.functions.find((f: { name: string }) => f.name === "meta-instagram-webhook");
  const sendFn = registry.functions.find((f: { name: string }) => f.name === "send-instagram-message");
  assert.ok(webhookFn, "meta-instagram-webhook must be registered");
  assert.ok(sendFn, "send-instagram-message must be registered");
  assert.equal(registry.profiles[webhookFn.profile].caller, "webhook");
  assert.equal(registry.profiles[webhookFn.profile].jwtVerification, "disabled_with_alternate_auth");
  assert.equal(registry.profiles[webhookFn.profile].alternateSecret, "META_APP_SECRET");
  assert.equal(registry.profiles[sendFn.profile].caller, "ui");
  assert.equal(registry.profiles[sendFn.profile].jwtVerification, "verified");
  assert.deepEqual(registry.profiles[sendFn.profile].allowedStaffRoles.sort(), ["admin","account_manager","strategist","content_operator","editor","media_buyer","analyst"].sort());
});

test("config.toml declares verify_jwt=false for the webhook, matching its registered JWT-disabled profile", async () => {
  const config = await readFile(configPath, "utf8");
  assert.match(config, /\[functions\.meta-instagram-webhook\]\s*\nverify_jwt = false/);
});

test("CommsIdentityRow/CommsMessageRow types match the migration's columns", async () => {
  const types = await readFile(typesPath, "utf8");
  assert.match(types, /export type CommsPlatform = "instagram"/);
  assert.match(types, /export interface CommsIdentityRow \{[\s\S]*?matched_lead_id: string \| null;[\s\S]*?matched_client_id: string \| null;[\s\S]*?\}/);
  assert.match(types, /export interface CommsMessageRow \{[\s\S]*?direction: CommsMessageDirection;[\s\S]*?\}/);
});

test("comms.ts reads both tables directly, calls link_comms_identity by name, and sends via the edge function (not a direct table write)", async () => {
  const lib = await readFile(libPath, "utf8");
  assert.match(lib, /from\("comms_identities"\)/);
  assert.match(lib, /from\("comms_messages"\)/);
  assert.match(lib, /supabase\.rpc\("link_comms_identity"/);
  assert.match(lib, /invokeFn\("send-instagram-message"/);
  assert.doesNotMatch(lib, /from\("comms_messages"\)\.insert/, "the frontend must never insert a message row directly -- only record_comms_message may");
});

test("routes and nav wiring mirror the existing Sales pattern; Comms is a new top-level page", async () => {
  const constants = await readFile(constantsPath, "utf8");
  assert.match(constants, /comms: "\/comms"/);
  assert.match(constants, /commsIdentity: \(id: string\) => `\/comms\/\$\{id\}`/);
  assert.match(constants, /label: "Comms",\s*path: ROUTES\.comms/);
  const app = await readFile(appPath, "utf8");
  assert.match(app, /path=\{ROUTES\.comms\} element=\{<CommsPage \/>\}/);
  assert.match(app, /path="\/comms\/:id" element=\{<CommsConversationPage \/>\}/);
});

test("the list page filters by linked/unlinked and the detail page offers linking to both a lead and a client", async () => {
  const list = await readFile(listPagePath, "utf8");
  assert.match(list, /"all", "unlinked", "linked"/);
  const detail = await readFile(detailPagePath, "utf8");
  assert.match(detail, /Sales leads/);
  assert.match(detail, /Delivery clients/);
  assert.match(detail, /sendInstagramMessage/);
});
