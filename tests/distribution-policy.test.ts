// Programme Stage K — Organic Distribution Consolidation, deterministic unit
// coverage: the approval-policy gate (_shared/distribution-policy.ts) and the
// Story-video generalisation of the publish-capability registry
// (_shared/publish-capability.ts). No provider call and no database is
// touched — everything under test here is pure.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DISTRIBUTION_POLICY,
  validateBlackoutPeriods,
  validateRestrictedWeekdays,
  checkScheduleAllowed,
  checkApprovalModeGate,
  checkAutoScheduleAllowed,
  type ClientDistributionPolicy,
} from "../supabase/functions/_shared/distribution-policy.ts";
import { resolvePublishCapability } from "../supabase/functions/_shared/publish-capability.ts";

// ---------------------------------------------------------------------------
// validateBlackoutPeriods / validateRestrictedWeekdays
// ---------------------------------------------------------------------------

test("validateBlackoutPeriods: accepts well-formed periods", () => {
  const periods = validateBlackoutPeriods([
    { start_date: "2026-12-24", end_date: "2026-12-26", reason: "Christmas" },
  ]);
  assert.equal(periods?.length, 1);
});

test("validateBlackoutPeriods: accepts an empty array", () => {
  assert.deepEqual(validateBlackoutPeriods([]), []);
});

test("validateBlackoutPeriods: rejects a non-array, bad dates, or an end before the start", () => {
  assert.equal(validateBlackoutPeriods({}), null);
  assert.equal(validateBlackoutPeriods([{ start_date: "not-a-date", end_date: "2026-12-26", reason: "x" }]), null);
  assert.equal(validateBlackoutPeriods([{ start_date: "2026-12-26", end_date: "2026-12-24", reason: "x" }]), null);
});

test("validateBlackoutPeriods: rejects a blank reason", () => {
  assert.equal(validateBlackoutPeriods([{ start_date: "2026-12-24", end_date: "2026-12-26", reason: "  " }]), null);
});

test("validateRestrictedWeekdays: accepts and de-duplicates valid weekdays", () => {
  assert.deepEqual(validateRestrictedWeekdays([0, 6, 0]), [0, 6]);
});

test("validateRestrictedWeekdays: rejects out-of-range or non-integer values", () => {
  assert.equal(validateRestrictedWeekdays([7]), null);
  assert.equal(validateRestrictedWeekdays([-1]), null);
  assert.equal(validateRestrictedWeekdays([1.5]), null);
  assert.equal(validateRestrictedWeekdays("monday"), null);
});

// ---------------------------------------------------------------------------
// checkScheduleAllowed
// ---------------------------------------------------------------------------

test("checkScheduleAllowed: default policy allows any date", () => {
  const result = checkScheduleAllowed(DEFAULT_DISTRIBUTION_POLICY, "2026-12-25T10:00:00Z");
  assert.equal(result.allowed, true);
});

test("checkScheduleAllowed: blocks a date inside a blackout period", () => {
  const policy: ClientDistributionPolicy = {
    ...DEFAULT_DISTRIBUTION_POLICY,
    blackoutPeriods: [{ start_date: "2026-12-24", end_date: "2026-12-26", reason: "Christmas" }],
  };
  const result = checkScheduleAllowed(policy, "2026-12-25T10:00:00Z");
  assert.equal(result.allowed, false);
  assert.match(result.reason ?? "", /Christmas/);
});

test("checkScheduleAllowed: allows a date just outside a blackout period", () => {
  const policy: ClientDistributionPolicy = {
    ...DEFAULT_DISTRIBUTION_POLICY,
    blackoutPeriods: [{ start_date: "2026-12-24", end_date: "2026-12-26", reason: "Christmas" }],
  };
  const result = checkScheduleAllowed(policy, "2026-12-27T10:00:00Z");
  assert.equal(result.allowed, true);
});

test("checkScheduleAllowed: blocks a restricted weekday", () => {
  const policy: ClientDistributionPolicy = { ...DEFAULT_DISTRIBUTION_POLICY, restrictedWeekdays: [0] }; // Sunday
  const result = checkScheduleAllowed(policy, "2026-08-09T10:00:00Z"); // a Sunday
  assert.equal(result.allowed, false);
  assert.match(result.reason ?? "", /Sunday/);
});

test("checkScheduleAllowed: rejects an invalid date string", () => {
  const result = checkScheduleAllowed(DEFAULT_DISTRIBUTION_POLICY, "not-a-date");
  assert.equal(result.allowed, false);
});

// ---------------------------------------------------------------------------
// checkApprovalModeGate / checkAutoScheduleAllowed
// ---------------------------------------------------------------------------

test("checkApprovalModeGate: internal_only never blocks", () => {
  const result = checkApprovalModeGate(DEFAULT_DISTRIBUTION_POLICY, { clientApprovedAt: null });
  assert.equal(result.allowed, true);
});

