// Programme Stage J — Reel Studio Completion, deterministic unit coverage.
// No provider call and no database is touched — everything under test is pure.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  selectReelProductionStrategy,
  checkRenderCapability,
  validateTimeline,
  computeTimelineDurationSec,
  checkDurationAlignment,
  validateVoiceTrack,
  validateAudioSpec,
  validateCaptionSpec,
  checkProofEditorialIntegrity,
  checkMotionExplainerTextPreservation,
  checkCinematicAiContinuity,
  checkFootageSourceRightsPreserved,
  safeShotSourceAssetFilename,
  shotSourceAssetStoragePath,
  shotSourceAssetPathBelongsToShot,
} from "../supabase/functions/_shared/reel-production.ts";

// ---------------------------------------------------------------------------
// selectReelProductionStrategy
// ---------------------------------------------------------------------------

test("selectReelProductionStrategy: human-first policy with footage available picks footage", () => {
  const result = selectReelProductionStrategy({
    proofAvailable: false, realFootageAvailable: true, automationPolicy: "human_first", qualityRequirement: "standard",
  });
  assert.equal(result.strategy, "footage");
});

test("selectReelProductionStrategy: proof and footage both available picks hybrid", () => {
  const result = selectReelProductionStrategy({
    proofAvailable: true, realFootageAvailable: true, automationPolicy: "ai_first", qualityRequirement: "standard",
  });
  assert.equal(result.strategy, "hybrid");
});

test("selectReelProductionStrategy: proof only picks proof_editorial", () => {
  const result = selectReelProductionStrategy({
    proofAvailable: true, realFootageAvailable: false, automationPolicy: "ai_first", qualityRequirement: "standard",
  });
  assert.equal(result.strategy, "proof_editorial");
});

test("selectReelProductionStrategy: no proof/footage but premium quality picks motion_explainer", () => {
  const result = selectReelProductionStrategy({
    proofAvailable: false, realFootageAvailable: false, automationPolicy: "ai_first", qualityRequirement: "premium",
  });
  assert.equal(result.strategy, "motion_explainer");
});

test("selectReelProductionStrategy: nothing available and standard quality falls back to cinematic_ai", () => {
  const result = selectReelProductionStrategy({
    proofAvailable: false, realFootageAvailable: false, automationPolicy: "ai_first", qualityRequirement: "standard",
  });
  assert.equal(result.strategy, "cinematic_ai");
});

test("selectReelProductionStrategy: human_first policy with no footage does not force footage strategy", () => {
  const result = selectReelProductionStrategy({
    proofAvailable: true, realFootageAvailable: false, automationPolicy: "human_first", qualityRequirement: "standard",
  });
  assert.equal(result.strategy, "proof_editorial");
});

// ---------------------------------------------------------------------------
// checkRenderCapability
// ---------------------------------------------------------------------------

test("checkRenderCapability: human_editor_handoff and manual_upload are supported", () => {
  assert.equal(checkRenderCapability("human_editor_handoff").supported, true);
  assert.equal(checkRenderCapability("manual_upload").supported, true);
});

test("checkRenderCapability: automated_template and provider_render fail cleanly", () => {
  const template = checkRenderCapability("automated_template");
  assert.equal(template.supported, false);
  assert.match(template.reason ?? "", /engine/i);
  const provider = checkRenderCapability("provider_render");
  assert.equal(provider.supported, false);
  assert.match(provider.reason ?? "", /provider/i);
});

// ---------------------------------------------------------------------------
// validateTimeline / computeTimelineDurationSec / checkDurationAlignment
// ---------------------------------------------------------------------------

test("validateTimeline: accepts a well-formed timeline", () => {
  const timeline = validateTimeline([
    { order: 1, source: "shot", shot_id: "shot-1", duration_sec: 3, transition: null },
    { order: 2, source: "outro", shot_id: null, duration_sec: 2, transition: "fade" },
  ]);
  assert.equal(timeline?.length, 2);
});

test("validateTimeline: rejects a shot entry with no shot_id", () => {
  assert.equal(validateTimeline([{ order: 1, source: "shot", shot_id: null, duration_sec: 3 }]), null);
});

test("validateTimeline: rejects a non-shot entry that carries a shot_id", () => {
  assert.equal(validateTimeline([{ order: 1, source: "intro", shot_id: "shot-1", duration_sec: 3 }]), null);
});

