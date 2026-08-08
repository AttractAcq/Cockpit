// Programme Stage I — Shared Production Studio, deterministic unit coverage.
// No provider call and no database is touched — everything under test is pure.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  routeToStudio,
  checkProviderCapability,
  validateAssetPlan,
  checkCtaPresent,
  checkProofAccuracy,
  checkAspectRatio,
  buildProductionJobIdempotencyKey,
} from "../supabase/functions/_shared/production-studio.ts";

// ---------------------------------------------------------------------------
// routeToStudio
// ---------------------------------------------------------------------------

test("routeToStudio: paid always routes to ad_studio regardless of format", () => {
  const result = routeToStudio({ format: "reel", organicOrPaid: "paid" });
  assert.equal(result.routable, true);
  assert.equal(result.studio, "ad_studio");
});

test("routeToStudio: organic reel/video routes to reel_studio", () => {
  assert.equal(routeToStudio({ format: "reel", organicOrPaid: "organic" }).studio, "reel_studio");
  assert.equal(routeToStudio({ format: "video", organicOrPaid: "organic" }).studio, "reel_studio");
});

test("routeToStudio: organic carousel routes to carousel_studio", () => {
  assert.equal(routeToStudio({ format: "carousel", organicOrPaid: "organic" }).studio, "carousel_studio");
});

test("routeToStudio: organic story/stories routes to story_studio", () => {
  assert.equal(routeToStudio({ format: "story", organicOrPaid: "organic" }).studio, "story_studio");
  assert.equal(routeToStudio({ format: "stories", organicOrPaid: "organic" }).studio, "story_studio");
});

test("routeToStudio: organic feed_post/feed/static routes to feed_post_studio", () => {
  assert.equal(routeToStudio({ format: "feed_post", organicOrPaid: "organic" }).studio, "feed_post_studio");
  assert.equal(routeToStudio({ format: "feed", organicOrPaid: "organic" }).studio, "feed_post_studio");
  assert.equal(routeToStudio({ format: "static", organicOrPaid: "organic" }).studio, "feed_post_studio");
});

test("routeToStudio: is case- and whitespace-insensitive", () => {
  assert.equal(routeToStudio({ format: "  Feed Post ", organicOrPaid: "organic" }).studio, "feed_post_studio");
  assert.equal(routeToStudio({ format: "REEL", organicOrPaid: "organic" }).studio, "reel_studio");
});

test("routeToStudio: unrecognised organic format is unroutable with a reason", () => {
  const result = routeToStudio({ format: "podcast", organicOrPaid: "organic" });
  assert.equal(result.routable, false);
  assert.equal(result.studio, null);
  assert.match(result.reason ?? "", /podcast/);
});

// ---------------------------------------------------------------------------
// checkProviderCapability
// ---------------------------------------------------------------------------

test("checkProviderCapability: known provider + supported capability passes", () => {
  const result = checkProviderCapability("anthropic", "text_generation");
  assert.equal(result.supported, true);
  assert.equal(result.reason, null);
});

test("checkProviderCapability: known provider + unsupported capability fails cleanly", () => {
  const result = checkProviderCapability("anthropic", "still_image_generation");
  assert.equal(result.supported, false);
  assert.match(result.reason ?? "", /anthropic/);
});

test("checkProviderCapability: higgsfield supports all four media-generation capabilities", () => {
  for (const capability of [
    "still_image_generation", "image_to_video", "carousel_slide_generation", "story_frame_generation",
  ] as const) {
    assert.equal(checkProviderCapability("higgsfield", capability).supported, true);
  }
});

test("checkProviderCapability: unknown provider fails cleanly, does not throw", () => {
  const result = checkProviderCapability("madeup_provider", "text_generation");
  assert.equal(result.supported, false);
  assert.match(result.reason ?? "", /madeup_provider/);
});

// ---------------------------------------------------------------------------
// validateAssetPlan
// ---------------------------------------------------------------------------

test("validateAssetPlan: accepts a well-formed plan", () => {
  const plan = validateAssetPlan([
    { category: "proof_asset", description: "Client testimonial screenshot", required: true },
    { category: "stock", description: "B-roll of a warehouse", required: false },
  ]);
  assert.equal(plan?.length, 2);
  assert.equal(plan?.[0].category, "proof_asset");
});

