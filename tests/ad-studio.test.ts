// Programme Stage L — Ad Studio and Paid Distribution, deterministic unit
// coverage: the Ad Brief contract, the creative matrix generator, the full
// safety-policy gate, and the Meta Ads adapter's orchestration functions
// (dependency-injected — no network, no real provider call, no spend).

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  validateAdBriefBody, renderAdBriefMarkdown, checkAdClaimGate,
  generateCreativeMatrix, MAX_VARIANTS_PER_BRIEF,
} from "../supabase/functions/_shared/ad-studio.ts";
import {
  checkAccountOwnershipPolicy, checkPaymentMethodPolicy, checkSpendLimitPolicy,
  checkGeographyPolicy, checkAudienceRestrictionPolicy, checkClientApprovalPolicy,
  checkRegulatedCategoryPolicy, checkLaunchPolicy, NO_POLICY, type AdBudgetPolicy,
} from "../supabase/functions/_shared/ad-safety-policy.ts";
import {
  classifyMetaAdsError, createCampaignStep, activateCampaignStep, fetchInsightsStep,
  type MetaAdsDeps, type MetaAdsCredentials,
} from "../supabase/functions/_shared/meta-ads.ts";

const VALID_BODY = {
  campaign_objective: "Book a call", awareness_stage: "problem_aware", audience: "SME owners",
  offer: "Free audit", landing_page: "https://example.com", primary_claim: "40% more leads",
  proof_required: true, hook_variants: ["Hook A", "Hook B"], visual_variants: ["Visual A"],
  copy_variants: ["Copy A"], cta_variants: ["Book now", "Learn more"], placement: ["feed"],
  testing_role: "hook_test", attribution_requirements: { pixel_id: "px1", conversion_event: "Lead" },
};

// ---------------------------------------------------------------------------
// validateAdBriefBody / renderAdBriefMarkdown / checkAdClaimGate
// ---------------------------------------------------------------------------

test("validateAdBriefBody: accepts a well-formed brief", () => {
  assert.notEqual(validateAdBriefBody(VALID_BODY), null);
});

test("validateAdBriefBody: rejects a missing required field", () => {
  const { campaign_objective, ...rest } = VALID_BODY;
  void campaign_objective;
  assert.equal(validateAdBriefBody(rest), null);
});

test("validateAdBriefBody: rejects an empty variant array", () => {
  assert.equal(validateAdBriefBody({ ...VALID_BODY, hook_variants: [] }), null);
});

test("validateAdBriefBody: rejects a non-boolean proof_required", () => {
  assert.equal(validateAdBriefBody({ ...VALID_BODY, proof_required: "yes" }), null);
});

test("validateAdBriefBody: attribution_requirements pixel_id/conversion_event may be null", () => {
  const result = validateAdBriefBody({ ...VALID_BODY, attribution_requirements: { pixel_id: null, conversion_event: null } });
  assert.notEqual(result, null);
  assert.equal(result?.attribution_requirements.pixel_id, null);
});

test("renderAdBriefMarkdown: includes every hook, copy and CTA variant", () => {
  const validated = validateAdBriefBody(VALID_BODY)!;
  const md = renderAdBriefMarkdown(validated);
  assert.match(md, /Hook A/);
  assert.match(md, /Hook B/);
  assert.match(md, /Book now/);
  assert.match(md, /40% more leads/);
});

test("checkAdClaimGate: passes trivially when proof is not required", () => {
  assert.equal(checkAdClaimGate(false, 0).passed, true);
});

test("checkAdClaimGate: fails when required but no verified proof is linked ('Unsupported claims fail')", () => {
  const result = checkAdClaimGate(true, 0);
  assert.equal(result.passed, false);
  assert.match(result.reason ?? "", /proof/i);
});

test("checkAdClaimGate: passes when required and at least one verified proof is linked", () => {
  assert.equal(checkAdClaimGate(true, 1).passed, true);
});

// ---------------------------------------------------------------------------
// generateCreativeMatrix
// ---------------------------------------------------------------------------

test("generateCreativeMatrix: produces the exact cartesian product size", () => {
  const result = generateCreativeMatrix(
    { hook_variants: ["h1", "h2"], visual_variants: ["v1"], copy_variants: ["c1"], cta_variants: ["cta1", "cta2"] },
    ["feed", "story"],
  );
  assert.equal(result.ok, true);
  assert.equal(result.totalCombinations, 2 * 1 * 1 * 2 * 2);
  assert.equal(result.combinations.length, result.totalCombinations);
});

test("generateCreativeMatrix: every combination retains its source indices ('creative variants retain source provenance')", () => {
  const result = generateCreativeMatrix(
    { hook_variants: ["h1", "h2"], visual_variants: ["v1"], copy_variants: ["c1"], cta_variants: ["cta1"] },
    ["feed"],
  );
  assert.equal(result.ok, true);
  const second = result.combinations.find((c) => c.hookText === "h2");
  assert.equal(second?.hookIndex, 1);
  assert.equal(second?.visualIndex, 0);
});