test("validateTimeline: rejects a non-positive duration or order", () => {
  assert.equal(validateTimeline([{ order: 0, source: "intro", shot_id: null, duration_sec: 3 }]), null);
  assert.equal(validateTimeline([{ order: 1, source: "intro", shot_id: null, duration_sec: 0 }]), null);
});

test("validateTimeline: rejects a non-array", () => {
  assert.equal(validateTimeline({}), null);
});

test("computeTimelineDurationSec: sums every entry's duration", () => {
  const timeline = validateTimeline([
    { order: 1, source: "shot", shot_id: "a", duration_sec: 3, transition: null },
    { order: 2, source: "shot", shot_id: "b", duration_sec: 4, transition: null },
  ])!;
  assert.equal(computeTimelineDurationSec(timeline), 7);
});

test("checkDurationAlignment: within tolerance is aligned", () => {
  const timeline = validateTimeline([{ order: 1, source: "shot", shot_id: "a", duration_sec: 28, transition: null }])!;
  const result = checkDurationAlignment(timeline, 30);
  assert.equal(result.aligned, true);
});

test("checkDurationAlignment: outside tolerance is not aligned", () => {
  const timeline = validateTimeline([{ order: 1, source: "shot", shot_id: "a", duration_sec: 10, transition: null }])!;
  const result = checkDurationAlignment(timeline, 30);
  assert.equal(result.aligned, false);
});

// ---------------------------------------------------------------------------
// validateVoiceTrack / validateAudioSpec / validateCaptionSpec
// ---------------------------------------------------------------------------

test("validateVoiceTrack: real_voice and ai_narrator do not require consent", () => {
  assert.notEqual(validateVoiceTrack({ source: "real_voice", consent_confirmed: false, script: null }), null);
  assert.notEqual(validateVoiceTrack({ source: "ai_narrator", consent_confirmed: false, script: null }), null);
});

test("validateVoiceTrack: consent_voice_clone requires consent_confirmed true", () => {
  assert.equal(validateVoiceTrack({ source: "consent_voice_clone", consent_confirmed: false, script: null }), null);
  assert.notEqual(validateVoiceTrack({ source: "consent_voice_clone", consent_confirmed: true, script: null }), null);
});

test("validateVoiceTrack: rejects an unrecognised source", () => {
  assert.equal(validateVoiceTrack({ source: "robot", consent_confirmed: true, script: null }), null);
});

test("validateAudioSpec: requires a recognised loudness standard", () => {
  assert.equal(validateAudioSpec({ loudness_standard: "loud" }), null);
  assert.notEqual(validateAudioSpec({ loudness_standard: "EBU_R128" }), null);
});

test("validateAudioSpec: defaults sfx_refs to an empty array when omitted", () => {
  const spec = validateAudioSpec({ loudness_standard: "EBU_R128" });
  assert.deepEqual(spec?.sfx_refs, []);
});

test("validateCaptionSpec: enabled captions require a real timing source, not none", () => {
  assert.equal(validateCaptionSpec({ enabled: true, timing_source: "none" }), null);
  assert.notEqual(validateCaptionSpec({ enabled: true, timing_source: "manual" }), null);
});

test("validateCaptionSpec: disabled captions accept timing_source none", () => {
  assert.notEqual(validateCaptionSpec({ enabled: false, timing_source: "none" }), null);
});

// ---------------------------------------------------------------------------
// Strategy integrity checks
// ---------------------------------------------------------------------------

test("checkProofEditorialIntegrity: passes when every shot is a real source asset", () => {
  const result = checkProofEditorialIntegrity("proof_editorial", [
    { shot_number: 1, shot_source_kind: "source_asset" },
    { shot_number: 2, shot_source_kind: "source_asset" },
  ]);
  assert.equal(result.ok, true);
});

