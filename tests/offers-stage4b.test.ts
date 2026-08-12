import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260812190000_phase_4b_offers_foundation.sql", import.meta.url);
const edgePath = new URL("../supabase/functions/run-offers/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/OffersPanel.tsx", import.meta.url);
const libPath = new URL("../src/lib/offers.ts", import.meta.url);

test("Phase 4B migration creates separate Main Offers and Seasonal Offers authority", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /'offer_system'/);
  for (const table of [
    "client_offer_architecture_releases",
    "client_main_offers",
    "client_money_model_components",
    "client_seasonal_offer_releases",
    "client_seasonal_offers",
    "client_offer_architecture_active_releases",
    "client_seasonal_offer_active_releases",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
  }
  assert.match(sql, /review_offer_architecture_release/);
  assert.match(sql, /review_seasonal_offer_release/);
  assert.match(sql, /Main Offers define the underlying commercial engine/i);
  assert.match(sql, /Seasonal Offers adapt\/package offers around approved Campaign Intelligence periods/i);
});

test("Main Offers schema owns commercial architecture and Money Model mechanics", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const column of [
    "offer_role",
    "offer_stage",
    "customer_segment",
    "problem_addressed",
    "promised_outcome",
    "mechanism",
    "dream_outcome",
    "perceived_likelihood",
    "time_delay",
    "effort_sacrifice",
    "price_risk_friction",
    "value_stack",
    "bonus_stack",
    "risk_reversal",
    "guarantee",
    "pricing_model",
    "delivery_model",
    "proof_requirements",
    "offer_sequence_note",
    "money_model_notes",
    "component_type",
    "commercial_role",
  ]) {
    assert.match(sql, new RegExp(column));
  }
  assert.match(sql, /'upsell'/);
  assert.match(sql, /'downsell'/);
  assert.match(sql, /'continuity'/);
  assert.match(sql, /'recurring_revenue'/);
});

test("Seasonal Offers are informed by Campaign Intelligence without becoming Ideation", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /campaign_intelligence_release_id/);
  assert.match(sql, /campaign_period_id uuid not null/);
  assert.match(sql, /references public\.client_campaign_periods/);
  for (const column of [
    "offer_angle",
    "packaging_direction",
    "urgency_driver",
    "bonus_direction",
    "positioning_direction",
    "mechanism_direction",
    "reason_to_act_now",
    "cta_direction",
    "offer_risk",
  ]) {
    assert.match(sql, new RegExp(column));
  }
  assert.match(sql, /client_seasonal_offers_main_offer_client_fk/);
  assert.doesNotMatch(sql, /content_idea|asset_type|hook|caption|storyboard|calendar_cell/i);
});

test("Offers edge is deterministic, review-gated, and split by offer_type", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /type OfferType = "main" \| "seasonal"/);
  assert.match(edge, /OFFER_DETAILS_REQUIRED/);
  assert.match(edge, /APPROVED_CAMPAIGN_INTELLIGENCE_REQUIRED/);
  assert.match(edge, /CAMPAIGN_PERIOD_SELECTION_REQUIRED/);
  assert.match(edge, /MAIN_OFFER_SELECTION_REQUIRED/);
  assert.match(edge, /CAMPAIGN_PERIOD_SELECTION_INVALID/);
  assert.match(edge, /MAIN_OFFER_SELECTION_INVALID/);
  assert.match(edge, /research_domain: "offer_system"/);
  assert.match(edge, /seasonal_selection/);
  assert.match(edge, /stage_4b_scaffold: true/);
  assert.match(edge, /human_review_required: true/);
  assert.match(edge, /does_not_rewrite_main_offer: true/);
  assert.match(edge, /promotion_required_for_core_offer_changes: true/);
  assert.match(edge, /status: "needs_review"/);
  assert.match(edge, /No invented results, guarantees, scarcity, pricing, bonuses, upsells, downsells, or continuity mechanics/i);
  assert.match(edge, /No invented scarcity, guarantees, discounts, bonuses, pricing, deadlines, proof, or content ideas/i);
  assert.doesNotMatch(edge, /openai|responses\.create|web_search_preview|tools:\s*\[/i);
  assert.doesNotMatch(edge, /status: "approved"/);
});

test("Offers frontend exposes two tabs and preserves the old offer deep link", async () => {
  const [page, panel, lib] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(panelPath, "utf8"),
    readFile(libPath, "utf8"),
  ]);
  assert.match(page, /label: "Main Offers"/);
  assert.match(page, /label: "Seasonal Offers"/);
  assert.match(page, /section: "offer", hidden: true/);
  assert.match(page, /<OffersPanel clientId=\{id\} offerType="main" \/>/);
  assert.match(page, /<OffersPanel clientId=\{id\} offerType="seasonal" \/>/);
  assert.match(panel, /foundational commercial engine/i);
  assert.match(panel, /contextual packaging, not a replacement for Main Offers or Ideation/i);
  assert.match(panel, /Value Equation/);
  assert.match(panel, /Dream outcome/);
  assert.match(panel, /Campaign period/);
  assert.match(panel, /Main offer/);
  assert.match(panel, /Review history/);
  assert.match(panel, /Archive/);
  assert.match(panel, /Generate \$\{offerType === "main" \? "Main Offers" : "Seasonal Offers"\}/);
  assert.match(lib, /campaign_period_id/);
  assert.match(lib, /main_offer_id/);
  assert.match(lib, /run-offers/);
  assert.match(lib, /review_offer_architecture_release/);
  assert.match(lib, /review_seasonal_offer_release/);
});
