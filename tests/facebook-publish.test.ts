// Programme Stage 1B-D — deterministic coverage for the Facebook publish
// orchestration. All pure — no network, no database, no real Meta
// credentials. Covers the test categories named in the stage prompt that
// are decidable from this module's own logic: successful publication,
// provider timeout, rate limit, permission loss, video processing delay,
// failed processing. (Duplicate request, retry cap, reconciliation
// mismatch, and cross-client spoofing are proven at the edge-function /
// generic-RPC layer — see the stage status report for where each is
// actually enforced and how it was live-verified.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { MetaPublishError } from "../supabase/functions/_shared/meta-errors.ts";
import {
  advanceFacebookPublication, isFacebookProcessingExpired, isFacebookProcessingState,
  FACEBOOK_MAX_STATUS_POLLS,
  type FacebookPublishDeps, type FacebookPublishRecordInput, type FacebookVideoProcessingState, type FacebookReelProcessingState,
} from "../supabase/functions/_shared/facebook-publish.ts";

function baseDeps(overrides: Partial<FacebookPublishDeps> = {}): FacebookPublishDeps {
  return {
    signMedia: async () => "https://storage.example/signed-url",
    resolvePageToken: async () => "page-token",
    publishPhoto: async () => ({ externalPostId: "photo-post-1" }),
    publishFeedText: async () => ({ externalPostId: "feed-post-1" }),
    submitVideo: async () => ({ videoId: "video-1" }),
    checkVideoStatus: async () => ({ videoStatus: "ready", processingProgress: 100 }),
    startReelUpload: async () => ({ videoId: "reel-1", uploadUrl: "https://rupload.example/reel-1" }),
    uploadReelFromUrl: async () => {},
    finishReel: async () => ({ externalPostId: "reel-post-1" }),
    now: () => Date.parse("2026-08-15T12:00:00Z"),
    ...overrides,
  };
}

function record(overrides: Partial<FacebookPublishRecordInput> = {}): FacebookPublishRecordInput {
  return {
    contentType: "IMAGE", caption: "Real caption", cta: "Shop now", link: null,
    media: [{ storageBucket: "client-assets", storagePath: "a/b.jpg" }],
    processingState: null,
    ...overrides,
  };
}

// ── Successful publication ────────────────────────────────────────────────

test("IMAGE publishes in one step via the real photo endpoint", async () => {
  const result = await advanceFacebookPublication(baseDeps(), "page-1", record());
  assert.deepEqual(result, { kind: "published", externalPostId: "photo-post-1" });
});

test("TEXT_LINK publishes in one step via the feed endpoint and needs no media", async () => {
  const result = await advanceFacebookPublication(baseDeps(), "page-1", record({ contentType: "TEXT_LINK", media: [], link: "https://example.com" }));
  assert.deepEqual(result, { kind: "published", externalPostId: "feed-post-1" });
});

test("VIDEO: first step submits and returns a processing state, never publishes on the same step", async () => {
  const result = await advanceFacebookPublication(baseDeps(), "page-1", record({ contentType: "VIDEO" }));
  assert.equal(result.kind, "processing");
  if (result.kind === "processing") {
    assert.equal(result.state.kind, "facebook_video");
    assert.equal((result.state as FacebookVideoProcessingState).videoId, "video-1");
    assert.equal(result.state.pollCount, 0);
  }
});

test("VIDEO: a later step with a ready status publishes using the video id as durable evidence", async () => {
  const state: FacebookVideoProcessingState = { kind: "facebook_video", videoId: "video-1", pollCount: 2, startedAt: "2026-08-15T11:00:00Z" };
  const result = await advanceFacebookPublication(baseDeps(), "page-1", record({ contentType: "VIDEO", processingState: state }));
  assert.deepEqual(result, { kind: "published", externalPostId: "video-1" });
});

test("REELS: first step starts the upload session and uploads via the hosted-URL variant, in one invocation", async () => {
  const result = await advanceFacebookPublication(baseDeps(), "page-1", record({ contentType: "REELS" }));
  assert.equal(result.kind, "reel_upload_started");
  if (result.kind === "reel_upload_started") {
    assert.equal(result.state.videoId, "reel-1");
    assert.equal(result.state.phase, "uploaded");
  }
});

test("REELS: a later step with a ready status calls finish and publishes", async () => {
  const state: FacebookReelProcessingState = { kind: "facebook_reel", videoId: "reel-1", phase: "uploaded", pollCount: 3, startedAt: "2026-08-15T11:00:00Z" };
  const result = await advanceFacebookPublication(baseDeps(), "page-1", record({ contentType: "REELS", processingState: state }));
  assert.deepEqual(result, { kind: "published", externalPostId: "reel-post-1" });
});

// ── Video processing delay ────────────────────────────────────────────────

test("VIDEO: a still-processing status increments the poll count and never publishes", async () => {
  const state: FacebookVideoProcessingState = { kind: "facebook_video", videoId: "video-1", pollCount: 1, startedAt: "2026-08-15T11:00:00Z" };
  const deps = baseDeps({ checkVideoStatus: async () => ({ videoStatus: "processing", processingProgress: 40 }) });
  const result = await advanceFacebookPublication(deps, "page-1", record({ contentType: "VIDEO", processingState: state }));
  assert.equal(result.kind, "processing");
  if (result.kind === "processing") assert.equal(result.state.pollCount, 2);
});