test("checkProofEditorialIntegrity: fails and names offenders when a shot is AI-generated", () => {
  const result = checkProofEditorialIntegrity("proof_editorial", [
    { shot_number: 1, shot_source_kind: "source_asset" },
    { shot_number: 2, shot_source_kind: "ai_generated" },
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.offendingShotNumbers, [2]);
});

test("checkProofEditorialIntegrity: is a no-op for other strategies", () => {
  const result = checkProofEditorialIntegrity("cinematic_ai", [{ shot_number: 1, shot_source_kind: "ai_generated" }]);
  assert.equal(result.ok, true);
});

test("checkMotionExplainerTextPreservation: passes when every required text appears verbatim", () => {
  const result = checkMotionExplainerTextPreservation(
    "motion_explainer",
    [{ shot_number: 1, beat_description: "Conversion rate increased by 40% in 3 months" }],
    ["40%"],
  );
  assert.equal(result.ok, true);
});

test("checkMotionExplainerTextPreservation: fails when a required exact text is missing or paraphrased", () => {
  const result = checkMotionExplainerTextPreservation(
    "motion_explainer",
    [{ shot_number: 1, beat_description: "Conversion rate improved significantly" }],
    ["40%"],
  );
  assert.equal(result.ok, false);
  assert.match(result.detail, /40%/);
});

test("checkCinematicAiContinuity: requires a continuity plan for cinematic_ai and hybrid", () => {
  assert.equal(checkCinematicAiContinuity("cinematic_ai", false).ok, false);
  assert.equal(checkCinematicAiContinuity("cinematic_ai", true).ok, true);
  assert.equal(checkCinematicAiContinuity("hybrid", false).ok, false);
});

test("checkCinematicAiContinuity: is a no-op for strategies with no AI-generated shots", () => {
  assert.equal(checkCinematicAiContinuity("proof_editorial", false).ok, true);
});

test("checkFootageSourceRightsPreserved: fails when a source-asset shot has no rights note", () => {
  const result = checkFootageSourceRightsPreserved("footage", [
    { shot_number: 1, shot_source_kind: "source_asset", source_description: null },
  ]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.offendingShotNumbers, [1]);
});

test("checkFootageSourceRightsPreserved: passes when every source-asset shot has a rights note", () => {
  const result = checkFootageSourceRightsPreserved("footage", [
    { shot_number: 1, shot_source_kind: "source_asset", source_description: "Filmed on-site, client consented 2026-08-01" },
  ]);
  assert.equal(result.ok, true);
});

test("checkFootageSourceRightsPreserved: ignores AI-generated shots within a hybrid project", () => {
  const result = checkFootageSourceRightsPreserved("hybrid", [
    { shot_number: 1, shot_source_kind: "ai_generated", source_description: null },
  ]);
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Shot source-asset upload path
// ---------------------------------------------------------------------------

test("safeShotSourceAssetFilename: sanitises the stem and keeps the extension", () => {
  assert.equal(safeShotSourceAssetFilename("My Screenshot (final).png"), "My-Screenshot-final.png");
});

test("safeShotSourceAssetFilename: lowercases the extension only", () => {
  assert.equal(safeShotSourceAssetFilename("photo.PNG"), "photo.png");
});

test("safeShotSourceAssetFilename: falls back to a default stem for a degenerate name", () => {
  assert.equal(safeShotSourceAssetFilename("...png"), "source.png");
});

test("safeShotSourceAssetFilename: falls back to a .bin extension when none is present", () => {
  assert.equal(safeShotSourceAssetFilename("noextension"), "noextension.bin");
});

test("shotSourceAssetStoragePath: is scoped to client/project/shot", () => {
  const path = shotSourceAssetStoragePath({ clientId: "c1", videoProjectId: "p1", shotId: "s1", safeFilename: "photo.png" });
  assert.equal(path, "c1/p1/shots/s1/photo.png");
});

test("shotSourceAssetPathBelongsToShot: accepts a path under the shot's own prefix", () => {
  assert.equal(shotSourceAssetPathBelongsToShot("c1/p1/shots/s1/photo.png", "c1", "p1", "s1"), true);
});

test("shotSourceAssetPathBelongsToShot: rejects a path for a different shot, project or client", () => {
  assert.equal(shotSourceAssetPathBelongsToShot("c1/p1/shots/s2/photo.png", "c1", "p1", "s1"), false);
  assert.equal(shotSourceAssetPathBelongsToShot("c1/p2/shots/s1/photo.png", "c1", "p1", "s1"), false);
  assert.equal(shotSourceAssetPathBelongsToShot("c2/p1/shots/s1/photo.png", "c1", "p1", "s1"), false);
});