test("checkApprovalModeGate: client_approval_required blocks without a client approval", () => {
  const policy: ClientDistributionPolicy = { ...DEFAULT_DISTRIBUTION_POLICY, approvalMode: "client_approval_required" };
  const result = checkApprovalModeGate(policy, { clientApprovedAt: null });
  assert.equal(result.allowed, false);
});

test("checkApprovalModeGate: client_approval_required allows once approved", () => {
  const policy: ClientDistributionPolicy = { ...DEFAULT_DISTRIBUTION_POLICY, approvalMode: "client_approval_required" };
  const result = checkApprovalModeGate(policy, { clientApprovedAt: "2026-08-08T00:00:00Z" });
  assert.equal(result.allowed, true);
});

test("checkAutoScheduleAllowed: disabled by default", () => {
  const result = checkAutoScheduleAllowed(DEFAULT_DISTRIBUTION_POLICY, { clientApprovedAt: null });
  assert.equal(result.allowed, false);
});

test("checkAutoScheduleAllowed: manual_publish_only overrides an enabled auto-schedule flag", () => {
  const policy: ClientDistributionPolicy = { ...DEFAULT_DISTRIBUTION_POLICY, autoScheduleAfterApproval: true, manualPublishOnly: true };
  const result = checkAutoScheduleAllowed(policy, { clientApprovedAt: null });
  assert.equal(result.allowed, false);
  assert.match(result.reason ?? "", /manual publish/i);
});

test("checkAutoScheduleAllowed: enabled + internal_only allows immediately", () => {
  const policy: ClientDistributionPolicy = { ...DEFAULT_DISTRIBUTION_POLICY, autoScheduleAfterApproval: true };
  const result = checkAutoScheduleAllowed(policy, { clientApprovedAt: null });
  assert.equal(result.allowed, true);
});

test("checkAutoScheduleAllowed: enabled + client_approval_required still needs client approval", () => {
  const policy: ClientDistributionPolicy = { ...DEFAULT_DISTRIBUTION_POLICY, autoScheduleAfterApproval: true, approvalMode: "client_approval_required" };
  assert.equal(checkAutoScheduleAllowed(policy, { clientApprovedAt: null }).allowed, false);
  assert.equal(checkAutoScheduleAllowed(policy, { clientApprovedAt: "2026-08-08T00:00:00Z" }).allowed, true);
});

// ---------------------------------------------------------------------------
// resolvePublishCapability: Story video generalisation
// ---------------------------------------------------------------------------

test("resolvePublishCapability: story_video without a reel context fails closed as a shot clip", () => {
  const result = resolvePublishCapability({
    platform: "instagram", assetFormat: "story_video", contentType: "STORIES", mediaMimeTypes: ["video/mp4"],
  });
  assert.equal(result.supported, false);
  assert.equal(result.code, "blocked_shot_clip_not_publishable");
});

test("resolvePublishCapability: story_video with an approved current deliverable is supported", () => {
  const result = resolvePublishCapability({
    platform: "instagram", assetFormat: "story_video", contentType: "STORIES", mediaMimeTypes: ["video/mp4"],
    reelContext: {
      deliverable: {
        id: "d1", client_id: "c1", video_project_id: "p1", status: "approved", is_current: true,
        mime_type: "video/mp4", storage_bucket: "video-assets", storage_path: "c1/p1/final/v1/final.mp4", superseded_at: null,
      },
      project: { id: "p1", client_id: "c1" },
      recordClientId: "c1",
    },
  });
  assert.equal(result.supported, true);
});

test("resolvePublishCapability: story_video rejects non-MP4 media even with a real deliverable context", () => {
  const result = resolvePublishCapability({
    platform: "instagram", assetFormat: "story_video", contentType: "STORIES", mediaMimeTypes: ["image/png"],
    reelContext: {
      deliverable: {
        id: "d1", client_id: "c1", video_project_id: "p1", status: "approved", is_current: true,
        mime_type: "video/mp4", storage_bucket: "video-assets", storage_path: "c1/p1/final/v1/final.mp4", superseded_at: null,
      },
      project: { id: "p1", client_id: "c1" },
      recordClientId: "c1",
    },
  });
  assert.equal(result.supported, false);
  assert.equal(result.code, "unsupported_media_type");
});

test("resolvePublishCapability: an unapproved deliverable blocks story_video the same way it blocks a Reel", () => {
  const result = resolvePublishCapability({
    platform: "instagram", assetFormat: "story_video", contentType: "STORIES", mediaMimeTypes: ["video/mp4"],
    reelContext: {
      deliverable: {
        id: "d1", client_id: "c1", video_project_id: "p1", status: "needs_review", is_current: true,
        mime_type: "video/mp4", storage_bucket: "video-assets", storage_path: "c1/p1/final/v1/final.mp4", superseded_at: null,
      },
      project: { id: "p1", client_id: "c1" },
      recordClientId: "c1",
    },
  });
  assert.equal(result.supported, false);
  assert.equal(result.code, "blocked_final_reel_not_approved");
});