test("REELS: a still-processing status increments the poll count without calling finish", async () => {
  let finishCalled = false;
  const state: FacebookReelProcessingState = { kind: "facebook_reel", videoId: "reel-1", phase: "uploaded", pollCount: 0, startedAt: "2026-08-15T11:00:00Z" };
  const deps = baseDeps({
    checkVideoStatus: async () => ({ videoStatus: "processing", processingProgress: 10 }),
    finishReel: async () => { finishCalled = true; return { externalPostId: "should-not-happen" }; },
  });
  const result = await advanceFacebookPublication(deps, "page-1", record({ contentType: "REELS", processingState: state }));
  assert.equal(result.kind, "processing");
  assert.equal(finishCalled, false, "finish must never be called before Meta reports ready");
});

// ── Failed processing ─────────────────────────────────────────────────────

test("VIDEO: an error status is a permanent failure, never published", async () => {
  const state: FacebookVideoProcessingState = { kind: "facebook_video", videoId: "video-1", pollCount: 1, startedAt: "2026-08-15T11:00:00Z" };
  const deps = baseDeps({ checkVideoStatus: async () => ({ videoStatus: "error", processingProgress: null }) });
  const result = await advanceFacebookPublication(deps, "page-1", record({ contentType: "VIDEO", processingState: state }));
  assert.equal(result.kind, "permanent_failure");
});

test("REELS: an error status is a permanent failure, never published", async () => {
  const state: FacebookReelProcessingState = { kind: "facebook_reel", videoId: "reel-1", phase: "uploaded", pollCount: 1, startedAt: "2026-08-15T11:00:00Z" };
  const deps = baseDeps({ checkVideoStatus: async () => ({ videoStatus: "error", processingProgress: null }) });
  const result = await advanceFacebookPublication(deps, "page-1", record({ contentType: "REELS", processingState: state }));
  assert.equal(result.kind, "permanent_failure");
});

test("processing that exceeds the poll ceiling is a permanent failure, not an infinite retry", () => {
  const state: FacebookVideoProcessingState = { kind: "facebook_video", videoId: "video-1", pollCount: FACEBOOK_MAX_STATUS_POLLS, startedAt: "2026-08-15T11:00:00Z" };
  assert.equal(isFacebookProcessingExpired(state, () => Date.parse("2026-08-15T12:00:00Z")), true);
});

test("processing that exceeds the 24h wall-clock ceiling is expired even with a low poll count", () => {
  const state: FacebookVideoProcessingState = { kind: "facebook_video", videoId: "video-1", pollCount: 1, startedAt: "2026-08-14T00:00:00Z" };
  assert.equal(isFacebookProcessingExpired(state, () => Date.parse("2026-08-15T12:00:00Z")), true);
});

test("processing well within both ceilings is not expired", () => {
  const state: FacebookVideoProcessingState = { kind: "facebook_video", videoId: "video-1", pollCount: 1, startedAt: "2026-08-15T11:00:00Z" };
  assert.equal(isFacebookProcessingExpired(state, () => Date.parse("2026-08-15T12:00:00Z")), false);
});

test("an expired VIDEO processing state is refused as a permanent failure on the next step, never republished", async () => {
  const state: FacebookVideoProcessingState = { kind: "facebook_video", videoId: "video-1", pollCount: FACEBOOK_MAX_STATUS_POLLS, startedAt: "2026-08-15T11:00:00Z" };
  const deps = baseDeps({ checkVideoStatus: async () => { throw new Error("must not be called once expired"); } });
  const result = await advanceFacebookPublication(deps, "page-1", record({ contentType: "VIDEO", processingState: state }));
  assert.equal(result.kind, "permanent_failure");
});

// ── Provider timeout / rate limit / permission loss (via classifyMetaError) ─

test("a timeout-shaped provider error is retryable, not permanent", async () => {
  const deps = baseDeps({
    publishPhoto: async () => { throw new MetaPublishError({ provider: "meta", category: "meta_server_error", retryable: true, message: "Meta 500" }); },
  });
  const result = await advanceFacebookPublication(deps, "page-1", record());
  assert.equal(result.kind, "transient_failure");
});

test("a rate-limit provider error is retryable", async () => {
  const deps = baseDeps({
    publishPhoto: async () => { throw new MetaPublishError({ provider: "meta", category: "meta_rate_limited", retryable: true, message: "Meta 429" }); },
  });
  const result = await advanceFacebookPublication(deps, "page-1", record());
  assert.equal(result.kind, "transient_failure");
});

test("a permission-loss (auth) provider error is a non-retryable permanent failure", async () => {
  const deps = baseDeps({
    resolvePageToken: async () => { throw new MetaPublishError({ provider: "meta", category: "meta_authentication", retryable: false, message: "Error validating access token" }); },
  });
  const result = await advanceFacebookPublication(deps, "page-1", record());
  assert.equal(result.kind, "permanent_failure");
});

// ── Validation ─────────────────────────────────────────────────────────────

test("an IMAGE post with no media is refused before any Meta call", async () => {
  let called = false;
  const deps = baseDeps({ publishPhoto: async () => { called = true; return { externalPostId: "x" }; } });
  const result = await advanceFacebookPublication(deps, "page-1", record({ media: [] }));
  assert.equal(result.kind, "permanent_failure");
  assert.equal(called, false);
});

test("isFacebookProcessingState correctly discriminates real state shapes from arbitrary values", () => {
  assert.equal(isFacebookProcessingState({ kind: "facebook_video", videoId: "x", pollCount: 0, startedAt: "now" }), true);
  assert.equal(isFacebookProcessingState({ kind: "facebook_reel", videoId: "x", phase: "uploaded", pollCount: 0, startedAt: "now" }), true);
  assert.equal(isFacebookProcessingState({ kind: "instagram_container" }), false);
  assert.equal(isFacebookProcessingState(null), false);
  assert.equal(isFacebookProcessingState("facebook_video"), false);
});
