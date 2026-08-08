import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  missingBriefSections,
  PRODUCTION_BRIEF_CONTRACTS,
  requiredBriefSections,
  resolveAssetFormat,
} from "../supabase/functions/_shared/production-brief-contract.ts";
import {
  allowsReelStudio,
  briefTextIsHumanOnly,
  isProductionMode,
  PRODUCTION_MODES,
  resolveBriefProductionMode,
  validateProductionModeTransition,
} from "../supabase/functions/_shared/production-mode-contract.ts";
import {
  resolveReelProjectEligibility,
  resolveReelSourceEligibility,
} from "../supabase/functions/_shared/reel-studio-eligibility.ts";
import {
  classifyReelShotFailure,
  reelShotRecoveryPlan,
} from "../supabase/functions/_shared/reel-studio-recovery.ts";
import { resolvePublishCapability, resolveRecordPublishCapability } from "../supabase/functions/_shared/publish-capability.ts";

const root = new URL("../", import.meta.url);
async function file(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

const reelRow = { content_type: "RL" };
const staticAdRow = { content_type: "Static" };

function aiReelBrief(overrides: Record<string, unknown> = {}) {
  return {
    id: "brief-ai",
    asset_format: "reel_video",
    production_mode: "ai",
    production_status: "brief",
    status: "approved",
    content_md: "## Shot List\nsomething",
    metadata: { human_only: false },
    ...overrides,
  };
}

// ── Production-mode contract ────────────────────────────────────────────────

test("production modes are human, ai and hybrid", () => {
  assert.deepEqual([...PRODUCTION_MODES], ["human", "ai", "hybrid"]);
  assert.equal(isProductionMode("hybrid"), true);
  assert.equal(isProductionMode("robot"), false);
});

test("an AI Reel brief requires AI sections and must NOT require human-only instructions", () => {
  const aiSections = requiredBriefSections("reel_video", "ai");
  assert.equal(aiSections.includes("Human Production Only"), false);
  assert.equal(aiSections.includes("AI Visual Constraints"), true);
  assert.equal(aiSections.includes("Human Presence Constraints"), true);

  const humanSections = requiredBriefSections("reel_video", "human");
  assert.equal(humanSections.includes("Human Production Only"), true);
  assert.equal(humanSections.includes("AI Visual Constraints"), false);

  const hybridSections = requiredBriefSections("reel_video", "hybrid");
  assert.equal(hybridSections.includes("Hybrid Production Split"), true);
  assert.equal(hybridSections.includes("Human Production Only"), false);
});

test("reel_video is no longer declared human-only and routes AI to Reel Studio", () => {
  const contract = PRODUCTION_BRIEF_CONTRACTS.reel_video;
  assert.equal(contract.humanOnly, false);
  assert.equal(contract.aiPath, "reel_studio");
  assert.deepEqual([...contract.supportedModes], ["human", "ai", "hybrid"]);
  // Image formats keep the old AI pipeline — Phase 2 does not relax that gate.
  assert.equal(PRODUCTION_BRIEF_CONTRACTS.carousel.aiPath, "ai_image_pipeline");
});

test("section validation is mode-aware", () => {
  const aiMarkdown = requiredBriefSections("reel_video", "ai").map((section) => `## ${section}`).join("\n\ncontent\n\n");
  assert.deepEqual(missingBriefSections(aiMarkdown, "reel_video", "ai"), []);
  // The same AI markdown is INCOMPLETE against the human contract, proving the
  // two shapes are genuinely different and not silently interchangeable.
  assert.ok(missingBriefSections(aiMarkdown, "reel_video", "human").includes("Human Production Only"));
});

test("a brief whose text still reads human-only is contradictory under an AI mode", () => {
  const contradictory = aiReelBrief({ content_md: "## Shot List\nx\n## Human Production Only\nno AI" });
  assert.equal(briefTextIsHumanOnly(contradictory), true);
  const resolution = resolveBriefProductionMode(contradictory);
  assert.equal(resolution.mode, "ai");
  assert.equal(resolution.contradictory, true);
  assert.equal(resolution.requiresConfirmation, true);

  // metadata.human_only is equally authoritative.
  const metaContradiction = aiReelBrief({ metadata: { human_only: true } });
  assert.equal(resolveBriefProductionMode(metaContradiction).contradictory, true);
});

test("a clean AI brief resolves without confirmation and permits Reel Studio", () => {
  const resolution = resolveBriefProductionMode(aiReelBrief());
  assert.equal(resolution.contradictory, false);
  assert.equal(resolution.requiresConfirmation, false);
  assert.equal(allowsReelStudio(resolution.mode), true);
  assert.equal(allowsReelStudio("hybrid"), true);
  assert.equal(allowsReelStudio("human"), false);
  assert.equal(allowsReelStudio(null), false);
});

test("an unassigned or unrecognised mode requires explicit confirmation", () => {
  assert.equal(resolveBriefProductionMode(aiReelBrief({ production_mode: null })).requiresConfirmation, true);
  const unknown = resolveBriefProductionMode(aiReelBrief({ production_mode: "legacy_thing" }));
  assert.equal(unknown.unrecognised, true);
  assert.equal(unknown.mode, null);
});

test("mode transitions persist only when deliberate and never overwrite approved authority silently", () => {
  const supported = PRODUCTION_BRIEF_CONTRACTS.reel_video.supportedModes;
  const approvedHuman = aiReelBrief({ production_mode: "human", status: "approved", content_md: "## Human Production Only\nx" });

  // Changing an approved brief without acknowledgement is refused.
  const unconfirmed = validateProductionModeTransition({ brief: approvedHuman, targetMode: "ai", supportedModes: supported });
  assert.equal(unconfirmed.ok, false);
  if (!unconfirmed.ok) assert.equal(unconfirmed.code, "MODE_APPROVED_CHANGE_UNCONFIRMED");

  // Acknowledging the approved change still trips the separate text conflict.
  const textBlocked = validateProductionModeTransition({
    brief: approvedHuman, targetMode: "ai", supportedModes: supported, acknowledgedApprovedChange: true,
  });
  assert.equal(textBlocked.ok, false);
  if (!textBlocked.ok) assert.equal(textBlocked.code, "MODE_TEXT_CONFLICT_UNCONFIRMED");

  // Both acknowledgements → the transition is allowed and flagged as conflicting.
  const allowed = validateProductionModeTransition({
    brief: approvedHuman, targetMode: "ai", supportedModes: supported,
    acknowledgedApprovedChange: true, acknowledgedTextConflict: true,
  });
  assert.equal(allowed.ok, true);
  if (allowed.ok) { assert.equal(allowed.textConflict, true); assert.equal(allowed.unchanged, false); }

  // Hybrid is handled by the same path.
  const hybrid = validateProductionModeTransition({
    brief: aiReelBrief({ production_mode: null, status: "needs_review", content_md: "## Shot List\nx" }),
    targetMode: "hybrid", supportedModes: supported,
  });
  assert.equal(hybrid.ok, true);

  // A produced brief is locked.
  const locked = validateProductionModeTransition({
    brief: aiReelBrief({ production_status: "produced" }), targetMode: "human", supportedModes: supported,
  });
  assert.equal(locked.ok, false);
  if (!locked.ok) assert.equal(locked.code, "MODE_LOCKED_BY_PRODUCTION");

  // Re-selecting the same mode is a no-op, not an error.
  const same = validateProductionModeTransition({ brief: aiReelBrief(), targetMode: "ai", supportedModes: supported });
  assert.equal(same.ok, true);
  if (same.ok) assert.equal(same.unchanged, true);
});

// ── Source eligibility ─────────────────────────────────────────────────────

test("an eligible Organic Reel with an approved AI brief passes", () => {
  const result = resolveReelSourceEligibility({ sourceTable: "organic_master", sourceRow: reelRow, brief: aiReelBrief() });
  assert.equal(result.eligible, true);
  assert.equal(result.resolvedMode, "ai");
});

test("Ads sources are permanently ineligible — the action must be hidden, not offered", () => {
  const result = resolveReelSourceEligibility({ sourceTable: "ads_master", sourceRow: staticAdRow, brief: null });
  assert.equal(result.eligible, false);
  assert.equal(result.permanent, true);
  assert.equal(result.code, "source_table_unsupported");
  // The repository maps every ads_master row to ad_static, which is exactly why
  // an Ads row can never own the reel_video brief Reel Studio requires.
  assert.equal(resolveAssetFormat("ads_master", staticAdRow), "ad_static");
  assert.equal(result.requiredAssetFormat, "reel_video");
});

test("a non-Reel Organic row is permanently ineligible", () => {
  const result = resolveReelSourceEligibility({ sourceTable: "organic_master", sourceRow: { content_type: "CR" }, brief: null });
  assert.equal(result.eligible, false);
  assert.equal(result.permanent, true);
  assert.equal(result.code, "source_content_type_unsupported");
});

test("resolvable brief-state reasons are reported as non-permanent", () => {
  const missing = resolveReelSourceEligibility({ sourceTable: "organic_master", sourceRow: reelRow, brief: null });
  assert.equal(missing.eligible, false);
  assert.equal(missing.permanent, false);
  assert.equal(missing.code, "brief_missing");

  const unapproved = resolveReelSourceEligibility({ sourceTable: "organic_master", sourceRow: reelRow, brief: aiReelBrief({ status: "needs_review" }) });
  assert.equal(unapproved.code, "brief_not_approved");

  const ambiguous = resolveReelSourceEligibility({ sourceTable: "organic_master", sourceRow: reelRow, brief: aiReelBrief(), briefCandidateCount: 2 });
  assert.equal(ambiguous.code, "brief_ambiguous");
});

test("a human-only brief cannot enter Reel Studio without an explicit mode change", () => {
  const human = resolveReelSourceEligibility({
    sourceTable: "organic_master", sourceRow: reelRow,
    brief: aiReelBrief({ production_mode: "human", metadata: { human_only: true } }),
  });
  assert.equal(human.eligible, false);
  assert.equal(human.code, "brief_mode_human");
  assert.equal(human.permanent, false);

  const unset = resolveReelSourceEligibility({
    sourceTable: "organic_master", sourceRow: reelRow, brief: aiReelBrief({ production_mode: null }),
  });
  assert.equal(unset.code, "brief_mode_unset");

  const contradictory = resolveReelSourceEligibility({
    sourceTable: "organic_master", sourceRow: reelRow,
    brief: aiReelBrief({ content_md: "## Human Production Only\nno AI" }),
  });
  assert.equal(contradictory.code, "brief_mode_contradictory");
});

test("a standalone project is reported as brief-less rather than crashing", () => {
  const result = resolveReelProjectEligibility({ organicMasterId: null, adsMasterId: null, sourceRow: null, brief: null });
  assert.equal(result.eligible, false);
  assert.match(result.reason, /standalone/i);
});

test("one resolver produces the same decision for the project and source entry points", () => {
  const viaSource = resolveReelSourceEligibility({ sourceTable: "organic_master", sourceRow: reelRow, brief: aiReelBrief() });
  const viaProject = resolveReelProjectEligibility({ organicMasterId: "row-1", adsMasterId: null, sourceRow: reelRow, brief: aiReelBrief() });
  assert.deepEqual(viaProject, viaSource);
});

// ── Still / video recovery ─────────────────────────────────────────────────

const baseShot = {
  status: "failed",
  failure_stage: null as string | null,
  still_image_url: null as string | null,
  still_image_job_id: null as string | null,
  higgsfield_job_id: null as string | null,
  clip_url: null as string | null,
};

test("failure classification distinguishes the still and video phases", () => {
  assert.equal(classifyReelShotFailure({ ...baseShot, failure_stage: "still_submit" }).phase, "still");
  assert.equal(classifyReelShotFailure({ ...baseShot, failure_stage: "still_render" }).phase, "still");
  assert.equal(classifyReelShotFailure({ ...baseShot, failure_stage: "still_download" }).phase, "still");
  assert.equal(classifyReelShotFailure({ ...baseShot, failure_stage: "video_submit" }).phase, "video");
  assert.equal(classifyReelShotFailure({ ...baseShot, failure_stage: "video_render" }).phase, "video");
  assert.equal(classifyReelShotFailure({ ...baseShot, failure_stage: "video_download" }).phase, "video");
  assert.equal(classifyReelShotFailure({ ...baseShot, status: "complete" }).failed, false);
});

test("pre-Phase-2 failures with no recorded stage are derived from job/media state", () => {
  const stillEra = classifyReelShotFailure({ ...baseShot });
  assert.equal(stillEra.phase, "still");
  assert.equal(stillEra.derived, true);

  const videoEra = classifyReelShotFailure({ ...baseShot, still_image_url: "c/p/s-still.jpg" });
  assert.equal(videoEra.phase, "video");
  assert.equal(videoEra.derived, true);

  const videoJobEra = classifyReelShotFailure({ ...baseShot, higgsfield_job_id: "job-1" });
  assert.equal(videoJobEra.phase, "video");
});

test("a failed still submission and a failed still render are both retryable", () => {
  for (const stage of ["still_submit", "still_render", "still_download"]) {
    const plan = reelShotRecoveryPlan({ ...baseShot, failure_stage: stage }, true);
    assert.equal(plan.canRetryStill, true, stage);
    assert.equal(plan.canRetryVideo, false, stage);
    assert.match(plan.retryPreserves ?? "", /planning text/);
  }
});

test("an active job is CHECKED, never retried — so no duplicate job is created", () => {
  for (const status of ["still_submitted", "still_rendering"]) {
    const plan = reelShotRecoveryPlan({ ...baseShot, status }, true);
    assert.equal(plan.canCheckStill, true, status);
    assert.equal(plan.canRetryStill, false, status);
    assert.equal(plan.canRetryVideo, false, status);
  }
  for (const status of ["submitted", "rendering"]) {
    const plan = reelShotRecoveryPlan({ ...baseShot, status, still_image_url: "s.jpg" }, true);
    assert.equal(plan.canCheckVideo, true, status);
    assert.equal(plan.canRetryVideo, false, status);
  }
});

test("an existing successful still prevents a still reset", () => {
  const plan = reelShotRecoveryPlan({ ...baseShot, failure_stage: "still_download", still_image_url: "c/p/s-still.jpg" }, true);
  assert.equal(plan.canRetryStill, false);
  assert.match(plan.blockedReason ?? "", /already stored/i);
});

test("video state prevents an unsafe still reset", () => {
  const plan = reelShotRecoveryPlan({ ...baseShot, failure_stage: "video_render", higgsfield_job_id: "job-1", still_image_url: "s.jpg" }, true);
  assert.equal(plan.canRetryStill, false);
  assert.equal(plan.canRetryVideo, true);
});

test("a failed video is retryable and explicitly preserves the still and motion", () => {
  const plan = reelShotRecoveryPlan({ ...baseShot, failure_stage: "video_render", still_image_url: "s.jpg", higgsfield_job_id: "job-1" }, true);
  assert.equal(plan.canRetryVideo, true);
  assert.equal(plan.canRetryStill, false);
  assert.match(plan.retryPreserves ?? "", /still image/i);
  assert.match(plan.retryPreserves ?? "", /motion/i);
});

test("a still-phase failure cannot use the video retry", () => {
  const plan = reelShotRecoveryPlan({ ...baseShot, failure_stage: "still_render" }, true);
  assert.equal(plan.canRetryVideo, false);
});

test("a video failure with no stored still is redirected to the image retry", () => {
  const plan = reelShotRecoveryPlan({ ...baseShot, failure_stage: "video_submit" }, true);
  assert.equal(plan.canRetryVideo, false);
  assert.match(plan.blockedReason ?? "", /no stored still/i);
});

test("an existing clip prevents any retry", () => {
  const plan = reelShotRecoveryPlan({ ...baseShot, failure_stage: "video_download", still_image_url: "s.jpg", clip_url: "c.mp4" }, true);
  assert.equal(plan.canRetryStill, false);
  assert.equal(plan.canRetryVideo, false);
  assert.match(plan.blockedReason ?? "", /already has a rendered clip/i);
});

test("a project that has left generation disables provider retries", () => {
  const plan = reelShotRecoveryPlan({ ...baseShot, failure_stage: "still_render" }, false);
  assert.equal(plan.canRetryStill, false);
  assert.match(plan.blockedReason ?? "", /no longer in a generating state/i);
});

test("recovery RPCs are concurrency-safe and stage-specific in SQL", async () => {
  const migration = await file("supabase/migrations/20260727000034_reel_studio_phase2_recovery_modes_capability.sql");
  for (const fn of ["reset_failed_reel_shot_still", "reset_failed_reel_shot_video"]) {
    const body = migration.match(new RegExp(`create or replace function public\\.${fn}[\\s\\S]*?\\n\\$\\$;`))?.[0] ?? "";
    assert.ok(body, `${fn} missing`);
    // FOR UPDATE + expected updated_at + a conditional UPDATE: two simultaneous
    // retries can never both reset the same shot, so no duplicate provider job.
    assert.match(body, /for update/, fn);
    assert.match(body, /REEL_SHOT_STALE/, fn);
    assert.match(body, /updated_at = p_expected_updated_at/, fn);
    assert.match(body, /REEL_FAILURE_PHASE_MISMATCH/, fn);
  }
  // The still reset must never touch a clip; the video reset must never clear the still.
  const stillBody = migration.match(/create or replace function public\.reset_failed_reel_shot_still[\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.match(stillBody, /REEL_VIDEO_STATE_PRESENT/);
  assert.equal(/still_image_url = null/.test(stillBody), false);
  const videoBody = migration.match(/create or replace function public\.reset_failed_reel_shot_video[\s\S]*?\n\$\$;/)?.[0] ?? "";
  assert.equal(/still_image_url = null/.test(videoBody), false);
  assert.match(videoBody, /coalesce\(nullif\(btrim\(coalesce\(p_motion_type/); // motion preserved unless changed
});

test("retry uses the latest persisted prompt and never rewrites planning fields", async () => {
  const retryStill = await file("supabase/functions/retry-shot-still-image/index.ts");
  const migration = await file("supabase/migrations/20260727000034_reel_studio_phase2_recovery_modes_capability.sql");
  const stillBody = migration.match(/create or replace function public\.reset_failed_reel_shot_still[\s\S]*?\n\$\$;/)?.[0] ?? "";
  // The reset touches job/status fields only; the submit path then reads whatever
  // compiled_prompt is currently persisted (Phase 1 behaviour, unchanged).
  assert.equal(/compiled_prompt =/.test(stillBody), false);
  assert.equal(/beat_description =/.test(stillBody), false);
  assert.match(retryStill, /reset_failed_reel_shot_still/);
  assert.match(retryStill, /expected_updated_at/);
  // Reset-only: the retry function must not call the provider itself.
  assert.doesNotMatch(retryStill, /submitHiggsfield|higgsfield\.ts/);
});

test("provider functions record which phase failed", async () => {
  const pairs: Array<[string, string]> = [
    ["supabase/functions/submit-shot-still-image/index.ts", "still_submit"],
    ["supabase/functions/check-shot-still-image/index.ts", "still_render"],
    ["supabase/functions/submit-shot-generation/index.ts", "video_submit"],
    ["supabase/functions/check-shot-generation/index.ts", "video_render"],
  ];
  for (const [path, stage] of pairs) {
    assert.match(await file(path), new RegExp(`failure_stage: "${stage}"`), path);
  }
  assert.match(await file("supabase/functions/check-shot-still-image/index.ts"), /failure_stage: "still_download"/);
  assert.match(await file("supabase/functions/check-shot-generation/index.ts"), /failure_stage: "video_download"/);
});

test("provider retry stays distinct from Phase 1 planning regeneration", async () => {
  const regenerate = await file("supabase/functions/regenerate-video-shot/index.ts");
  const retryStill = await file("supabase/functions/retry-shot-still-image/index.ts");
  const retryVideo = await file("supabase/functions/retry-shot-video/index.ts");
  // Regeneration rewrites planning text; neither retry may.
  assert.match(regenerate, /regenerate_pending_reel_shot/);
  assert.doesNotMatch(retryStill, /regenerate_pending_reel_shot|regeneratedPlanningPatch/);
  assert.doesNotMatch(retryVideo, /regenerate_pending_reel_shot|regeneratedPlanningPatch/);
});

// ── Video-native assets ────────────────────────────────────────────────────

test("MP4 assets classify as video from their MIME type, never from asset_format", async () => {
  const media = await file("src/lib/assetMedia.ts");
  assert.match(media, /mime_type/);
  // The classifier must not branch on the logical content category.
  assert.doesNotMatch(media.match(/export function assetMediaKind[\s\S]*?\n}/)?.[0] ?? "", /asset_format/);
  assert.match(media, /export function isVideoAsset/);
  assert.match(media, /export function isImageAsset/);
  assert.match(media, /export function isUnsupportedAsset/);
});

test("Assets renders a video player for MP4 and an img only for images", async () => {
  const panel = await file("src/components/client/AssetsPanel.tsx");
  assert.match(panel, /function AssetVideoPlayer/);
  assert.match(panel, /<video/);
  assert.match(panel, /controls/);
  assert.match(panel, /isVideoAsset\(asset\)\s*\n?\s*\?\s*<AssetVideoPlayer/);
  // No forced autoplay-with-sound anywhere.
  assert.doesNotMatch(panel, /autoPlay/);
  // Vertical presentation comes from the asset, not a 4:5 image assumption.
  assert.match(panel, /assetRatio\(asset\)/);
  assert.doesNotMatch(panel, /aspectClass\(/);
});

test("MP4 download preserves the original file and never offers PNG conversion", async () => {
  const exporter = await file("src/lib/assetExport.ts");
  assert.match(exporter, /export async function downloadAssetOriginal/);
  // Canvas conversion must be reachable only from the image path.
  const rawPath = exporter.match(/async function assetRawBlob[\s\S]*?\n}/)?.[0] ?? "";
  assert.doesNotMatch(rawPath, /convertToPng/);
  const exportBlob = exporter.match(/async function assetExportBlob[\s\S]*?\n}/)?.[0] ?? "";
  assert.match(exportBlob, /assetMediaKind\(asset\) === "image" \? assetPngBlob\(asset\) : assetRawBlob\(asset\)/);
  // Image behaviour is unchanged.
  assert.match(exporter, /export async function downloadAssetPng/);
  assert.match(exporter, /export function assetPngFilename/);
  assert.match(exporter, /convertToPng\(blob, label\)/);
});

test("video groups keep review, ordering and group metadata, and say 'shot clip'", async () => {
  const panel = await file("src/components/client/AssetsPanel.tsx");
  assert.match(panel, /Approve Shot Clips/);
  assert.match(panel, /Reject Shot Clips/);
  assert.match(panel, /Shot \$\{asset\.sequence_index\}/);
  assert.match(panel, /expectedClipCount/);
  assert.match(panel, /videoProjectTitle/);
  // Approval must not imply that a finished Reel exists.
  assert.match(panel, /approving them does not mean a finished Reel exists/);
  const handoff = await file("supabase/functions/handoff-video-project/index.ts");
  assert.match(handoff, /sequence_index: shot\.shot_number/);
  assert.match(handoff, /sequence_count: shots\.data\.length/);
});

// ── Distribution gating ────────────────────────────────────────────────────

test("Reels, reel_video and video media are unsupported without a final Reel", () => {
  // Phase 3 made Reels conditionally publishable — but ONLY from an approved,
  // current final-Reel deliverable. The Phase 2 guarantee that survives, and that
  // this test pins, is that a Reel-shaped publication with no final Reel behind it
  // (i.e. shot clips) is still permanently refused, and that the resolver fails
  // CLOSED when no context is supplied.
  const byContentType = resolvePublishCapability({ platform: "instagram", assetFormat: "feed_post", contentType: "REELS", mediaMimeTypes: ["image/png"] });
  assert.equal(byContentType.supported, false);
  assert.equal(byContentType.permanent, true);

  const byFormat = resolvePublishCapability({ platform: "instagram", assetFormat: "reel_video", contentType: "IMAGE", mediaMimeTypes: ["image/png"] });
  assert.equal(byFormat.supported, false);
  assert.equal(byFormat.permanent, true);
  assert.equal(byFormat.code, "blocked_shot_clip_not_publishable");
  assert.match(byFormat.reason, /shot clips cannot be published/i);

  // Video inside a NON-Reel format remains unconditionally unsupported.
  const byMedia = resolvePublishCapability({ platform: "instagram", assetFormat: "story_sequence", contentType: "STORIES", mediaMimeTypes: ["video/mp4"] });
  assert.equal(byMedia.supported, false);
  assert.equal(byMedia.code, "unsupported_media_type");
});

test("supported image, carousel and Story publication is unchanged", () => {
  for (const [assetFormat, contentType] of [["feed_post", "IMAGE"], ["ad_static", "IMAGE"], ["carousel", "CAROUSEL"], ["story_sequence", "STORIES"]]) {
    const result = resolvePublishCapability({ platform: "instagram", assetFormat, contentType, mediaMimeTypes: ["image/png"] });
    assert.equal(result.supported, true, `${assetFormat}/${contentType}`);
  }
});

test("a stored Reel Studio distribution record resolves as unsupported", () => {
  const capability = resolveRecordPublishCapability({
    platform: "instagram", asset_format: "reel_video",
    publish_settings: { content_type: "REELS" },
    publish_payload: { media: [{ mime_type: "video/mp4" }] },
  });
  assert.equal(capability.supported, false);
  assert.equal(capability.permanent, true);
});

test("the UI blocks unsupported scheduling and publishing", async () => {
  const panel = await file("src/components/client/DistributionPanel.tsx");
  assert.match(panel, /resolveRecordPublishCapability/);
  // Both entry points and both actions are gated.
  assert.match(panel, /const unsupported = !capability\.supported/);
  assert.match(panel, /if \(unsupported\) \{ setNotice\(\{ error: true, message: capability\.reason \}\); return; \}/);
  assert.match(panel, /disabled=\{unsupported \|\| invalidStory\}/);
  assert.match(panel, /Blocked — publishing not available/);
  // Existing records stay readable rather than being hidden or deleted.
  assert.match(panel, /This record and its attempt history are kept/);
});

test("the server enforces the same restriction even if the frontend is bypassed", async () => {
  const publisher = await file("supabase/functions/_shared/instagram-publish.ts");
  const worker = await file("supabase/functions/process-scheduled-publishing/index.ts");
  const migration = await file("supabase/migrations/20260727000034_reel_studio_phase2_recovery_modes_capability.sql");

  // Manual publish: checked BEFORE credentials and before any Meta call.
  assert.match(publisher, /resolveRecordPublishCapability/);
  assert.ok(publisher.indexOf("resolveRecordPublishCapability({") < publisher.indexOf("resolveMetaConfig(sb, clientSlug, working)"));
  assert.match(publisher, /permanent_failure: true/);

  // Worker: marked permanently failed, so it is never retried in a loop.
  assert.match(worker, /resolvePublishCapability/);
  assert.match(worker, /permanent_failure: true, claimed_at: null, claimed_by: null, next_attempt_at: null/);
  assert.doesNotMatch(worker, /const SUPPORTED_FORMATS/);

  // Database: a trigger REFUSES the transition into an active publishing state,
  // so an unsupported record can never become claimable by the worker.
  assert.match(migration, /create trigger enforce_distribution_publish_capability/);
  assert.match(migration, /distribution_publication_supported/);
  assert.match(migration, /new\.publish_status not in \('scheduled', 'publishing'\)/);
  assert.match(migration, /raise exception 'UNSUPPORTED_PUBLICATION/);
  // Historical records are never deleted or rewritten by the gate.
  assert.doesNotMatch(migration, /delete from public\.client_distribution_records/);
});

test("approving a Reel Studio group does not manufacture an unschedulable draft", async () => {
  const api = await file("src/lib/api.ts");
  assert.match(api, /UNSUPPORTED_DISTRIBUTION:/);
  const panel = await file("src/components/client/AssetsPanel.tsx");
  assert.match(panel, /Not queued for distribution/);
});

// ── Phase-1 preservation + migration hygiene ───────────────────────────────

test("Phase 1 binding, storyboard and lifecycle protections are still in force", async () => {
  const contract = await file("supabase/functions/_shared/reel-studio-contract.ts");
  const project = await file("supabase/functions/_shared/reel-studio-project.ts");
  const create = await file("supabase/functions/create-video-project/index.ts");
  const storyboard = await file("supabase/functions/generate-video-storyboard/index.ts");

  assert.match(contract, /validateBoundReelBrief/);
  assert.match(contract, /selectUnambiguousLegacyReelBrief/);
  assert.match(create, /create_bound_reel_video_project/);
  assert.match(storyboard, /insert_reel_storyboard_if_empty/);
  // Phase 2 layers eligibility ON TOP of the Phase 1 binding rules.
  assert.match(project, /validateBoundReelBrief/);
  assert.match(project, /assertReelStudioEligible/);
  assert.match(create, /resolveReelSourceEligibility/);
});

test("every Phase 2 migration is additive and no historical migration was edited", async () => {
  const phase2 = await file("supabase/migrations/20260727000034_reel_studio_phase2_recovery_modes_capability.sql");
  assert.match(phase2, /add column if not exists failure_stage/);
  assert.match(phase2, /'hybrid'::text/);
  // Additive only: no dropped column, no dropped table, no data deletion.
  assert.doesNotMatch(phase2, /drop table|drop column|truncate |delete from/i);
  // Constraint replacement is the documented additive pattern (drop + re-add with
  // the new value included), never an in-place edit of a historical migration.
  assert.match(phase2, /alter table public\.client_production_briefs drop constraint if exists/);

  // The live-only Phase D constraints are now captured with their REAL deployed
  // definitions rather than approximations.
  const formatMigration = await file("supabase/migrations/20260723143845_reel_studio_phase_d_client_assets_reel_video_format.sql");
  assert.match(formatMigration, /pg_get_constraintdef/);
  assert.match(formatMigration, /'reel_video'::text/);
  const mimeMigration = await file("supabase/migrations/20260723143913_reel_studio_phase_d_client_assets_video_mime_type.sql");
  assert.match(mimeMigration, /'video\/mp4'::text/);
  const bucketMigration = await file("supabase/migrations/20260723143937_reel_studio_phase_d_client_assets_video_bucket.sql");
  assert.match(bucketMigration, /'video-assets'::text/);
});

test("no Phase 3 final-Reel or publishing functionality was introduced (Phase 2 migration itself)", async () => {
  const phase2 = await file("supabase/migrations/20260727000034_reel_studio_phase2_recovery_modes_capability.sql");
  // No final-Reel entity, no compositing, no Reels publishing — checked against
  // the Phase 2 migration itself, which is immutable history. The synchronous
  // publisher (_shared/instagram-publish.ts) legitimately gained real,
  // asynchronous Reels + Story-video publishing in Phase 3 / Programme Stage
  // K (via the scheduled worker, never this file) — see
  // tests/reel-studio-phase3.test.ts and tests/distribution-policy.test.ts
  // for the checks that now cover that real behaviour.
  assert.doesNotMatch(phase2, /final_reel|reel_assembly|create table/i);
});
