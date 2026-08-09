// Programme Stage 1B-C — deterministic coverage for Facebook Rendition
// capability and lifecycle rules. All pure — no network, no database.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUPPORTED_FACEBOOK_RENDITION_FORMATS, validateFacebookRenditionFormat,
  classifyRenditionMedia, checkRenditionReadyForReview, resolveRenditionTransition, isRenditionEditable,
} from "../supabase/functions/_shared/facebook-rendition-contract.ts";

// ── Format capability (unsupported format blocks clearly) ────────────────

test("IMAGE, VIDEO, REELS and TEXT_LINK are supported — confirmed against Meta's own docs in Stage 1B-A", () => {
  for (const format of SUPPORTED_FACEBOOK_RENDITION_FORMATS) {
    assert.equal(validateFacebookRenditionFormat(format).supported, true, `${format} should be supported`);
  }
});

test("CAROUSEL is blocked, not assumed supported from Instagram parity", () => {
  const result = validateFacebookRenditionFormat("CAROUSEL");
  assert.equal(result.supported, false);
  assert.ok(result.reason?.includes("not confirmed"));
});

test("STORIES is blocked, not assumed supported from Instagram parity", () => {
  const result = validateFacebookRenditionFormat("STORIES");
  assert.equal(result.supported, false);
  assert.ok(result.reason?.includes("not confirmed"));
});

// ── Shared vs platform-specific media (structural, not a stored boolean) ──

test("an asset referenced only by this rendition is platform-specific", () => {
  const result = classifyRenditionMedia(["asset-a"], [["asset-b", "asset-c"]]);
  assert.deepEqual(result.platformSpecificAssetIds, ["asset-a"]);
  assert.deepEqual(result.sharedAssetIds, []);
});

test("an asset also referenced by another rendition is shared", () => {
  const result = classifyRenditionMedia(["asset-a", "asset-b"], [["asset-b", "asset-c"]]);
  assert.deepEqual(result.sharedAssetIds, ["asset-b"]);
  assert.deepEqual(result.platformSpecificAssetIds, ["asset-a"]);
});

test("no other renditions means every asset is platform-specific by definition", () => {
  const result = classifyRenditionMedia(["asset-a"], []);
  assert.deepEqual(result.platformSpecificAssetIds, ["asset-a"]);
});

// ── Readiness / approval gates (unsupported capability blocks clearly) ────

test("empty copy blocks readiness with a clear reason", () => {
  const result = checkRenditionReadyForReview({ copy: "", cta: "Shop now", mediaCount: 1, format: "IMAGE" });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => r.includes("Copy is required")));
});

test("empty CTA blocks readiness", () => {
  const result = checkRenditionReadyForReview({ copy: "Real caption", cta: "", mediaCount: 1, format: "IMAGE" });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => r.includes("call to action")));
});

test("zero media blocks readiness for an IMAGE rendition", () => {
  const result = checkRenditionReadyForReview({ copy: "Real caption", cta: "Shop now", mediaCount: 0, format: "IMAGE" });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => r.includes("media asset")));
});

test("zero media does NOT block a TEXT_LINK rendition — a link post has no media requirement", () => {
  const result = checkRenditionReadyForReview({ copy: "Real caption", cta: "Read more", mediaCount: 0, format: "TEXT_LINK" });
  assert.equal(result.ready, true);
});

test("an unsupported format (CAROUSEL) blocks readiness even with valid copy/cta/media", () => {
  const result = checkRenditionReadyForReview({ copy: "Real caption", cta: "Shop now", mediaCount: 3, format: "CAROUSEL" });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some((r) => r.includes("not confirmed")));
});

test("a fully valid rendition is ready with zero reasons", () => {
  const result = checkRenditionReadyForReview({ copy: "Real caption", cta: "Shop now", mediaCount: 1, format: "IMAGE" });
  assert.deepEqual(result, { ready: true, reasons: [] });
});

// ── Status transitions (mirrors content_briefs' exact action set) ────────

const readyInput = { ready: true, reasons: [] } as const;
const notReadyInput = { ready: false, reasons: ["Copy is required."] } as const;

test("submit_for_review from draft with a ready rendition succeeds", () => {
  const result = resolveRenditionTransition("draft", "submit_for_review", readyInput);
  assert.deepEqual(result, { allowed: true, nextStatus: "in_review", reason: null });
});

test("submit_for_review from draft with an incomplete rendition is refused with the real reason", () => {
  const result = resolveRenditionTransition("draft", "submit_for_review", notReadyInput);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, "Copy is required.");
});

test("submit_for_review is refused from in_review — no double-submission", () => {
  const result = resolveRenditionTransition("in_review", "submit_for_review", readyInput);
  assert.equal(result.allowed, false);
});

test("approve from in_review with a ready rendition succeeds", () => {
  const result = resolveRenditionTransition("in_review", "approve", readyInput);
  assert.deepEqual(result, { allowed: true, nextStatus: "approved", reason: null });
});

test("approve is refused directly from draft — must go through in_review first", () => {
  const result = resolveRenditionTransition("draft", "approve", readyInput);
  assert.equal(result.allowed, false);
  assert.ok(result.reason?.includes("Submit for review first"));
});

test("approve is refused even from in_review if the rendition became not-ready (e.g. capability regressed)", () => {
  const result = resolveRenditionTransition("in_review", "approve", notReadyInput);
  assert.equal(result.allowed, false);
});

test("request_changes from in_review returns to draft", () => {
  const result = resolveRenditionTransition("in_review", "request_changes", readyInput);
  assert.deepEqual(result, { allowed: true, nextStatus: "draft", reason: null });
});

test("request_changes is refused from draft — nothing to request changes on", () => {
  const result = resolveRenditionTransition("draft", "request_changes", readyInput);
  assert.equal(result.allowed, false);
});

test("no action is ever allowed on a superseded rendition — create a new version instead", () => {
  for (const action of ["submit_for_review", "approve", "request_changes"] as const) {
    const result = resolveRenditionTransition("superseded", action, readyInput);
    assert.equal(result.allowed, false, `${action} must be refused on a superseded rendition`);
    assert.ok(result.reason?.includes("new version"));
  }
});

// ── Editability ────────────────────────────────────────────────────────────

test("only draft is editable — in_review, approved and superseded all lock the creative fields", () => {
  assert.equal(isRenditionEditable("draft"), true);
  assert.equal(isRenditionEditable("in_review"), false);
  assert.equal(isRenditionEditable("approved"), false);
  assert.equal(isRenditionEditable("superseded"), false);
});
