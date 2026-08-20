// Cockpit v3 Step 2 -- Marketing, the last and largest rehome in this step
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md). Unlike the four prior rehomes
// (Automations, Team, Knowledge, Finance), Marketing isn't a single
// extracted component: it renders the six already-real panel groups Stage
// 2 Phase 05 already clustered under a "Marketing" label inside
// ClientDetailPage's own tab pill row (group: "Marketing" in DELIVERY_PAGES
// there) -- Offer, Campaigns, Ideation, Creation, Distribution, Iteration --
// through a client picker instead of a ClientDetailPage URL param. Pure
// recomposition: the exact same panel components, the exact same props.
// Confirmed by source-text checks below, matching every prior rehome's own
// no-React-component-test-infra convention.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

const constantsPath = new URL("../src/lib/constants.ts", import.meta.url);
const appPath = new URL("../src/App.tsx", import.meta.url);
const marketingPagePath = new URL("../src/pages/MarketingPage.tsx", import.meta.url);
const clientDetailPagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);

test("routes and nav wiring: Marketing is a new top-level page", async () => {
  const constants = await readFile(constantsPath, "utf8");
  assert.match(constants, /marketing: "\/marketing"/);
  assert.match(constants, /label: "Marketing",\s*path: ROUTES\.marketing/);
  const app = await readFile(appPath, "utf8");
  assert.match(app, /path=\{ROUTES\.marketing\} element=\{<MarketingPage \/>\}/);
});

test("MarketingPage's six groups match ClientDetailPage's own real Marketing cluster exactly -- same sections it already groups under group: \"Marketing\"", async () => {
  const clientDetail = await readFile(clientDetailPagePath, "utf8");
  const marketingClusterMatch = clientDetail.match(/\/\/ Stage 2 Phase 05:[\s\S]*?const VALID_SECTIONS/);
  assert.ok(marketingClusterMatch, "expected to find the Phase 05 Marketing-cluster comment and the DELIVERY_PAGES entries below it");
  const cluster = marketingClusterMatch![0];
  // Every real DELIVERY_PAGES entry marked group: "Marketing" (Offer,
  // Campaigns, Ideation, Creation, Distribution, Iteration -- not Avatars,
  // which keeps its original un-grouped position per Phase 05's own trace).
  for (const label of ["Offer", "Campaigns", "Ideation", "Creation", "Distribution", "Iteration"]) {
    const labelRe = new RegExp(`label:\\s*"${label}",\\s*\\n\\s*group:\\s*"Marketing"`);
    assert.match(cluster, labelRe, `expected DELIVERY_PAGES entry "${label}" to carry group: "Marketing"`);
  }
  assert.doesNotMatch(cluster.split('label: "Avatars"')[1]?.split("},")[0] ?? "", /group:\s*"Marketing"/, "Avatars must stay outside the Marketing cluster, matching Phase 05's own dependency trace");
});

test("MarketingPage renders the exact same panel components ClientDetailPage already uses for every Marketing tab -- no new panel logic", async () => {
  const marketing = await readFile(marketingPagePath, "utf8");
  const expectedByTab: Record<string, string> = {
    main_offers: "OffersPanel",
    seasonal_offers: "OffersPanel",
    marketing_campaigns: "MarketingCampaignsPanel",
    content_supply: "ContentSupplyPanel",
    calendar: "Phase3CalendarPanel",
    content_items: "MastersPanel",
    content_creation: "ContentCreationPanel",
    reel_studio: "ReelStudioPanel",
    assets: "AssetsPanel",
    distribution: "DistributionPanel",
    paid_distribution: "AdStudioPanel",
    analytics: "AnalyticsPanel",
    "performance-iteration": "PerformanceIterationPanel",
  };
  for (const [tabCase, component] of Object.entries(expectedByTab)) {
    const caseRe = new RegExp(`case "${tabCase}":[\\s\\S]{0,200}?<${component}[\\s>]`);
    assert.match(marketing, caseRe, `expected case "${tabCase}" to render <${component}>`);
  }
});

test("every Marketing panel reads the client picked in this page, not a route param -- the client_id/BusinessContext bridge applied the same way as Knowledge/Opportunities", async () => {
  const marketing = await readFile(marketingPagePath, "utf8");
  assert.match(marketing, /import\s*\{\s*useBusinessContext\s*\}\s*from\s*"@\/lib\/business-context"/);
  assert.match(marketing, /selectedClientId/);
  assert.doesNotMatch(marketing, /useParams/, "MarketingPage must not read a route param for client identity -- it's a picker-driven top-level page, not a client-detail sub-route");
});

test("the legacy Phase 3 full-month generation control is deliberately not duplicated here, and stays reachable from ClientDetailPage per hide-before-delete", async () => {
  const marketing = await readFile(marketingPagePath, "utf8");
  // Only the explanatory comment should mention these -- no actual state,
  // function, or render call reusing the legacy control block.
  assert.doesNotMatch(marketing, /function renderPhase3Controls|useState\(false\).*[Pp]hase3Running|<Phase3CalendarPanel[^>]*key=/, "the legacy bulk-generation control block must not be duplicated into the new page");

  const clientDetail = await readFile(clientDetailPagePath, "utf8");
  assert.match(clientDetail, /const renderPhase3Controls = \(\) =>/, "the original control must still exist, untouched, per hide-before-delete");
});
