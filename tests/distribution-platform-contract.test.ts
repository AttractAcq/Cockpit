// Programme Stage 1B-A — deterministic coverage for the canonical
// cross-platform distribution contract. All pure — no network, no database.
// This module is intentionally NOT wired into the live publish-capability
// gate this stage (see distribution-platform-contract.ts's header comment),
// so these tests exercise the contract's own correctness in isolation.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_PLATFORMS, LIVE_PLATFORMS, isLivePlatform,
  PUBLICATION_STATUSES, isTerminalPublicationStatus,
  hasPublicationEvidence, fromLegacyInstagramRow,
  type LegacyInstagramDistributionRow, type Receipt,
} from "../supabase/functions/_shared/distribution-platform-contract.ts";

// ── Platform ──────────────────────────────────────────────────────────────

test("facebook is a defined platform but not a live one — the exit gate boundary, encoded", () => {
  assert.ok(ALL_PLATFORMS.includes("facebook"), "facebook must be a defined contract platform");
  assert.ok(!LIVE_PLATFORMS.includes("facebook" as never), "facebook must NOT be live until Stage 1B-D");
  assert.equal(isLivePlatform("facebook"), false);
});

test("instagram is both defined and live, matching the current production gate", () => {
  assert.ok(ALL_PLATFORMS.includes("instagram"));
  assert.equal(isLivePlatform("instagram"), true);
});

test("an unknown platform string is never treated as live", () => {
  assert.equal(isLivePlatform("tiktok"), false);
  assert.equal(isLivePlatform(""), false);
});

// ── Publication status machine ───────────────────────────────────────────

test("the publication status vocabulary matches the live CHECK constraint exactly", () => {
  // Verified live against client_distribution_records_publish_status_check
  // this stage — any drift here would silently desync the contract from
  // the real schema.
  assert.deepEqual(
    [...PUBLICATION_STATUSES].sort(),
    ["cancelled", "failed", "needs_reconciliation", "published", "publishing", "ready", "scheduled"].sort(),
  );
});

test("published and cancelled are terminal; every in-flight status is not", () => {
  assert.equal(isTerminalPublicationStatus("published"), true);
  assert.equal(isTerminalPublicationStatus("cancelled"), true);
  for (const status of ["ready", "scheduled", "publishing", "failed", "needs_reconciliation"] as const) {
    assert.equal(isTerminalPublicationStatus(status), false, `${status} must not be terminal`);
  }
});

// ── Receipt / duplicate-publication evidence ─────────────────────────────

test("hasPublicationEvidence mirrors the live duplicate-publication guard exactly", () => {
  const empty: Receipt = { externalPostId: null, publishedAt: null, publishedUrl: null };
  assert.equal(hasPublicationEvidence(empty), false);
  assert.equal(hasPublicationEvidence({ ...empty, externalPostId: "17800000000" }), true);
  assert.equal(hasPublicationEvidence({ ...empty, publishedAt: "2026-08-09T00:00:00Z" }), true);
  assert.equal(hasPublicationEvidence({ ...empty, publishedUrl: "https://instagram.com/p/x" }), true);
});

// ── Compatibility: real, live Instagram row shapes → the canonical contract ─

function baseRow(overrides: Partial<LegacyInstagramDistributionRow> = {}): LegacyInstagramDistributionRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    client_id: "22222222-2222-2222-2222-222222222222",
    platform: "instagram",
    destination: "17841400000000000",
    asset_format: "feed_post",
    publish_status: "published",
    publish_payload: { caption: "Real caption", media: [{ storage_bucket: "client-assets", storage_path: "a/b.jpg", mime_type: "image/jpeg" }] },
    publish_settings: { content_type: "IMAGE" },
    external_post_id: "17900000000",
    published_at: "2026-08-01T12:00:00Z",
    published_url: "https://www.instagram.com/p/abc/",
    external_container_id: null,
    container_status: null,
    container_poll_count: null,
    last_error: null,
    ...overrides,
  };
}

