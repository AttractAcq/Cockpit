import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  FINAL_REEL_MAX_BYTES,
  finalReelPathBelongsToProject,
  finalReelStoragePath,
  REEL_MEDIA_SPEC,
  reelSpecWarnings,
  resolveReelPublicationEligibility,
  resolveReportedMediaMetadata,
  safeFinalReelFilename,
  shotClipPublicationBlocked,
  summariseShotPackage,
  validateFinalReelReplacement,
  validateFinalReelReview,
  validateFinalReelUpload,
} from "../supabase/functions/_shared/final-reel-contract.ts";
import { resolvePublishCapability, resolveRecordPublishCapability } from "../supabase/functions/_shared/publish-capability.ts";
import {
  advanceReelPublication,
  isReelContainerStatus,
  REEL_MAX_CONTAINER_POLLS,
  type ReelPublishDeps,
  type ReelPublishRecord,
} from "../supabase/functions/_shared/instagram-reels-publish.ts";

const root = new URL("../", import.meta.url);
async function file(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

const CLIENT = "11111111-1111-1111-1111-111111111111";
const PROJECT = "22222222-2222-2222-2222-222222222222";

function deliverable(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1", client_id: CLIENT, video_project_id: PROJECT,
    status: "approved" as const, is_current: true, mime_type: "video/mp4",
    storage_bucket: "video-assets", storage_path: `${CLIENT}/${PROJECT}/final/v1/final-reel.mp4`,
    superseded_at: null as string | null,
    ...overrides,
  };
}

const project = { id: PROJECT, client_id: CLIENT };

// ── Upload validation ──────────────────────────────────────────────────────

test("a valid MP4 upload request passes", () => {
  const result = validateFinalReelUpload({ filename: "Final Cut.mp4", mimeType: "video/mp4", fileSizeBytes: 12_000_000 });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.safeFilename, "Final-Cut.mp4");
});

test("wrong MIME type, wrong extension, empty and oversized files are rejected", () => {
  const wrongMime = validateFinalReelUpload({ filename: "a.mp4", mimeType: "video/quicktime", fileSizeBytes: 1000 });
  assert.equal(wrongMime.ok, false);
  if (!wrongMime.ok) assert.equal(wrongMime.code, "UNSUPPORTED_MIME");

  const wrongExt = validateFinalReelUpload({ filename: "a.mov", mimeType: "video/mp4", fileSizeBytes: 5_000_000 });
  assert.equal(wrongExt.ok, false);
  if (!wrongExt.ok) assert.equal(wrongExt.code, "UNSUPPORTED_EXTENSION");

  const empty = validateFinalReelUpload({ filename: "a.mp4", mimeType: "video/mp4", fileSizeBytes: 0 });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "EMPTY_FILE");

  const huge = validateFinalReelUpload({ filename: "a.mp4", mimeType: "video/mp4", fileSizeBytes: FINAL_REEL_MAX_BYTES + 1 });
  assert.equal(huge.ok, false);
  if (!huge.ok) assert.equal(huge.code, "FILE_TOO_LARGE");

  const image = validateFinalReelUpload({ filename: "a.png", mimeType: "image/png", fileSizeBytes: 5000 });
  assert.equal(image.ok, false);
});

test("filenames cannot escape the server-built path", () => {
  assert.equal(safeFinalReelFilename("../../etc/passwd.mp4"), "passwd.mp4");
  assert.equal(safeFinalReelFilename("a/b/../c.mp4"), "c.mp4");
  assert.equal(safeFinalReelFilename("....mp4"), "final-reel.mp4");
  assert.equal(safeFinalReelFilename(""), "final-reel.mp4");
  // Every result stays a single .mp4 path segment.
  for (const nasty of ["../x.mp4", "a\\b.mp4", "%2e%2e/x.mp4", "x;rm -rf.mp4"]) {
    const safe = safeFinalReelFilename(nasty);
    assert.equal(safe.includes("/"), false, nasty);
    assert.equal(safe.includes("\\"), false, nasty);
    assert.match(safe, /\.mp4$/, nasty);
  }
});

test("storage paths are server-built and client/project scoped", () => {
  const path = finalReelStoragePath({ clientId: CLIENT, videoProjectId: PROJECT, version: 3, safeFilename: "cut.mp4" });
  assert.equal(path, `${CLIENT}/${PROJECT}/final/v3/cut.mp4`);
  assert.equal(finalReelPathBelongsToProject(path, CLIENT, PROJECT), true);
  // Another client's namespace is rejected.
  assert.equal(finalReelPathBelongsToProject(path, "99999999-9999-9999-9999-999999999999", PROJECT), false);
  assert.equal(finalReelPathBelongsToProject(path, CLIENT, "88888888-8888-8888-8888-888888888888"), false);
});

