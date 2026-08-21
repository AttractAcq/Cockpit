// Cockpit v3 Step 3, first slice — Conversations. Phase 10's real Comms Hub
// (comms_identities/comms_messages, meta-instagram-webhook,
// send-instagram-message) already covered most of the target "unified inbox
// + conversation view" deliverable; what was genuinely missing was the CRM
// context (Sales stage/source/value/assignee, previous Sales interactions,
// or the linked Delivery client's status/package) so staff see the full
// picture without leaving the conversation. This slice adds exactly that,
// plus the nav label rename to "Conversations" (route unchanged -- see
// tests/stage2-phase10-comms-hub.test.ts, updated in the same commit).
//
// Source-text assertions, matching this repo's established convention for
// UI wiring -- no new schema, no new RPC, nothing to live-test against
// xivewedajschthjlblfb beyond what Phase 10 already verified.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const detailPagePath = new URL("../src/pages/CommsConversationPage.tsx", import.meta.url);
const salesLeadDetailPath = new URL("../src/pages/SalesLeadDetailPage.tsx", import.meta.url);
const salesTypesPath = new URL("../src/types/sales.ts", import.meta.url);

test("SALES_STAGE_LABEL is a single shared export, not duplicated between SalesLeadDetailPage and CommsConversationPage", async () => {
  const types = await readFile(salesTypesPath, "utf8");
  assert.match(types, /export const SALES_STAGE_LABEL: Record<SalesLeadStage, string> = \{/);

  const leadDetail = await readFile(salesLeadDetailPath, "utf8");
  assert.match(leadDetail, /import \{ SALES_STAGE_LABEL(, SALES_PROPOSAL_STATUS_LABEL)? \} from "@\/types\/sales"/);
  assert.doesNotMatch(leadDetail, /const STAGE_LABEL: Record<SalesLeadStage, string>/, "the local duplicate must be removed, not left alongside the shared export");

  const conversation = await readFile(detailPagePath, "utf8");
  assert.match(conversation, /import \{ SALES_STAGE_LABEL \} from "@\/types\/sales"/);
});

test("a conversation linked to a Sales lead shows stage/source/value/assignee and links to the full lead", async () => {
  const src = await readFile(detailPagePath, "utf8");
  assert.match(src, /const linkedLead = identity\.matched_lead_id/);
  assert.match(src, /SALES_STAGE_LABEL\[linkedLead\.stage\]/);
  assert.match(src, /linkedLead\.source/);
  assert.match(src, /fmtCents\(linkedLead\.estimated_value_cents\)/);
  assert.match(src, /staffLabel\(linkedLead\.assignee_id\)/);
  assert.match(src, /navigate\(ROUTES\.salesLead\(linkedLead\.id\)\)/);
});

test("a conversation linked to a Sales lead also shows that lead's own conversation log, fetched by lead id", async () => {
  const src = await readFile(detailPagePath, "utf8");
  assert.match(src, /import \{ fetchSalesLeads, fetchSalesConversations \} from "@\/lib\/sales"/);
  assert.match(src, /setLeadConversations\(current\.matched_lead_id \? await fetchSalesConversations\(current\.matched_lead_id\) : \[\]\)/);
  assert.match(src, /leadConversations\.map/);
});

test("a conversation linked to a Delivery client shows status/package and links to the client", async () => {
  const src = await readFile(detailPagePath, "utf8");
  assert.match(src, /const linkedClient = identity\.matched_client_id/);
  assert.match(src, /import \{ TIER_LABELS \} from "@\/types\/client"/);
  assert.match(src, /TIER_LABELS\[linkedClient\.package_tier\]/);
  assert.match(src, /navigate\(ROUTES\.clientSection\(linkedClient\.id, "overview"\)\)/);
});

test("the CRM panel never fabricates a source campaign field -- only real columns (stage/source/value/assignee) are shown", async () => {
  const src = await readFile(detailPagePath, "utf8");
  assert.doesNotMatch(src, /campaign/i, "sales_leads has no campaign column; the target IA's 'Source Campaign' field is honestly not shown rather than invented");
});