test("a published single-image feed post maps losslessly", () => {
  const pub = fromLegacyInstagramRow(baseRow());
  assert.equal(pub.clientId, "22222222-2222-2222-2222-222222222222");
  assert.equal(pub.destinationId, "17841400000000000");
  assert.equal(pub.rendition.platform, "instagram");
  assert.equal(pub.rendition.contentType, "IMAGE");
  assert.equal(pub.rendition.caption, "Real caption");
  assert.equal(pub.rendition.media.length, 1);
  assert.equal(pub.rendition.media[0].storageBucket, "client-assets");
  assert.equal(pub.status, "published");
  assert.equal(pub.receipt.externalPostId, "17900000000");
  assert.equal(pub.processingState, null, "a completed publish carries no live container id");
});

test("carousel asset_format maps to CAROUSEL content type even without explicit publish_settings.content_type", () => {
  const pub = fromLegacyInstagramRow(baseRow({ asset_format: "carousel", publish_settings: {} }));
  assert.equal(pub.rendition.contentType, "CAROUSEL");
});

test("story_sequence and story_video both map to STORIES", () => {
  assert.equal(fromLegacyInstagramRow(baseRow({ asset_format: "story_sequence", publish_settings: {} })).rendition.contentType, "STORIES");
  assert.equal(fromLegacyInstagramRow(baseRow({ asset_format: "story_video", publish_settings: {} })).rendition.contentType, "STORIES");
});

test("reel_video maps to REELS", () => {
  const pub = fromLegacyInstagramRow(baseRow({ asset_format: "reel_video", publish_settings: {} }));
  assert.equal(pub.rendition.contentType, "REELS");
});

test("explicit publish_settings.content_type always wins over the asset_format inference", () => {
  const pub = fromLegacyInstagramRow(baseRow({ asset_format: "feed_post", publish_settings: { content_type: "STORIES" } }));
  assert.equal(pub.rendition.contentType, "STORIES");
});

test("an in-flight publish with a live Instagram container maps its processing state faithfully", () => {
  const pub = fromLegacyInstagramRow(baseRow({
    publish_status: "publishing", external_post_id: null, published_at: null, published_url: null,
    external_container_id: "18000000000", container_status: "IN_PROGRESS", container_poll_count: 3,
  }));
  assert.equal(pub.status, "publishing");
  assert.deepEqual(pub.processingState, { kind: "instagram_container", containerId: "18000000000", statusCode: "IN_PROGRESS", pollCount: 3 });
  assert.equal(hasPublicationEvidence(pub.receipt), false, "an in-flight container is not yet publication evidence");
});

test("a failed row preserves last_error and carries no publication evidence", () => {
  const pub = fromLegacyInstagramRow(baseRow({
    publish_status: "failed", external_post_id: null, published_at: null, published_url: null,
    last_error: "[meta_authentication, non-retryable] token expired",
  }));
  assert.equal(pub.status, "failed");
  assert.equal(pub.lastError, "[meta_authentication, non-retryable] token expired");
  assert.equal(hasPublicationEvidence(pub.receipt), false);
});

test("every real client_distribution_records_publish_status_check value round-trips through the contract's status type unchanged", () => {
  for (const status of PUBLICATION_STATUSES) {
    const pub = fromLegacyInstagramRow(baseRow({ publish_status: status }));
    assert.equal(pub.status, status);
  }
});

test("a row with no destination set maps to an empty destinationId rather than throwing", () => {
  const pub = fromLegacyInstagramRow(baseRow({ destination: null }));
  assert.equal(pub.destinationId, "");
});

test("client isolation: mapping never conflates or fabricates a client_id — it always flows through unchanged", () => {
  const clientA = fromLegacyInstagramRow(baseRow({ client_id: "aaaaaaaa-0000-0000-0000-000000000000" }));
  const clientB = fromLegacyInstagramRow(baseRow({ client_id: "bbbbbbbb-0000-0000-0000-000000000000" }));
  assert.equal(clientA.clientId, "aaaaaaaa-0000-0000-0000-000000000000");
  assert.equal(clientB.clientId, "bbbbbbbb-0000-0000-0000-000000000000");
  assert.notEqual(clientA.clientId, clientB.clientId);
});