test("media metadata is never fabricated", () => {
  const none = resolveReportedMediaMetadata(null);
  assert.deepEqual(none, { width: null, height: null, duration_sec: null, media_metadata_source: "unknown" });

  const partial = resolveReportedMediaMetadata({ width: 1080, height: 1920, durationSec: 28.4 });
  assert.equal(partial.media_metadata_source, "client_reported");
  assert.equal(partial.width, 1080);
  assert.equal(partial.duration_sec, 28.4);

  // Implausible values are discarded rather than stored.
  const bogus = resolveReportedMediaMetadata({ width: -5, height: 0, durationSec: 999_999 });
  assert.deepEqual(bogus, { width: null, height: null, duration_sec: null, media_metadata_source: "unknown" });
});

test("Instagram spec warnings are advisory and derived from the documented limits", () => {
  assert.equal(REEL_MEDIA_SPEC.minDurationSec, 3);
  assert.equal(REEL_MEDIA_SPEC.maxDurationSec, 900);
  const tooShort = reelSpecWarnings({ width: 1080, height: 1920, duration_sec: 1, file_size_bytes: 1000 });
  assert.ok(tooShort.some((warning) => /at least 3s/.test(warning)));
  const wide = reelSpecWarnings({ width: 3840, height: 2160, duration_sec: 30, file_size_bytes: 1000 });
  assert.ok(wide.some((warning) => /1920px/.test(warning)));
  // Unknown metadata produces no invented warnings.
  assert.deepEqual(reelSpecWarnings({ width: null, height: null, duration_sec: null, file_size_bytes: 1000 }), []);
});

// ── Versioning and replacement ─────────────────────────────────────────────

test("first upload has no predecessor; later uploads supersede the current version", () => {
  const first = validateFinalReelReplacement({ current: null, currentPublishStatus: null });
  assert.equal(first.ok, true);
  if (first.ok) assert.equal(first.supersedesVersion, null);

  const second = validateFinalReelReplacement({
    current: { id: "d1", status: "needs_review", version: 1 }, currentPublishStatus: null,
  });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.supersedesVersion, 1);
});

test("a publishing or published version can never be silently replaced", () => {
  for (const status of ["publishing", "published"]) {
    const result = validateFinalReelReplacement({
      current: { id: "d1", status: "approved", version: 2 }, currentPublishStatus: status,
      acknowledgedReplaceApproved: true,
    });
    assert.equal(result.ok, false, status);
    if (!result.ok) assert.equal(result.code, "CURRENT_VERSION_PUBLISHING", status);
  }
});

test("replacing an approved but unpublished version requires deliberate confirmation", () => {
  const unconfirmed = validateFinalReelReplacement({
    current: { id: "d1", status: "approved", version: 1 }, currentPublishStatus: null,
  });
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) assert.equal(unconfirmed.code, "REPLACE_APPROVED_UNCONFIRMED");

  const confirmed = validateFinalReelReplacement({
    current: { id: "d1", status: "approved", version: 1 }, currentPublishStatus: null,
    acknowledgedReplaceApproved: true,
  });
  assert.equal(confirmed.ok, true);
});