test("validateAssetPlan: accepts an empty array", () => {
  assert.deepEqual(validateAssetPlan([]), []);
});

test("validateAssetPlan: rejects a non-array", () => {
  assert.equal(validateAssetPlan({ category: "stock" }), null);
  assert.equal(validateAssetPlan("stock"), null);
  assert.equal(validateAssetPlan(null), null);
});

test("validateAssetPlan: rejects an unrecognised category", () => {
  assert.equal(validateAssetPlan([{ category: "holographic", description: "x", required: true }]), null);
});

test("validateAssetPlan: rejects an empty description", () => {
  assert.equal(validateAssetPlan([{ category: "stock", description: "", required: true }]), null);
  assert.equal(validateAssetPlan([{ category: "stock", description: "   ", required: true }]), null);
});

test("validateAssetPlan: rejects a non-boolean required", () => {
  assert.equal(validateAssetPlan([{ category: "stock", description: "x", required: "yes" }]), null);
});

// ---------------------------------------------------------------------------
// checkCtaPresent
// ---------------------------------------------------------------------------

test("checkCtaPresent: passes when a non-empty CTA is present", () => {
  const result = checkCtaPresent("Book a discovery call");
  assert.equal(result.passed, true);
});

test("checkCtaPresent: fails for null, undefined, or blank", () => {
  assert.equal(checkCtaPresent(null).passed, false);
  assert.equal(checkCtaPresent(undefined).passed, false);
  assert.equal(checkCtaPresent("   ").passed, false);
});

// ---------------------------------------------------------------------------
// checkProofAccuracy
// ---------------------------------------------------------------------------

test("checkProofAccuracy: passes trivially when proof is not required", () => {
  const result = checkProofAccuracy(false, 0);
  assert.equal(result.passed, true);
});

test("checkProofAccuracy: fails when required but zero verified proofs linked", () => {
  const result = checkProofAccuracy(true, 0);
  assert.equal(result.passed, false);
});

test("checkProofAccuracy: passes when required and at least one verified proof linked", () => {
  const result = checkProofAccuracy(true, 3);
  assert.equal(result.passed, true);
  assert.match(result.detail, /3/);
});

// ---------------------------------------------------------------------------
// checkAspectRatio
// ---------------------------------------------------------------------------

test("checkAspectRatio: passes for a 9:16 asset on instagram_reel", () => {
  const result = checkAspectRatio("instagram", "reel", 1080, 1920);
  assert.equal(result.passed, true);
});

test("checkAspectRatio: fails for a mismatched ratio", () => {
  const result = checkAspectRatio("instagram", "reel", 1920, 1080);
  assert.equal(result.passed, false);
});

test("checkAspectRatio: fails when dimensions are missing", () => {
  const result = checkAspectRatio("instagram", "reel", null, null);
  assert.equal(result.passed, false);
  assert.match(result.detail, /no recorded dimensions/i);
});

test("checkAspectRatio: passes (not checked) for an unknown platform/format pair", () => {
  const result = checkAspectRatio("tiktok", "duet", 100, 100);
  assert.equal(result.passed, true);
  assert.match(result.detail, /not checked/i);
});

test("checkAspectRatio: passes for a 1:1 asset on instagram_feed", () => {
  const result = checkAspectRatio("instagram", "feed", 1080, 1080);
  assert.equal(result.passed, true);
});

// ---------------------------------------------------------------------------
// buildProductionJobIdempotencyKey
// ---------------------------------------------------------------------------

test("buildProductionJobIdempotencyKey: deterministic for the same inputs", () => {
  const a = buildProductionJobIdempotencyKey("item-1", "reel_studio");
  const b = buildProductionJobIdempotencyKey("item-1", "reel_studio");
  assert.equal(a, b);
});

test("buildProductionJobIdempotencyKey: differs by content item or capability", () => {
  const base = buildProductionJobIdempotencyKey("item-1", "reel_studio");
  assert.notEqual(base, buildProductionJobIdempotencyKey("item-2", "reel_studio"));
  assert.notEqual(base, buildProductionJobIdempotencyKey("item-1", "ad_studio"));
});
