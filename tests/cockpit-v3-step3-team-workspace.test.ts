// Cockpit v3 Step 3 — Team workspace (channels + one-level-deep threaded
// messages). The one genuinely greenfield piece of this step; see
// docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 3.
//
// Live behaviour (create_team_channel/post_team_message happy path,
// duplicate-slug rejection, unknown-business rejection, threaded reply,
// nested-reply rejection, cross-channel-parent rejection, empty-body
// rejection, unknown-channel rejection, and the standard unauthenticated-
// caller rejection pass on both RPCs) was verified directly against
// xivewedajschthjlblfb with disposable ZZ-TEST fixtures inside rolled-back
// transactions before this file was written -- see the PR description for
// the transcript. @mention parsing is pure logic, tested directly below.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseMentions, extractMentions, type MentionCandidate } from "../src/lib/team-mentions.ts";

const migrationPath = new URL("../supabase/migrations/20260820310000_cockpit_v3_step3_team_workspace.sql", import.meta.url);
const libPath = new URL("../src/lib/team-workspace.ts", import.meta.url);
const sectionPath = new URL("../src/components/team/TeamWorkspaceSection.tsx", import.meta.url);
const pagePath = new URL("../src/pages/TeamPage.tsx", import.meta.url);

const CANDIDATES: MentionCandidate[] = [
  { type: "human", id: "u1", label: "Alex Thomas" },
  { type: "human", id: "u2", label: "Alex" },
  { type: "agent", id: "run-market-os", label: "run-market-os" },
];

test("parseMentions prefers the longest matching candidate at a given position", () => {
  const segments = parseMentions("hi @Alex Thomas how's it going", CANDIDATES);
  assert.deepEqual(segments.map((s) => s.text), ["hi ", "@Alex Thomas", " how's it going"]);
  assert.equal(segments[1].mention?.id, "u1");
});

test("parseMentions matches an agent by its real registry name", () => {
  const segments = parseMentions("@run-market-os please refresh", CANDIDATES);
  assert.equal(segments[0].text, "@run-market-os");
  assert.equal(segments[0].mention?.type, "agent");
});

test("parseMentions leaves an unmatched @ as plain text", () => {
  const segments = parseMentions("email me @ example.com", CANDIDATES);
  assert.equal(segments.every((s) => s.mention === null), true);
  assert.equal(segments.map((s) => s.text).join(""), "email me @ example.com");
});

test("parseMentions returns the whole body as one plain segment when there are no mentions", () => {
  const segments = parseMentions("no mentions here", []);
  assert.deepEqual(segments, [{ text: "no mentions here", mention: null }]);
});

test("extractMentions returns each mentioned candidate once, in first-mention order", () => {
  const mentioned = extractMentions("@Alex Thomas and later @Alex Thomas again, plus @run-market-os", CANDIDATES);
  assert.deepEqual(mentioned.map((m) => m.id), ["u1", "run-market-os"]);
});

test("migration is business-scoped (not client_id), matching sales_leads' precedent for new cross-department schema", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /create table public\.team_channels \(/);
  assert.match(sql, /business_id uuid not null references public\.businesses\(id\)/);

  const channelsColumns = sql.slice(sql.indexOf("create table public.team_channels ("), sql.indexOf("create index team_channels_business_idx"));
  const messagesColumns = sql.slice(sql.indexOf("create table public.team_messages ("), sql.indexOf("create index team_messages_channel_idx"));
  assert.doesNotMatch(channelsColumns, /\bclient_id\b/, "team_channels must not gain a client_id column -- this is new schema, no legacy constraint forces it");
  assert.doesNotMatch(messagesColumns, /\bclient_id\b/, "team_messages must not gain a client_id column either");
});

test("post_team_message rejects nesting beyond one level of threading", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /if v_parent\.parent_message_id is not null then raise exception 'VALIDATION: threads are one level deep/);
});

test("both RPCs are staff-gated with the standard 7-role list, matching every other Stage 2\\/Cockpit v3 admin RPC", async () => {
  const sql = await readFile(migrationPath, "utf8");
  const staffCheck = /not in \('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst'\)/g;
  assert.equal((sql.match(staffCheck) ?? []).length, 2, "create_team_channel and post_team_message must both carry the staff-role gate");
});

test("team-workspace.ts writes go through the staff-gated RPCs, not a direct table insert", async () => {
  const lib = await readFile(libPath, "utf8");
  assert.match(lib, /supabase\.rpc\("create_team_channel"/);
  assert.match(lib, /supabase\.rpc\("post_team_message"/);
  assert.doesNotMatch(lib, /\.from\("team_channels"\)\.insert/);
  assert.doesNotMatch(lib, /\.from\("team_messages"\)\.insert/);
});

test("TeamWorkspaceSection reads selectedBusinessId directly from BusinessContext -- business-native, matching SalesPage's pattern", async () => {
  const src = await readFile(sectionPath, "utf8");
  assert.match(src, /import \{ useBusinessContext \} from "@\/lib\/business-context"/);
  assert.match(src, /const \{ selectedBusinessId, selectedBusiness \} = useBusinessContext\(\)/);
});

test("agents are mentioned by their real registry name, never an invented display name", async () => {
  const src = await readFile(sectionPath, "utf8");
  assert.match(src, /import \{ fetchWorkflows \} from "@\/lib\/workflows"/);
  assert.match(src, /type: "agent" as const, id: w\.name, label: w\.name/);
});

test("Team page adds Channels alongside the existing Directory, replacing nothing", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /import \{ TeamRolesSection \} from "@\/components\/team\/TeamRolesSection"/);
  assert.match(page, /import \{ TeamWorkspaceSection \} from "@\/components\/team\/TeamWorkspaceSection"/);
  assert.match(page, /"channels" \? <TeamWorkspaceSection \/> : <TeamRolesSection \/>/);
});