test("the database enforces one current version and one version number per project", async () => {
  const migration = await file("supabase/migrations/20260728000035_reel_studio_phase3_final_reel.sql");
  assert.match(migration, /create unique index if not exists video_project_deliverables_one_current_uidx[\s\S]*?where is_current/);
  assert.match(migration, /create unique index if not exists video_project_deliverables_version_uidx\s*\n\s*on public\.video_project_deliverables \(video_project_id, version\)/);
  // The completion RPC locks the project so two concurrent uploads cannot both win.
  const complete = migration.match(/create or replace function public\.complete_final_reel_upload[\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.ok(complete);
  assert.match(complete, /from public\.video_projects[\s\S]*?for update/);
  assert.match(complete, /REEL_CURRENT_VERSION_PUBLISHING/);
  // A reserved slot is never current and never reviewable.
  assert.match(migration, /video_project_deliverables_reserved_not_current/);
});

// ── Review ─────────────────────────────────────────────────────────────────

test("the current final Reel can be approved when its file exists", () => {
  const result = validateFinalReelReview({
    deliverable: deliverable({ status: "needs_review" }) as never,
    action: "approve", storageObjectPresent: true,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.nextStatus, "approved");
});

test("approval requires the storage object to still exist", () => {
  const result = validateFinalReelReview({
    deliverable: deliverable({ status: "needs_review" }) as never,
    action: "approve", storageObjectPresent: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "MISSING_OBJECT");
});

test("a non-current version cannot be reviewed or become publishable", () => {
  const superseded = validateFinalReelReview({
    deliverable: deliverable({ is_current: false, superseded_at: "2026-07-28T00:00:00Z" }) as never,
    action: "approve", storageObjectPresent: true,
  });
  assert.equal(superseded.ok, false);
  if (!superseded.ok) assert.equal(superseded.code, "NOT_CURRENT");
});

test("revision requires actionable feedback and preserves the version", () => {
  const empty = validateFinalReelReview({
    deliverable: deliverable() as never, action: "request_revision", feedback: "no", storageObjectPresent: true,
  });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "FEEDBACK_REQUIRED");

  const good = validateFinalReelReview({
    deliverable: deliverable() as never, action: "request_revision",
    feedback: "The hook is two seconds too slow.", storageObjectPresent: true,
  });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.value.nextStatus, "rejected");
});

test("review never deletes media and the RPC keeps history", async () => {
  const migration = await file("supabase/migrations/20260728000035_reel_studio_phase3_final_reel.sql");
  const review = migration.match(/create or replace function public\.review_final_reel_deliverable[\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.ok(review);
  assert.doesNotMatch(review, /delete from/i);
  assert.match(review, /REEL_DELIVERABLE_STALE/);       // optimistic concurrency
  assert.match(review, /REEL_DELIVERABLE_NOT_CURRENT/);
  assert.match(review, /REEL_ALREADY_PUBLISHED/);
  assert.match(review, /review_feedback = case when p_next_status = 'rejected'/);
});

// ── Publication eligibility ────────────────────────────────────────────────

test("an approved current final Reel is publishable", () => {
  const result = resolveReelPublicationEligibility({ deliverable: deliverable(), project, recordClientId: CLIENT });
  assert.equal(result.supported, true);
  assert.equal(result.code, "SUPPORTED");
});

test("every blocked case reports its specific reason", () => {
  const cases: Array<[string, ReturnType<typeof resolveReelPublicationEligibility>]> = [
    ["BLOCKED_NO_FINAL_REEL", resolveReelPublicationEligibility({ deliverable: null, project, recordClientId: CLIENT })],
    ["BLOCKED_FINAL_REEL_NOT_APPROVED", resolveReelPublicationEligibility({ deliverable: deliverable({ status: "needs_review" }), project, recordClientId: CLIENT })],
    ["BLOCKED_FINAL_REEL_NOT_APPROVED", resolveReelPublicationEligibility({ deliverable: deliverable({ status: "rejected" }), project, recordClientId: CLIENT })],
    ["BLOCKED_SUPERSEDED_VERSION", resolveReelPublicationEligibility({ deliverable: deliverable({ is_current: false }), project, recordClientId: CLIENT })],
    ["BLOCKED_UNSUPPORTED_MEDIA", resolveReelPublicationEligibility({ deliverable: deliverable({ mime_type: "video/quicktime" }), project, recordClientId: CLIENT })],
    ["BLOCKED_MISSING_STORAGE_OBJECT", resolveReelPublicationEligibility({ deliverable: deliverable(), project, recordClientId: CLIENT, storageObjectPresent: false })],
    ["BLOCKED_ACCOUNT_CONFIGURATION", resolveReelPublicationEligibility({ deliverable: deliverable(), project, recordClientId: CLIENT, destinationConfigured: false })],
    ["BLOCKED_PROJECT_RELATIONSHIP", resolveReelPublicationEligibility({ deliverable: deliverable(), project: { id: "other", client_id: CLIENT }, recordClientId: CLIENT })],
    ["BLOCKED_PROJECT_RELATIONSHIP", resolveReelPublicationEligibility({ deliverable: deliverable(), project, recordClientId: "9999" })],
  ];
  for (const [code, result] of cases) {
    assert.equal(result.supported, false, code);
    assert.equal(result.code, code);
    assert.ok(result.reason.length > 20, `${code} needs an operator-readable reason`);
  }
});

test("a shot clip is permanently unpublishable", () => {
  const result = shotClipPublicationBlocked();
  assert.equal(result.supported, false);
  assert.equal(result.code, "BLOCKED_SHOT_CLIP_NOT_PUBLISHABLE");
  assert.equal(result.permanent, true);
});

// ── Capability resolver integration ────────────────────────────────────────

test("REELS without a final-Reel context fails closed", () => {
  const result = resolvePublishCapability({
    platform: "instagram", assetFormat: "reel_video", contentType: "REELS", mediaMimeTypes: ["video/mp4"],
  });
  assert.equal(result.supported, false);
  assert.equal(result.code, "blocked_shot_clip_not_publishable");
});

test("REELS with an approved current final Reel is now supported", () => {
  const result = resolvePublishCapability({
    platform: "instagram", assetFormat: "reel_video", contentType: "REELS", mediaMimeTypes: ["video/mp4"],
    reelContext: { deliverable: deliverable(), project, recordClientId: CLIENT },
  });
  assert.equal(result.supported, true);
});

test("REELS with an unapproved or superseded final Reel stays blocked", () => {
  const unapproved = resolvePublishCapability({
    platform: "instagram", assetFormat: "reel_video", contentType: "REELS", mediaMimeTypes: ["video/mp4"],
    reelContext: { deliverable: deliverable({ status: "needs_review" }), project, recordClientId: CLIENT },
  });
  assert.equal(unapproved.supported, false);
  assert.equal(unapproved.code, "blocked_final_reel_not_approved");

  const superseded = resolvePublishCapability({
    platform: "instagram", assetFormat: "reel_video", contentType: "REELS", mediaMimeTypes: ["video/mp4"],
    reelContext: { deliverable: deliverable({ is_current: false }), project, recordClientId: CLIENT },
  });
  assert.equal(superseded.code, "blocked_superseded_version");
});

test("a stored Reel record resolves through the same wrapper", () => {
  const record = {
    platform: "instagram", asset_format: "reel_video",
    publish_settings: { content_type: "REELS" },
    publish_payload: { media: [{ mime_type: "video/mp4" }] },
  };
  assert.equal(resolveRecordPublishCapability(record).supported, false);
  assert.equal(resolveRecordPublishCapability(record, { deliverable: deliverable(), project, recordClientId: CLIENT }).supported, true);
});

test("Phase 2 image, carousel and Story publication is completely unchanged", () => {
  for (const [assetFormat, contentType] of [["feed_post", "IMAGE"], ["ad_static", "IMAGE"], ["carousel", "CAROUSEL"], ["story_sequence", "STORIES"]]) {
    const result = resolvePublishCapability({ platform: "instagram", assetFormat, contentType, mediaMimeTypes: ["image/png"] });
    assert.equal(result.supported, true, `${assetFormat}/${contentType}`);
  }
  // A video inside a non-Reel format is still refused.
  assert.equal(resolvePublishCapability({
    platform: "instagram", assetFormat: "story_sequence", contentType: "STORIES", mediaMimeTypes: ["video/mp4"],
  }).supported, false);
  // Non-Instagram platforms remain unsupported.
  assert.equal(resolvePublishCapability({
    platform: "tiktok", assetFormat: "feed_post", contentType: "IMAGE", mediaMimeTypes: ["image/png"],
  }).supported, false);
});

// ── Instagram Reels state machine (external calls fully mocked) ─────────────

function reelRecord(overrides: Partial<ReelPublishRecord> = {}): ReelPublishRecord {
  return {
    id: "r1", client_id: CLIENT, source_ref: "JUL26-RL-001", asset_format: "reel_video",
    publish_status: "publishing", external_container_id: null, container_status: null,
    container_created_at: null, container_poll_count: 0, external_post_id: null,
    published_at: null, published_url: null,
    publish_payload: { caption: "hello" }, publish_settings: { content_type: "REELS" },
    video_deliverable_id: "d1", ...overrides,
  };
}

interface Calls {
  containers: number; publishes: number; signs: number;
  persistedContainer: string | null; persistedPost: string | null;
  lastParams: Record<string, unknown> | null;
}

function mockDeps(overrides: Partial<ReelPublishDeps> = {}): { deps: ReelPublishDeps; calls: Calls } {
  const calls: Calls = { containers: 0, publishes: 0, signs: 0, persistedContainer: null, persistedPost: null, lastParams: null };
  const deps: ReelPublishDeps = {
    signMedia: async () => { calls.signs += 1; return "https://signed.example/video.mp4?token=REDACTED"; },
    createReelContainer: async (_ig, params) => { calls.containers += 1; calls.lastParams = params as unknown as Record<string, unknown>; return "container-1"; },
    fetchContainerStatus: async () => "FINISHED",
    mediaPublish: async () => { calls.publishes += 1; return "ig-media-1"; },
    fetchPermalink: async () => "https://instagram.com/reel/abc",
    persistContainerId: async (id) => { calls.persistedContainer = id; },
    persistExternalPostId: async (id) => { calls.persistedPost = id; },
    now: () => Date.parse("2026-07-28T12:00:00Z"),
    ...overrides,
  };
  return { deps, calls };
}

const stepInput = (record: ReelPublishRecord) => ({
  record, igUserId: "17841400000000000", token: "TEST-TOKEN",
  media: { storage_bucket: "video-assets", storage_path: `${CLIENT}/${PROJECT}/final/v1/final.mp4` },
});

test("container creation uses the verified Meta REELS contract and persists the id immediately", async () => {
  const { deps, calls } = mockDeps();
  const result = await advanceReelPublication(deps, stepInput(reelRecord()));
  assert.equal(result.kind, "container_created");
  assert.equal(calls.containers, 1);
  assert.equal(calls.persistedContainer, "container-1");
  // media_publish must NOT be called in the same step.
  assert.equal(calls.publishes, 0);
  assert.deepEqual(calls.lastParams, {
    videoUrl: "https://signed.example/video.mp4?token=REDACTED",
    caption: "hello", shareToFeed: true, thumbOffsetMs: null,
    // Programme Stage K: mediaType now flows through explicitly; REELS is the
    // default so every pre-existing call site (this one included) is unchanged.
    mediaType: "REELS",
  });
});

test("an existing container is never recreated", async () => {
  const { deps, calls } = mockDeps({ fetchContainerStatus: async () => "IN_PROGRESS" });
  const result = await advanceReelPublication(deps, stepInput(reelRecord({
    external_container_id: "container-1", container_status: "IN_PROGRESS",
    container_created_at: "2026-07-28T11:59:00Z",
  })));
  assert.equal(result.kind, "container_processing");
  assert.equal(calls.containers, 0);
  assert.equal(calls.publishes, 0);
  if (result.kind === "container_processing") assert.equal(result.pollCount, 1);
});

test("a FINISHED container publishes exactly once and persists the media id first", async () => {
  const { deps, calls } = mockDeps();
  const result = await advanceReelPublication(deps, stepInput(reelRecord({
    external_container_id: "container-1", container_status: "IN_PROGRESS",
    container_created_at: "2026-07-28T11:59:00Z",
  })));
  assert.equal(result.kind, "published");
  assert.equal(calls.publishes, 1);
  assert.equal(calls.persistedPost, "ig-media-1");
  if (result.kind === "published") {
    assert.equal(result.externalPostId, "ig-media-1");
    assert.equal(result.permalink, "https://instagram.com/reel/abc");
  }
});

test("a record that already has a media id is never republished", async () => {
  const { deps, calls } = mockDeps();
  const result = await advanceReelPublication(deps, stepInput(reelRecord({
    external_container_id: "container-1", external_post_id: "ig-media-1",
  })));
  assert.equal(result.kind, "already_published");
  assert.equal(calls.containers, 0);
  assert.equal(calls.publishes, 0);
});

test("timeout after container creation resumes without a duplicate container", async () => {
  // Run 1 creates the container, then the worker "dies" before releasing.
  const first = mockDeps();
  const created = await advanceReelPublication(first.deps, stepInput(reelRecord()));
  assert.equal(created.kind, "container_created");

  // Run 2 sees the persisted container and resumes polling — no second container.
  const second = mockDeps({ fetchContainerStatus: async () => "IN_PROGRESS" });
  const resumed = await advanceReelPublication(second.deps, stepInput(reelRecord({
    external_container_id: first.calls.persistedContainer, container_status: "IN_PROGRESS",
    container_created_at: "2026-07-28T11:59:00Z",
  })));
  assert.equal(resumed.kind, "container_processing");
  assert.equal(second.calls.containers, 0);
});

test("timeout after publication reconciles without a second post", async () => {
  const { deps, calls } = mockDeps();
  const result = await advanceReelPublication(deps, stepInput(reelRecord({
    external_container_id: "container-1", external_post_id: "ig-media-1",
    container_created_at: "2026-07-28T11:59:00Z",
  })));
  assert.equal(result.kind, "already_published");
  assert.equal(calls.publishes, 0);
});

test("ERROR and EXPIRED containers stop permanently", async () => {
  for (const status of ["ERROR", "EXPIRED"]) {
    const { deps } = mockDeps({ fetchContainerStatus: async () => status });
    const result = await advanceReelPublication(deps, stepInput(reelRecord({
      external_container_id: "container-1", container_created_at: "2026-07-28T11:59:00Z",
    })));
    assert.equal(result.kind, "permanent_failure", status);
  }
});

test("an expired container window and a poll ceiling both stop permanently", async () => {
  const { deps, calls } = mockDeps();
  const expired = await advanceReelPublication(deps, stepInput(reelRecord({
    external_container_id: "container-1",
    container_created_at: "2026-07-27T11:00:00Z", // > 24h before mocked now
  })));
  assert.equal(expired.kind, "permanent_failure");
  assert.equal(calls.publishes, 0);

  const exhausted = await advanceReelPublication(deps, stepInput(reelRecord({
    external_container_id: "container-1", container_created_at: "2026-07-28T11:59:00Z",
    container_poll_count: REEL_MAX_CONTAINER_POLLS,
  })));
  assert.equal(exhausted.kind, "permanent_failure");
});

test("a PUBLISHED container with no local media id demands reconciliation, never a republish", async () => {
  const { deps, calls } = mockDeps({ fetchContainerStatus: async () => "PUBLISHED" });
  const result = await advanceReelPublication(deps, stepInput(reelRecord({
    external_container_id: "container-1", container_created_at: "2026-07-28T11:59:00Z",
  })));
  assert.equal(result.kind, "transient_failure");
  assert.equal(calls.publishes, 0);
  if (result.kind === "transient_failure") {
    assert.equal(result.classification.retryable, false);
    assert.match(result.classification.message, /do not republish/i);
  }
});

test("a signed-URL failure is transient, not a permanent media defect", async () => {
  const { deps, calls } = mockDeps({ signMedia: async () => { throw new Error("storage unavailable"); } });
  const result = await advanceReelPublication(deps, stepInput(reelRecord()));
  assert.equal(result.kind, "transient_failure");
  assert.equal(calls.containers, 0);
  if (result.kind === "transient_failure") assert.equal(result.classification.retryable, true);
});

test("unknown container statuses are treated as transient, never as success", async () => {
  const { deps, calls } = mockDeps({ fetchContainerStatus: async () => "SOMETHING_NEW" });
  const result = await advanceReelPublication(deps, stepInput(reelRecord({
    external_container_id: "container-1", container_created_at: "2026-07-28T11:59:00Z",
  })));
  assert.equal(result.kind, "transient_failure");
  assert.equal(calls.publishes, 0);
  assert.equal(isReelContainerStatus("SOMETHING_NEW"), false);
  for (const status of ["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"]) {
    assert.equal(isReelContainerStatus(status), true, status);
  }
});

test("no disposition ever leaks the signed URL or the access token", async () => {
  const { deps } = mockDeps();
  const dispositions = [
    await advanceReelPublication(deps, stepInput(reelRecord())),
    await advanceReelPublication(deps, stepInput(reelRecord({ external_container_id: "container-1", container_created_at: "2026-07-28T11:59:00Z" }))),
  ];
  for (const disposition of dispositions) {
    const serialised = JSON.stringify(disposition);
    assert.equal(serialised.includes("TEST-TOKEN"), false);
    assert.equal(serialised.includes("signed.example"), false);
  }
});

// ── Worker behaviour ───────────────────────────────────────────────────────

test("the worker advances Reels one step per run and never holds the invocation open", async () => {
  const worker = await file("supabase/functions/process-scheduled-publishing/index.ts");
  assert.match(worker, /advanceReelPublication/);
  // Reels bypass the synchronous publisher entirely.
  assert.ok(worker.indexOf("if (isReel)") < worker.indexOf("publishDistributionRecord(sb, record.id"));
  // Polling releases the claim back to `scheduled` rather than parking in `publishing`.
  assert.match(worker, /publish_status: "scheduled"[\s\S]*?next_attempt_at: new Date\(Date\.now\(\) \+ REEL_POLL_INTERVAL_MS\)/);
  // A poll must not consume the publish-failure budget.
  assert.match(worker, /attempt_count: Math\.max\(attemptNumber - 1, 0\)/);
  // Permanent failures are never re-queued.
  assert.match(worker, /permanent_failure: true, claimed_at: null, claimed_by: null,\s*\n\s*next_attempt_at: null/);
});

test("the worker re-proves eligibility every step and resolves stranded records", async () => {
  const worker = await file("supabase/functions/process-scheduled-publishing/index.ts");
  assert.match(worker, /resolveReelPublicationEligibility/);
  assert.match(worker, /block_unsupported_scheduled_distribution/);
  // A record with no deliverable is a shot clip and stops permanently.
  assert.match(worker, /reel_blocked_no_deliverable/);
});

test("stale-publishing recovery does not mistake a processing container for a lost post", async () => {
  const migration = await file("supabase/migrations/20260728000035_reel_studio_phase3_final_reel.sql");
  const recover = migration.match(/create or replace function public\.recover_stale_publishing[\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.ok(recover);
  assert.match(recover, /container_status = 'IN_PROGRESS'/);
  assert.match(recover, /interval '24 hours'/);
  // The existing evidence-based recovery behaviour is preserved verbatim.
  assert.match(recover, /needs_reconciliation/);
  assert.match(recover, /has_evidence/);
});

test("the claim RPC skips ineligible records instead of aborting the batch", async () => {
  const migration = await file("supabase/migrations/20260728000035_reel_studio_phase3_final_reel.sql");
  const claim = migration.match(/create or replace function public\.claim_due_distribution_records[\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.ok(claim);
  assert.match(claim, /distribution_publication_supported\(c\.asset_format, c\.publish_settings, c\.publish_payload, c\.video_deliverable_id\) is null/);
  // Existing guarantees are untouched.
  assert.match(claim, /for update skip locked/);
  assert.match(claim, /permanent_failure = false/);
  assert.match(claim, /e\.sequence_index < c\.sequence_index/); // Story sequence gate
});

// ── Scheduling and draft gating ────────────────────────────────────────────

test("SQL capability allows an approved current final Reel and blocks everything else", async () => {
  const migration = await file("supabase/migrations/20260728000035_reel_studio_phase3_final_reel.sql");
  const fn = migration.match(/create or replace function public\.distribution_publication_supported\([\s\S]*?p_video_deliverable_id uuid[\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.ok(fn);
  assert.match(fn, /if p_video_deliverable_id is null then/);
  assert.match(fn, /shot clips cannot be published/i);
  assert.match(fn, /upload_state is distinct from 'uploaded'/);
  assert.match(fn, /not v_deliverable\.is_current or v_deliverable\.superseded_at is not null/);
  assert.match(fn, /status is distinct from 'approved'/);
  // Image/Story/carousel handling is preserved in the same function.
  assert.match(fn, /'IMAGE', 'CAROUSEL', 'STORIES'/);
  // The Phase 2 three-argument signature still exists and fails closed.
  assert.match(migration, /public\.distribution_publication_supported\(p_asset_format, p_publish_settings, p_publish_payload, null::uuid\)/);
});

test("draft creation is server-proved, idempotent and shot-clip proof", async () => {
  const migration = await file("supabase/migrations/20260728000035_reel_studio_phase3_final_reel.sql");
  const draft = migration.match(/create or replace function public\.create_reel_distribution_draft[\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.ok(draft);
  assert.match(draft, /REEL_DELIVERABLE_NOT_CURRENT/);
  assert.match(draft, /REEL_DELIVERABLE_NOT_APPROVED/);
  assert.match(draft, /REEL_DELIVERABLE_NOT_UPLOADED/);
  // One active publication per final version.
  assert.match(migration, /create unique index if not exists client_distribution_records_active_deliverable_uidx/);
  assert.match(draft, /publish_status in \('ready', 'scheduled', 'publishing', 'published', 'needs_reconciliation'\)/);

  const handler = await file("supabase/functions/create-reel-distribution-draft/index.ts");
  assert.match(handler, /resolveReelPublicationEligibility/);
  assert.match(handler, /BLOCKED_NO_FINAL_REEL/);
  assert.match(handler, /client_distribution_accounts/); // destination configuration check
});

test("Reels and Story video are scheduled, never published inline, and shot clips are refused outright", async () => {
  const publisher = await file("supabase/functions/_shared/instagram-publish.ts");
  // Programme Stage K generalised the Reels-only redirect to also cover Story
  // video (the same async-container mechanism, different Instagram surface) —
  // both must still be guarded, never published inline.
  assert.match(publisher, /\(isReelRecord \|\| isStoryVideoRecord\) && linkedDeliverableId/);
  assert.match(publisher, /isStoryVideoRecord = requestedContentType === "STORIES" && record\.asset_format === "story_video"/);
  assert.match(publisher, /published by the scheduled worker/);
  // The synchronous path must still never build a Reel container.
  assert.doesNotMatch(publisher, /media_type: "REELS"/);
});

// ── Upload / review Edge Function security ─────────────────────────────────

test("upload paths are server-built and never taken from the request", async () => {
  const create = await file("supabase/functions/create-final-reel-upload/index.ts");
  assert.match(create, /finalReelStoragePath/);
  assert.match(create, /p_storage_path_prefix: `\$\{clientId\}\/\$\{videoProjectId\}\/final\/`/);
  // The reserved path is compared against the server-built one before signing.
  assert.ok(create.indexOf("did not match the server-built path") > 0);
  assert.match(create, /createSignedUploadUrl/);
  // No bucket is ever taken from the caller.
  assert.doesNotMatch(create, /body\.(bucket|storage_bucket|storage_path)/);
});

test("completion verifies the object, its ownership and its real size", async () => {
  const complete = await file("supabase/functions/complete-final-reel-upload/index.ts");
  assert.match(complete, /finalReelPathBelongsToProject/);
  assert.match(complete, /not found in storage/);
  assert.match(complete, /verifiedSize/);
  assert.match(complete, /not video\/mp4/);
  // The completion RPC is the only thing that flips the current version.
  assert.match(complete, /complete_final_reel_upload/);
});

test("every Phase 3 Edge Function enforces auth, staff role and client ownership", async () => {
  for (const fn of [
    "create-final-reel-upload", "complete-final-reel-upload",
    "review-final-reel", "create-reel-distribution-draft",
  ]) {
    const source = await file(`supabase/functions/${fn}/index.ts`);
    assert.match(source, /sb\.auth\.getUser\(jwt\)/, fn);
    assert.match(source, /STAFF_ROLES\.has\(operator\.role\)/, fn);
    assert.match(source, /\.eq\("client_id", clientId\)/, fn);
    // No credential or signed URL is ever returned to the caller.
    assert.doesNotMatch(source, /access_token|META_SYSTEM_USER_TOKEN/, fn);
  }
});

// ── Shot package (external editing handoff) ────────────────────────────────

test("the shot package reports completeness honestly", () => {
  const complete = summariseShotPackage([
    { shot_number: 1, status: "complete", clip_url: "a.mp4", approved: true, is_current: true },
    { shot_number: 2, status: "complete", clip_url: "b.mp4", approved: false, is_current: true },
  ]);
  assert.equal(complete.allClipsPresent, true);
  assert.equal(complete.renderedClips, 2);
  assert.equal(complete.approvedClips, 1);
  assert.equal(complete.readyForExternalEdit, true);

  const partial = summariseShotPackage([
    { shot_number: 1, status: "complete", clip_url: "a.mp4", approved: true, is_current: true },
    { shot_number: 2, status: "failed", clip_url: null, approved: false, is_current: true },
  ]);
  assert.equal(partial.allClipsPresent, false);
  assert.deepEqual(partial.missingShotNumbers, [2]);
  assert.equal(partial.readyForExternalEdit, false);

  assert.equal(summariseShotPackage([]).allClipsPresent, false);
});

// ── Boundary and regression guarantees ─────────────────────────────────────

test("no in-browser editor, compositing or assembly was introduced", async () => {
  const sources = await Promise.all([
    file("src/components/client/ReelStudioPanel.tsx"),
    file("supabase/functions/_shared/final-reel-contract.ts"),
    file("supabase/functions/_shared/instagram-reels-publish.ts"),
    file("supabase/migrations/20260728000035_reel_studio_phase3_final_reel.sql"),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /ffmpeg|MediaRecorder|createMediaStream|canvas\.captureStream|concat.*clips/i);
  }
  // The boundary is stated in the UI.
  assert.match(sources[0], /external editor/i);
  assert.match(sources[0], /Cockpit does not assemble or edit video/i);
});

test("no additional publishing platform was added", async () => {
  const capability = await file("supabase/functions/_shared/publish-capability.ts");
  const reels = await file("supabase/functions/_shared/instagram-reels-publish.ts");
  assert.match(capability, /SUPPORTED_PUBLISH_PLATFORMS = \["instagram"\]/);
  assert.doesNotMatch(reels, /tiktok|youtube|shorts/i);
});

test("the Phase 3 migration is additive and preserves history", async () => {
  const migration = await file("supabase/migrations/20260728000035_reel_studio_phase3_final_reel.sql");
  assert.doesNotMatch(migration, /drop table|drop column|truncate |delete from public\./i);
  assert.match(migration, /create table if not exists public\.video_project_deliverables/);
  assert.match(migration, /add column if not exists current_deliverable_id/);
  assert.match(migration, /add column if not exists external_container_id/);
  // RLS: staff read-only; every write goes through a service-role RPC.
  assert.match(migration, /alter table public\.video_project_deliverables enable row level security/);
  assert.match(migration, /for select to authenticated/);
  assert.match(migration, /grant execute on function public\.reserve_final_reel_upload[\s\S]*?to service_role/);
});

test("Phase 1 and Phase 2 contracts are untouched by Phase 3", async () => {
  const contract = await file("supabase/functions/_shared/reel-studio-contract.ts");
  const recovery = await file("supabase/functions/_shared/reel-studio-recovery.ts");
  const eligibility = await file("supabase/functions/_shared/reel-studio-eligibility.ts");
  assert.match(contract, /validateBoundReelBrief/);
  assert.match(contract, /selectUnambiguousLegacyReelBrief/);
  assert.match(recovery, /reelShotRecoveryPlan/);
  assert.match(eligibility, /resolveReelSourceEligibility/);
  // Phase 3 must not have relaxed the Ads exclusion or the production-mode gate.
  assert.match(eligibility, /source_table_unsupported/);
  assert.match(eligibility, /brief_mode_human/);
});