test("generateCreativeMatrix: fails closed rather than truncating when the matrix exceeds the variant cap", () => {
  const manyHooks = Array.from({ length: MAX_VARIANTS_PER_BRIEF + 1 }, (_, i) => `hook-${i}`);
  const result = generateCreativeMatrix(
    { hook_variants: manyHooks, visual_variants: ["v1"], copy_variants: ["c1"], cta_variants: ["cta1"] },
    ["feed"],
  );
  assert.equal(result.ok, false);
  assert.equal(result.combinations.length, 0);
  assert.match(result.error ?? "", /exceeding/);
});

test("generateCreativeMatrix: requires at least one format", () => {
  const result = generateCreativeMatrix(
    { hook_variants: ["h1"], visual_variants: ["v1"], copy_variants: ["c1"], cta_variants: ["cta1"] },
    [],
  );
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Safety policy gates
// ---------------------------------------------------------------------------

const FULL_POLICY: AdBudgetPolicy = {
  adAccountId: "act_123", adAccountOwnerVerified: true, paymentMethodVerified: true,
  spendLimitDaily: 100, spendLimitTotal: 1000, requiresClientApproval: true,
  allowedGeographies: ["NL", "DE"], restrictedAudienceFlags: ["sensitive_health"], regulatedCategories: ["financial_services"],
};

test("checkAccountOwnershipPolicy: fails with no policy configured", () => {
  assert.equal(checkAccountOwnershipPolicy(NO_POLICY).allowed, false);
});

test("checkAccountOwnershipPolicy: fails when the account is unverified", () => {
  assert.equal(checkAccountOwnershipPolicy({ ...FULL_POLICY, adAccountOwnerVerified: false }).allowed, false);
});

test("checkAccountOwnershipPolicy: passes when configured and verified", () => {
  assert.equal(checkAccountOwnershipPolicy(FULL_POLICY).allowed, true);
});

test("checkPaymentMethodPolicy: fails when unverified", () => {
  assert.equal(checkPaymentMethodPolicy(NO_POLICY).allowed, false);
});

test("checkSpendLimitPolicy: fails closed when no limit is configured at all", () => {
  const result = checkSpendLimitPolicy(NO_POLICY, 50, null);
  assert.equal(result.allowed, false);
  assert.equal(result.code, "NO_SPEND_LIMIT_CONFIGURED");
});

test("checkSpendLimitPolicy: 'Budget cannot exceed configured limit' — daily budget over the limit is blocked", () => {
  const result = checkSpendLimitPolicy(FULL_POLICY, 150, null);
  assert.equal(result.allowed, false);
  assert.equal(result.code, "DAILY_BUDGET_EXCEEDS_LIMIT");
});

test("checkSpendLimitPolicy: total budget over the limit is blocked", () => {
  const result = checkSpendLimitPolicy(FULL_POLICY, null, 5000);
  assert.equal(result.allowed, false);
  assert.equal(result.code, "TOTAL_BUDGET_EXCEEDS_LIMIT");
});

test("checkSpendLimitPolicy: a budget within both limits passes", () => {
  assert.equal(checkSpendLimitPolicy(FULL_POLICY, 50, 500).allowed, true);
});

test("checkGeographyPolicy: fails closed with no geographies configured", () => {
  assert.equal(checkGeographyPolicy(NO_POLICY, ["NL"]).allowed, false);
});

test("checkGeographyPolicy: blocks a requested geography outside the allowed set", () => {
  const result = checkGeographyPolicy(FULL_POLICY, ["NL", "US"]);
  assert.equal(result.allowed, false);
  assert.match(result.reason ?? "", /US/);
});

test("checkGeographyPolicy: allows geographies within the configured set", () => {
  assert.equal(checkGeographyPolicy(FULL_POLICY, ["NL"]).allowed, true);
});

test("checkAudienceRestrictionPolicy: blocks a restricted flag", () => {
  assert.equal(checkAudienceRestrictionPolicy(FULL_POLICY, ["sensitive_health"]).allowed, false);
});

test("checkAudienceRestrictionPolicy: allows an unrestricted flag", () => {
  assert.equal(checkAudienceRestrictionPolicy(FULL_POLICY, ["broad"]).allowed, true);
});

test("checkClientApprovalPolicy: 'No live spend without explicit approved policy' — blocks without a recorded approval", () => {
  assert.equal(checkClientApprovalPolicy(FULL_POLICY, { clientApprovedAt: null }).allowed, false);
});

test("checkClientApprovalPolicy: allows once client approval is recorded", () => {
  assert.equal(checkClientApprovalPolicy(FULL_POLICY, { clientApprovedAt: "2026-08-01T00:00:00Z" }).allowed, true);
});

test("checkClientApprovalPolicy: internal-only policies never block on this check", () => {
  assert.equal(checkClientApprovalPolicy({ ...FULL_POLICY, requiresClientApproval: false }, { clientApprovedAt: null }).allowed, true);
});

test("checkRegulatedCategoryPolicy: blocks an unacknowledged regulated category", () => {
  assert.equal(checkRegulatedCategoryPolicy(FULL_POLICY, "financial_services", false).allowed, false);
});

test("checkRegulatedCategoryPolicy: allows once explicitly acknowledged", () => {
  assert.equal(checkRegulatedCategoryPolicy(FULL_POLICY, "financial_services", true).allowed, true);
});

test("checkRegulatedCategoryPolicy: a non-regulated category never blocks", () => {
  assert.equal(checkRegulatedCategoryPolicy(FULL_POLICY, "general_retail", false).allowed, true);
});

test("checkLaunchPolicy: an unconfigured client is blocked at the first failing check, not silently allowed", () => {
  const result = checkLaunchPolicy({
    policy: NO_POLICY, campaign: { clientApprovedAt: null, budgetDaily: 50, budgetTotal: null },
    requestedGeographies: ["NL"], requestedAudienceFlags: [], regulatedCategory: null, regulatedCategoryAcknowledged: false,
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "NO_AD_ACCOUNT");
});

test("checkLaunchPolicy: a fully compliant request passes every gate", () => {
  const result = checkLaunchPolicy({
    policy: FULL_POLICY, campaign: { clientApprovedAt: "2026-08-01T00:00:00Z", budgetDaily: 50, budgetTotal: 500 },
    requestedGeographies: ["NL"], requestedAudienceFlags: ["broad"], regulatedCategory: null, regulatedCategoryAcknowledged: false,
  });
  assert.equal(result.allowed, true);
});

// ---------------------------------------------------------------------------
// Meta Ads adapter — dependency-injected, no network
// ---------------------------------------------------------------------------

function mockDeps(overrides: Partial<MetaAdsDeps> = {}): MetaAdsDeps {
  return {
    createCampaign: async () => "campaign-1",
    createAdSet: async () => "adset-1",
    createAd: async () => "ad-1",
    setCampaignStatus: async () => {},
    updateAdSetBudget: async () => {},
    fetchCampaignInsights: async () => ({ spend: 0, impressions: 0, clicks: 0, conversions: 0 }),
    ...overrides,
  };
}
const CREDS: MetaAdsCredentials = { accessToken: "token", adAccountId: "act_1" };

test("createCampaignStep: a successful call returns the real external id", async () => {
  const result = await createCampaignStep(mockDeps(), CREDS, { name: "n", objective: "OUTCOME_TRAFFIC", specialAdCategories: [] });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, "campaign-1");
});

test("createCampaignStep: a thrown error is classified, never fabricated as success", async () => {
  const deps = mockDeps({ createCampaign: async () => { throw new Error("boom"); } });
  const result = await createCampaignStep(deps, CREDS, { name: "n", objective: "OUTCOME_TRAFFIC", specialAdCategories: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.category, "meta_unknown");
});

test("activateCampaignStep: propagates a classified failure without activating", async () => {
  const deps = mockDeps({ setCampaignStatus: async () => { throw new Error("nope"); } });
  const result = await activateCampaignStep(deps, CREDS, "campaign-1");
  assert.equal(result.ok, false);
});

test("fetchInsightsStep: returns real numbers from the injected deps, never invented", async () => {
  const deps = mockDeps({ fetchCampaignInsights: async () => ({ spend: 42.5, impressions: 1000, clicks: 20, conversions: 3 }) });
  const result = await fetchInsightsStep(deps, CREDS, "campaign-1");
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, { spend: 42.5, impressions: 1000, clicks: 20, conversions: 3 });
});

test("classifyMetaAdsError: an OAuth error is authentication, non-retryable", () => {
  const result = classifyMetaAdsError(401, { error: { type: "OAuthException", message: "bad token" } });
  assert.equal(result.category, "meta_authentication");
  assert.equal(result.retryable, false);
});

test("classifyMetaAdsError: HTTP 429 is rate-limited, retryable", () => {
  const result = classifyMetaAdsError(429, {});
  assert.equal(result.category, "meta_rate_limited");
  assert.equal(result.retryable, true);
});

test("classifyMetaAdsError: a 5xx is a server error, retryable", () => {
  const result = classifyMetaAdsError(500, {});
  assert.equal(result.category, "meta_server_error");
  assert.equal(result.retryable, true);
});

test("classifyMetaAdsError: a 400 is a validation error, non-retryable", () => {
  const result = classifyMetaAdsError(400, { error: { message: "bad param" } });
  assert.equal(result.category, "meta_validation");
  assert.equal(result.retryable, false);
});
