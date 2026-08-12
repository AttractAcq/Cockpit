import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260812180000_phase_4a_campaign_intelligence.sql", import.meta.url);
const edgePath = new URL("../supabase/functions/run-campaign-intelligence/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/CampaignIntelligencePanel.tsx", import.meta.url);
const libPath = new URL("../src/lib/campaign-intelligence.ts", import.meta.url);

test("Phase 4A migration creates separate Campaign Intelligence authority tables", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /'campaign_intelligence'/);
  for (const table of [
    "client_campaign_intelligence_releases",
    "client_campaign_periods",
    "client_campaign_period_source_links",
    "client_campaign_intelligence_approval_decisions",
    "client_campaign_intelligence_active_releases",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
  }
  assert.match(sql, /review_campaign_intelligence_release/);
  assert.match(sql, /Downstream Seasonal Offers and Ideation consume approved rows by id/i);
  assert.match(sql, /does not generate offers or content ideas/i);
  assert.match(sql, /client_campaign_active_release_fk/);
  assert.match(sql, /references public\.client_campaign_intelligence_releases\(id, client_id\) on delete restrict/);
  assert.doesNotMatch(sql, /client_intelligence_releases.*campaign_intelligence/s);
});

test("Campaign Intelligence schema captures strategic periods, not offers or content ideas", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const column of [
    "strategic_theme",
    "timing_label",
    "icp_context",
    "emotional_states",
    "pain_point_salience",
    "desired_outcome",
    "awareness_shift",
    "strategic_messaging_direction",
    "positioning_direction",
    "campaign_objective",
    "customer_journey_stage",
    "previous_period_relationship",
  ]) {
    assert.match(sql, new RegExp(column));
  }
  assert.doesNotMatch(sql, /upsell|downsell|continuity_offer|money_model|content_idea|asset_type/i);
});

test("Campaign Intelligence edge requires approved upstream authority and avoids provider calls", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /REQUIRED_DOMAINS = \["market_os", "avatar_os", "competitor_os", "association_os", "brand_strategist"\]/);
  assert.match(edge, /APPROVED_UPSTREAM_INTELLIGENCE_REQUIRED/);
  assert.match(edge, /research_domain: "campaign_intelligence"/);
  assert.match(edge, /model: "stage_4a_campaign_intelligence_scaffold"/);
  assert.match(edge, /stage_4a_scaffold: true/);
  assert.match(edge, /human_review_required: true/);
  assert.match(edge, /status: "needs_review"/);
  assert.match(edge, /Approved upstream Intelligence changed after this Campaign Intelligence run began/);
  assert.doesNotMatch(edge, /status: "approved"/);
  assert.doesNotMatch(edge, /openai|responses\.create|web_search_preview|tools:\s*\[/i);
});

test("Campaign Intelligence frontend is a standalone Intelligence tab", async () => {
  const [page, panel, lib] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(panelPath, "utf8"),
    readFile(libPath, "utf8"),
  ]);
  assert.match(page, /label: "Campaign Intelligence"/);
  assert.match(page, /<CampaignIntelligencePanel clientId=\{id\}/);
  assert.match(panel, /what matters when, and why/i);
  assert.match(panel, /offers and content ideas remain downstream modules/i);
  assert.match(panel, /Generate campaign calendar/);
  assert.match(panel, /Approve &amp; activate/);
  assert.match(panel, /Timeline/);
  assert.match(panel, /Period detail/);
  assert.match(panel, /Evidence drawer/);
  assert.match(panel, /Review history/);
  assert.match(panel, /Only approved Campaign Intelligence becomes downstream authority/);
  assert.match(panel, /Archive/);
  assert.match(lib, /run-campaign-intelligence/);
  assert.match(lib, /review_campaign_intelligence_release/);
  assert.match(lib, /client_campaign_intelligence_approval_decisions/);
});
