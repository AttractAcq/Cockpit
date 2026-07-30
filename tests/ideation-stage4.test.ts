// Ideation Stage 4 — target mapping, eligibility, idempotency, view helpers,
// and architecture boundaries.
//
// No test performs a real provider call — Stage 4 has no model call at all.
// Fixtures are deterministic and test-only; nothing here touches a live
// database. The transactional behaviour is covered by the Stage 4 SQL suites.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  findUnsupportedCommitSlots,
  IDEATION_COMMIT_MAPPING_VERSION,
  IDEATION_COMMIT_MODULE_VERSION,
  IDEATION_COMMIT_OUTPUT_SCHEMA_VERSION,
  IDEATION_COMMIT_PROHIBITED_TARGETS,
  IDEATION_COMMIT_REFERENCE_ALLOCATOR_VERSION,
  IDEATION_COMMIT_TARGET_MANIFEST,
  IDEATION_COMMIT_TARGET_MANIFEST_VERSION,
  IDEATION_COMMIT_TARGETS,
  isSupportedIdeationCommitAssetType,
  resolveIdeationCommitTarget,
} from "../supabase/functions/_shared/ideation/commit/targets.ts";
import {
  evaluateCommitEligibility,
  type CommitCandidateRow,
  type CommitCycleRow,
  type CommitProposalRow,
  type CommitScoreRow,
  type CommitScoringRunRow,
  type CommitSlotRow,
} from "../supabase/functions/_shared/ideation/commit/eligibility.ts";
import {
  buildCommitConfigurationSnapshot,
  buildCommitIdempotencyKey,
  hashCommitConfiguration,
} from "../supabase/functions/_shared/ideation/commit/configuration.ts";
import {
  canCommitProposal,
  commitItemsByDate,
  commitRecoveryAction,
  groupCommittedRefs,
  isNonRetryableCommitFailure,
  summariseCommitPlan,
} from "../src/lib/ideation-commit-view.ts";
import { decodeIdeationCommitFailureBody } from "../src/lib/ideation-commit-failure.ts";

const MIGRATION = "supabase/migrations/20260730000040_ideation_stage4_commit_content.sql";
const HASH64 = "a".repeat(64);

function hashFor(seed: string): string {
  return (seed.repeat(64) + HASH64).slice(0, 64).replace(/[^0-9a-f]/g, "b");
}

/**
 * Boundary assertions must judge code, not prose: a comment explaining that
 * Stage 4 never touches ads_master is not itself a violation.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)(\/\/|--).*$/, ""))
    .join("\n");
}

/* ---------------------------------------------------------------- fixtures */

function cycle(overrides: Partial<CommitCycleRow> = {}): CommitCycleRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    client_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    status: "completed",
    expected_candidate_count: 4,
    candidate_count: 4,
    shortfall_count: 0,
    input_hash: hashFor("1"),
    period_start: "2026-08-01",
    period_end: "2026-08-07",
    ...overrides,
  };
}

function scoringRun(overrides: Partial<CommitScoringRunRow> = {}): CommitScoringRunRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    client_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ideation_cycle_id: "11111111-1111-4111-8111-111111111111",
    status: "completed",
    expected_candidate_count: 4,
    scored_candidate_count: 4,
    failed_candidate_count: 0,
    configuration_hash: hashFor("2"),
    ...overrides,
  };
}

function proposal(overrides: Partial<CommitProposalRow> = {}): CommitProposalRow {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    client_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ideation_cycle_id: "11111111-1111-4111-8111-111111111111",
    scoring_run_id: "22222222-2222-4222-8222-222222222222",
    status: "approved",
    proposal_version: 1,
    edit_revision: 3,
    expected_slot_count: 4,
    assigned_slot_count: 4,
    unassigned_candidate_count: 0,
    unresolved_conflict_count: 0,
    conflict_count: 0,
    approved_at: "2026-07-30T10:00:00Z",
    approved_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    configuration_hash: hashFor("3"),
    calendar_conflict_digest: hashFor("4"),
    authority_snapshot: { authority_hash: hashFor("5") },
    period_start: "2026-08-01",
    period_end: "2026-08-07",
    ...overrides,
  };
}

const ASSET_ORDER = ["reel", "carousel", "static", "story"] as const;

function slotFor(index: number, overrides: Partial<CommitSlotRow> = {}): CommitSlotRow {
  const assetType = ASSET_ORDER[index];
  const target = resolveIdeationCommitTarget(assetType)!;
  return {
    id: `44444444-4444-4444-8444-44444444444${index}`,
    client_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    proposal_id: "33333333-3333-4333-8333-333333333333",
    ideation_cycle_id: "11111111-1111-4111-8111-111111111111",
    scoring_run_id: "22222222-2222-4222-8222-222222222222",
    proposal_slot_key: `2026-08-0${index + 1}:${assetType}:1`,
    proposed_date: `2026-08-0${index + 1}`,
    period_start: "2026-08-01",
    period_end: "2026-08-07",
    required_asset_type: assetType,
    calendar_row_type: target.calendar_row_type,
    candidate_id: `55555555-5555-4555-8555-55555555555${index}`,
    candidate_score_id: `66666666-6666-4666-8666-66666666666${index}`,
    candidate_asset_type_snapshot: assetType,
    candidate_content_hash: hashFor(String(index + 1)),
    candidate_rank_snapshot: index + 1,
    candidate_score_snapshot: 90 - index,
    conflict_status: "clear",
    ...overrides,
  };
}

function candidateFor(index: number, overrides: Partial<CommitCandidateRow> = {}): CommitCandidateRow {
  return {
    id: `55555555-5555-4555-8555-55555555555${index}`,
    client_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ideation_cycle_id: "11111111-1111-4111-8111-111111111111",
    asset_type: ASSET_ORDER[index],
    working_title: `Candidate ${index}`,
    hook: `Hook ${index}`,
    core_message: `Core message ${index}`,
    psychological_angle: `Angle ${index}`,
    cta: `CTA ${index}`,
    input_hash: hashFor(String(index + 1)),
    ...overrides,
  };
}

function scoreFor(index: number, overrides: Partial<CommitScoreRow> = {}): CommitScoreRow {
  return {
    id: `66666666-6666-4666-8666-66666666666${index}`,
    client_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    scoring_run_id: "22222222-2222-4222-8222-222222222222",
    candidate_id: `55555555-5555-4555-8555-55555555555${index}`,
    rank: index + 1,
    overall_score: 90 - index,
    candidate_content_hash: hashFor(String(index + 1)),
    ...overrides,
  };
}

function eligibilityInput(overrides: Record<string, unknown> = {}) {
  const slots = [0, 1, 2, 3].map((index) => slotFor(index));
  return {
    clientId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    expectedEditRevision: 3,
    proposal: proposal(),
    slots,
    cycle: cycle(),
    scoringRun: scoringRun(),
    candidates: [0, 1, 2, 3].map((index) => candidateFor(index)),
    scores: [0, 1, 2, 3].map((index) => scoreFor(index)),
    supersededByCount: 0,
    completedCommitRunId: null as string | null,
    currentCalendarDigest: hashFor("4"),
    authorityVerification: { ok: true } as { ok: true } | { ok: false; message: string },
    ...overrides,
  };
}

/* ------------------------------------------------------- target mapping */

test("reel, carousel, and static map to organic_master", () => {
  for (const assetType of ["reel", "carousel", "static"] as const) {
    assert.equal(resolveIdeationCommitTarget(assetType)!.master_table, "organic_master");
  }
});

test("story maps to story_master and is never coerced into organic_master", () => {
  const story = resolveIdeationCommitTarget("story")!;
  assert.equal(story.master_table, "story_master");
  assert.equal(story.calendar_row_type, "stories");
  assert.equal(story.type_code, "ST");
  const organicAssetTypes = IDEATION_COMMIT_TARGETS
    .filter((target) => target.master_table === "organic_master")
    .map((target) => target.asset_type);
  assert.equal(organicAssetTypes.includes("story" as never), false);
});

test("every target maps to the canonical Phase 3 type code and Calendar lane", () => {
  assert.deepEqual(
    IDEATION_COMMIT_TARGETS.map((target) => [target.asset_type, target.type_code, target.calendar_row_type]),
    [
      ["reel", "RL", "reel"],
      ["carousel", "CR", "carousels"],
      ["static", "FP", "feed_posts"],
      ["story", "ST", "stories"],
    ],
  );
});

test("no target maps to ads_master and the AD type code is absent", () => {
  for (const target of IDEATION_COMMIT_TARGETS) {
    assert.notEqual(target.master_table as string, "ads_master");
    assert.notEqual(target.type_code as string, "AD");
  }
  assert.equal(IDEATION_COMMIT_PROHIBITED_TARGETS.includes("ads_master"), true);
});

test("unknown and unsupported asset types resolve to null, never a guess", () => {
  for (const value of ["ad", "advert", "video", "", "REEL", "story_sequence"]) {
    assert.equal(resolveIdeationCommitTarget(value), null);
    assert.equal(isSupportedIdeationCommitAssetType(value), false);
  }
});

test("unsupported slots are identified with their slot key", () => {
  const unsupported = findUnsupportedCommitSlots([
    { proposal_slot_key: "a", required_asset_type: "reel" },
    { proposal_slot_key: "b", required_asset_type: "ad" },
  ]);
  assert.deepEqual(unsupported, [{ proposal_slot_key: "b", asset_type: "ad" }]);
});

test("the frozen manifest records that Stage 4 makes no model call and starts nothing downstream", () => {
  assert.equal(IDEATION_COMMIT_TARGET_MANIFEST.calls_model, false);
  assert.equal(IDEATION_COMMIT_TARGET_MANIFEST.creates_production_brief, false);
  assert.equal(IDEATION_COMMIT_TARGET_MANIFEST.creates_asset, false);
  assert.equal(IDEATION_COMMIT_TARGET_MANIFEST.publishes, false);
  assert.equal(IDEATION_COMMIT_TARGET_MANIFEST.distributes, false);
  assert.equal(IDEATION_COMMIT_TARGET_MANIFEST.review_state_on_commit, "needs_review");
  assert.equal(IDEATION_COMMIT_TARGET_MANIFEST.story_never_maps_to_organic_master, true);
});

test("the SQL mapping function matches the TypeScript manifest exactly", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  // Scoped to the manifest function itself, so an unrelated CHECK constraint
  // that happens to list the same asset types cannot satisfy this assertion.
  const body = sql.match(/create or replace function public\.ideation_commit_target[\s\S]*?\$\$;/i);
  assert.ok(body, "the SQL target manifest function must exist");
  const rows = [...body[0].matchAll(/\('(reel|carousel|static|story)',\s*'(\w+)',\s*'(\w+)',\s*'(\w+)'\)/g)]
    .map((match) => [match[1], match[2], match[3], match[4]]);
  assert.deepEqual(
    rows,
    IDEATION_COMMIT_TARGETS.map((target) => [
      target.asset_type,
      target.type_code,
      target.master_table,
      target.calendar_row_type,
    ]),
  );
});

/* ------------------------------------------------------------ eligibility */

test("an approved, active, fully assigned proposal is eligible", () => {
  const result = evaluateCommitEligibility(eligibilityInput());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.slots.length, 4);
});

test("a draft, failed, retryable, or running proposal is rejected", () => {
  for (const status of ["draft", "failed", "retryable", "running"]) {
    const result = evaluateCommitEligibility(eligibilityInput({ proposal: proposal({ status }) }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "PROPOSAL_NOT_APPROVED");
  }
});

test("a superseded proposal is rejected by status or by a superseding row", () => {
  const byStatus = evaluateCommitEligibility(eligibilityInput({ proposal: proposal({ status: "superseded" }) }));
  assert.equal(byStatus.ok, false);
  if (!byStatus.ok) assert.equal(byStatus.code, "PROPOSAL_SUPERSEDED");

  const byRow = evaluateCommitEligibility(eligibilityInput({ supersededByCount: 1 }));
  assert.equal(byRow.ok, false);
  if (!byRow.ok) assert.equal(byRow.code, "PROPOSAL_SUPERSEDED");
});

test("an already-committed proposal reports the existing commit run", () => {
  const result = evaluateCommitEligibility(eligibilityInput({ completedCommitRunId: "run-1" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "PROPOSAL_ALREADY_COMMITTED");
    assert.equal(result.details?.commit_run_id, "run-1");
  }
});

test("a proposal belonging to another client is rejected", () => {
  const result = evaluateCommitEligibility(eligibilityInput({ clientId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PROPOSAL_CLIENT_MISMATCH");
});

test("a missing proposal is rejected before anything else", () => {
  const result = evaluateCommitEligibility(eligibilityInput({ proposal: null }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PROPOSAL_NOT_FOUND");
});

test("an incomplete cycle is rejected", () => {
  for (const overrides of [
    { status: "running" },
    { candidate_count: 3 },
    { shortfall_count: 1 },
  ]) {
    const result = evaluateCommitEligibility(eligibilityInput({ cycle: cycle(overrides) }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "CYCLE_NOT_ELIGIBLE");
  }
});

test("an incomplete scoring run is rejected", () => {
  for (const overrides of [
    { status: "retryable" },
    { scored_candidate_count: 3 },
    { failed_candidate_count: 1 },
  ]) {
    const result = evaluateCommitEligibility(eligibilityInput({ scoringRun: scoringRun(overrides) }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SCORING_RUN_NOT_ELIGIBLE");
  }
});

test("a missing proposal slot is rejected", () => {
  const slots = [0, 1, 2].map((index) => slotFor(index));
  const result = evaluateCommitEligibility(eligibilityInput({ slots }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PROPOSAL_SNAPSHOT_MISMATCH");
});

test("an unassigned candidate is rejected", () => {
  const byCount = evaluateCommitEligibility(eligibilityInput({
    proposal: proposal({ unassigned_candidate_count: 1 }),
  }));
  assert.equal(byCount.ok, false);
  if (!byCount.ok) assert.equal(byCount.code, "PROPOSAL_INCOMPLETE");

  const slots = [0, 1, 2, 3].map((index) =>
    index === 2 ? slotFor(index, { candidate_id: null, candidate_score_id: null }) : slotFor(index));
  const bySlot = evaluateCommitEligibility(eligibilityInput({ slots }));
  assert.equal(bySlot.ok, false);
  if (!bySlot.ok) assert.equal(bySlot.code, "PROPOSAL_INCOMPLETE");
});

test("an unresolved conflict is rejected", () => {
  const result = evaluateCommitEligibility(eligibilityInput({
    proposal: proposal({ unresolved_conflict_count: 1, conflict_count: 1 }),
  }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PROPOSAL_CONFLICTS_UNRESOLVED");
});

test("a stale proposal revision is rejected and reports both revisions", () => {
  const result = evaluateCommitEligibility(eligibilityInput({ expectedEditRevision: 2 }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "PROPOSAL_REVISION_CONFLICT");
    assert.equal(result.details?.current_edit_revision, 3);
    assert.equal(result.details?.expected_edit_revision, 2);
  }
});

test("authority drift is rejected and reports why", () => {
  const result = evaluateCommitEligibility(eligibilityInput({
    authorityVerification: { ok: false, message: "Authority 02_Avatar.md changed version since this cycle was generated." },
  }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "AUTHORITY_SNAPSHOT_MISMATCH");
    assert.match(result.message, /changed version/);
  }
});

test("authority verification is supplied by the caller, never taken from the proposal", async () => {
  // A hash read off the proposal would compare equal to itself and prove
  // nothing, so eligibility must not read one.
  const source = await readFile("supabase/functions/_shared/ideation/commit/eligibility.ts", "utf8");
  assert.equal(/authority_snapshot\?\.authority_hash/.test(source), false);
  const index = await readFile("supabase/functions/commit-ideation-content/index.ts", "utf8");
  assert.match(index, /reconstructScoringAuthority/, "Stage 4 reuses the Stage 2/3 reconstruction");
});

test("candidate drift is rejected", () => {
  const candidates = [0, 1, 2, 3].map((index) =>
    index === 1 ? candidateFor(index, { input_hash: hashFor("9") }) : candidateFor(index));
  const result = evaluateCommitEligibility(eligibilityInput({ candidates }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CANDIDATE_SNAPSHOT_MISMATCH");
});

test("a candidate whose asset type changed is rejected", () => {
  const candidates = [0, 1, 2, 3].map((index) =>
    index === 0 ? candidateFor(index, { asset_type: "carousel" }) : candidateFor(index));
  const result = evaluateCommitEligibility(eligibilityInput({ candidates }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CANDIDATE_SNAPSHOT_MISMATCH");
});

test("score drift is rejected for rank, score, and hash alike", () => {
  for (const overrides of [{ rank: 9 }, { overall_score: 10 }, { candidate_content_hash: hashFor("9") }]) {
    const scores = [0, 1, 2, 3].map((index) => index === 0 ? scoreFor(index, overrides) : scoreFor(index));
    const result = evaluateCommitEligibility(eligibilityInput({ scores }));
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "SCORE_SNAPSHOT_MISMATCH");
  }
});

test("Calendar drift is rejected", () => {
  const result = evaluateCommitEligibility(eligibilityInput({ currentCalendarDigest: hashFor("9") }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "CALENDAR_SNAPSHOT_STALE");
});

test("an unsupported asset type is rejected and names the slot", () => {
  const slots = [0, 1, 2, 3].map((index) =>
    index === 3 ? slotFor(index, { required_asset_type: "ad", candidate_asset_type_snapshot: "ad" }) : slotFor(index));
  const result = evaluateCommitEligibility(eligibilityInput({ slots }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "UNSUPPORTED_ASSET_TYPE");
    assert.deepEqual(result.details?.unsupported_slots, [
      { proposal_slot_key: "2026-08-04:story:1", asset_type: "ad" },
    ]);
  }
});

test("a slot whose Calendar lane contradicts the manifest is rejected", () => {
  const slots = [0, 1, 2, 3].map((index) =>
    index === 0 ? slotFor(index, { calendar_row_type: "stories" }) : slotFor(index));
  const result = evaluateCommitEligibility(eligibilityInput({ slots }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "MASTER_MAPPING_INVALID");
});

test("a date outside the period is rejected", () => {
  const slots = [0, 1, 2, 3].map((index) =>
    index === 0 ? slotFor(index, { proposed_date: "2026-09-01" }) : slotFor(index));
  const result = evaluateCommitEligibility(eligibilityInput({ slots }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PROPOSAL_SNAPSHOT_MISMATCH");
});

test("a candidate assigned to two slots is rejected", () => {
  const slots = [0, 1, 2, 3].map((index) =>
    index === 1
      ? slotFor(index, {
        candidate_id: "55555555-5555-4555-8555-555555555550",
        candidate_asset_type_snapshot: "reel",
        required_asset_type: "reel",
        calendar_row_type: "reel",
      })
      : slotFor(index));
  const result = evaluateCommitEligibility(eligibilityInput({ slots }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "PROPOSAL_SNAPSHOT_MISMATCH");
});

/* ----------------------------------------------------------- idempotency */

test("identical configurations hash identically", async () => {
  const base = eligibilityInput();
  const build = () => buildCommitConfigurationSnapshot({
    clientId: base.clientId,
    cycle: base.cycle,
    scoringRun: base.scoringRun,
    proposal: base.proposal,
    slots: base.slots,
    authorityIdentities: [{ id: "f1", version: 2, classification: "context", hash: hashFor("7") }],
    currentCalendarDigest: base.currentCalendarDigest,
  });
  assert.equal(await hashCommitConfiguration(build()), await hashCommitConfiguration(build()));
});

test("slot order does not change the configuration hash", async () => {
  const base = eligibilityInput();
  const forward = buildCommitConfigurationSnapshot({
    clientId: base.clientId,
    cycle: base.cycle,
    scoringRun: base.scoringRun,
    proposal: base.proposal,
    slots: base.slots,
    authorityIdentities: [],
    currentCalendarDigest: base.currentCalendarDigest,
  });
  const reversed = buildCommitConfigurationSnapshot({
    clientId: base.clientId,
    cycle: base.cycle,
    scoringRun: base.scoringRun,
    proposal: base.proposal,
    slots: [...base.slots].reverse(),
    authorityIdentities: [],
    currentCalendarDigest: base.currentCalendarDigest,
  });
  assert.equal(await hashCommitConfiguration(forward), await hashCommitConfiguration(reversed));
});

test("every material input changes the configuration hash", async () => {
  const base = eligibilityInput();
  const identities = [{ id: "f1", version: 2, classification: "context", hash: hashFor("7") }];
  const baseline = await hashCommitConfiguration(buildCommitConfigurationSnapshot({
    clientId: base.clientId,
    cycle: base.cycle,
    scoringRun: base.scoringRun,
    proposal: base.proposal,
    slots: base.slots,
    authorityIdentities: identities,
    currentCalendarDigest: base.currentCalendarDigest,
  }));

  const variants: Array<[string, Parameters<typeof buildCommitConfigurationSnapshot>[0]]> = [
    ["proposal revision", {
      clientId: base.clientId, cycle: base.cycle, scoringRun: base.scoringRun,
      proposal: proposal({ edit_revision: 4 }), slots: base.slots,
      authorityIdentities: identities, currentCalendarDigest: base.currentCalendarDigest,
    }],
    ["proposal version", {
      clientId: base.clientId, cycle: base.cycle, scoringRun: base.scoringRun,
      proposal: proposal({ proposal_version: 2 }), slots: base.slots,
      authorityIdentities: identities, currentCalendarDigest: base.currentCalendarDigest,
    }],
    ["candidate", {
      clientId: base.clientId, cycle: base.cycle, scoringRun: base.scoringRun,
      proposal: base.proposal,
      slots: [slotFor(0, { candidate_content_hash: hashFor("9") }), ...base.slots.slice(1)],
      authorityIdentities: identities, currentCalendarDigest: base.currentCalendarDigest,
    }],
    ["score", {
      clientId: base.clientId, cycle: base.cycle, scoringRun: base.scoringRun,
      proposal: base.proposal,
      slots: [slotFor(0, { candidate_score_snapshot: 12 }), ...base.slots.slice(1)],
      authorityIdentities: identities, currentCalendarDigest: base.currentCalendarDigest,
    }],
    ["date", {
      clientId: base.clientId, cycle: base.cycle, scoringRun: base.scoringRun,
      proposal: base.proposal,
      slots: [slotFor(0, { proposed_date: "2026-08-06" }), ...base.slots.slice(1)],
      authorityIdentities: identities, currentCalendarDigest: base.currentCalendarDigest,
    }],
    ["asset type", {
      clientId: base.clientId, cycle: base.cycle, scoringRun: base.scoringRun,
      proposal: base.proposal,
      slots: [slotFor(0, { required_asset_type: "story", calendar_row_type: "stories" }), ...base.slots.slice(1)],
      authorityIdentities: identities, currentCalendarDigest: base.currentCalendarDigest,
    }],
    ["Calendar digest", {
      clientId: base.clientId, cycle: base.cycle, scoringRun: base.scoringRun,
      proposal: base.proposal, slots: base.slots,
      authorityIdentities: identities, currentCalendarDigest: hashFor("9"),
    }],
    ["authority identity", {
      clientId: base.clientId, cycle: base.cycle, scoringRun: base.scoringRun,
      proposal: base.proposal, slots: base.slots,
      authorityIdentities: [{ id: "f1", version: 3, classification: "context", hash: hashFor("7") }],
      currentCalendarDigest: base.currentCalendarDigest,
    }],
    ["cycle configuration", {
      clientId: base.clientId, cycle: cycle({ input_hash: hashFor("9") }), scoringRun: base.scoringRun,
      proposal: base.proposal, slots: base.slots,
      authorityIdentities: identities, currentCalendarDigest: base.currentCalendarDigest,
    }],
    ["scoring configuration", {
      clientId: base.clientId, cycle: base.cycle, scoringRun: scoringRun({ configuration_hash: hashFor("9") }),
      proposal: base.proposal, slots: base.slots,
      authorityIdentities: identities, currentCalendarDigest: base.currentCalendarDigest,
    }],
  ];

  for (const [label, input] of variants) {
    assert.notEqual(
      await hashCommitConfiguration(buildCommitConfigurationSnapshot(input)),
      baseline,
      `${label} must change the configuration hash`,
    );
  }
});

test("the mapping version participates in the configuration snapshot", () => {
  const base = eligibilityInput();
  const snapshot = buildCommitConfigurationSnapshot({
    clientId: base.clientId,
    cycle: base.cycle,
    scoringRun: base.scoringRun,
    proposal: base.proposal,
    slots: base.slots,
    authorityIdentities: [],
    currentCalendarDigest: base.currentCalendarDigest,
  });
  assert.equal(snapshot.target_manifest_version, IDEATION_COMMIT_TARGET_MANIFEST_VERSION);
  assert.equal(snapshot.mapping_version, IDEATION_COMMIT_MAPPING_VERSION);
  assert.equal(snapshot.reference_allocator_version, IDEATION_COMMIT_REFERENCE_ALLOCATOR_VERSION);
  assert.equal(snapshot.output_schema_version, IDEATION_COMMIT_OUTPUT_SCHEMA_VERSION);
  assert.equal(snapshot.module_version, IDEATION_COMMIT_MODULE_VERSION);
});

test("the snapshot excludes volatile inputs and every authority body", () => {
  const base = eligibilityInput();
  const snapshot = buildCommitConfigurationSnapshot({
    clientId: base.clientId,
    cycle: base.cycle,
    scoringRun: base.scoringRun,
    proposal: base.proposal,
    slots: base.slots,
    authorityIdentities: [{ id: "f1", version: 2, classification: "context", hash: hashFor("7") }],
    currentCalendarDigest: base.currentCalendarDigest,
  });
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of ["request_id", "access_token", "worker", "content_md", "executed_at", "started_at"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not be in the snapshot`);
  }
});

test("the idempotency key is derived from the proposal and configuration only", () => {
  const key = buildCommitIdempotencyKey({ proposalId: "p-1", configurationHash: HASH64 });
  assert.equal(key, `commit:p-1:${"a".repeat(24)}`);
  assert.notEqual(key, buildCommitIdempotencyKey({ proposalId: "p-2", configurationHash: HASH64 }));
});

test("the request contract accepts no configuration hash or content from the caller", async () => {
  const handler = await readFile("supabase/functions/commit-ideation-content/handler.ts", "utf8");
  const allowed = handler.match(/const ALLOWED_BODY_KEYS = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(allowed);
  const keys = [...allowed[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(keys, ["client_id", "confirm_commit", "expected_edit_revision", "proposal_id"]);
});

/* ------------------------------------------------------------ view logic */

test("the commit action shows only for an approved, uncommitted proposal", () => {
  assert.equal(canCommitProposal("approved", null), true);
  assert.equal(canCommitProposal("draft", null), false);
  assert.equal(canCommitProposal("failed", null), false);
  assert.equal(canCommitProposal("superseded", null), false);
  assert.equal(
    canCommitProposal("approved", { status: "completed" } as never),
    false,
    "a completed commit removes the action",
  );
});

test("the plan summary reports totals, split, dates, and conflicts", () => {
  const summary = summariseCommitPlan([
    { required_asset_type: "reel", proposed_date: "2026-08-02", conflict_status: "clear" },
    { required_asset_type: "reel", proposed_date: "2026-08-04", conflict_status: "clear" },
    { required_asset_type: "carousel", proposed_date: "2026-08-04", conflict_status: "occupied" },
    { required_asset_type: "story", proposed_date: "2026-08-05", conflict_status: "clear" },
  ], 0);
  assert.equal(summary.total, 4);
  assert.equal(summary.story, 1);
  assert.equal(summary.organic, 3);
  assert.deepEqual(summary.dates, ["2026-08-02", "2026-08-04", "2026-08-05"]);
  assert.deepEqual(summary.byAssetType, [
    { asset_type: "carousel", count: 1 },
    { asset_type: "reel", count: 2 },
    { asset_type: "story", count: 1 },
  ]);
  assert.equal(summary.unresolvedConflicts, 0);
});

test("integrity failures are non-retryable and never offer a blind retry", () => {
  for (const code of [
    "CALENDAR_SNAPSHOT_STALE",
    "CANDIDATE_SNAPSHOT_MISMATCH",
    "SCORE_SNAPSHOT_MISMATCH",
    "UNSUPPORTED_ASSET_TYPE",
    "PROPOSAL_REVISION_CONFLICT",
    "REQUIRED_FIELD_MISSING",
  ]) {
    assert.equal(isNonRetryableCommitFailure(code), true, code);
    assert.notEqual(commitRecoveryAction(code), "retry", code);
    assert.notEqual(commitRecoveryAction(code), "none", code);
  }
});

test("each typed failure maps to its one correct recovery action", () => {
  assert.equal(commitRecoveryAction("CALENDAR_SNAPSHOT_STALE"), "refresh_conflicts");
  assert.equal(commitRecoveryAction("CALENDAR_CONFLICT"), "refresh_conflicts");
  assert.equal(commitRecoveryAction("PROPOSAL_REVISION_CONFLICT"), "return_to_review");
  assert.equal(commitRecoveryAction("CANDIDATE_SNAPSHOT_MISMATCH"), "regenerate_proposal");
  assert.equal(commitRecoveryAction("UNSUPPORTED_ASSET_TYPE"), "inspect_proposal");
  assert.equal(commitRecoveryAction("COMMIT_PERSISTENCE_FAILED"), "retry");
});

test("committed refs group by domain and by date", () => {
  const items = [
    { id: "1", target_master_table: "organic_master", committed_date: "2026-08-02", operational_ref: "AUG02-RL-001" },
    { id: "2", target_master_table: "story_master", committed_date: "2026-08-02", operational_ref: "AUG02-ST-001" },
    { id: "3", target_master_table: "organic_master", committed_date: "2026-08-01", operational_ref: "AUG01-CR-001" },
  ] as never;
  const grouped = groupCommittedRefs(items);
  assert.equal(grouped.organic.length, 2);
  assert.equal(grouped.story.length, 1);
  const byDate = commitItemsByDate(items);
  assert.deepEqual(byDate.map((group) => group.date), ["2026-08-01", "2026-08-02"]);
  assert.deepEqual(byDate[1].items.map((item) => item.operational_ref), ["AUG02-RL-001", "AUG02-ST-001"]);
});

test("the failure decoder reads only the documented envelope", () => {
  assert.equal(decodeIdeationCommitFailureBody(null, "fallback"), null);
  assert.equal(decodeIdeationCommitFailureBody({ error: {} }, "fallback"), null);
  const decoded = decodeIdeationCommitFailureBody({
    error: {
      code: "CALENDAR_CONFLICT",
      message: "blocked",
      retryable: false,
      proposal_id: "p-1",
      expected_item_count: 4,
      failed_proposal_slot_key: "2026-08-01:reel:1",
    },
  }, "fallback");
  assert.equal(decoded?.code, "CALENDAR_CONFLICT");
  assert.equal(decoded?.retryable, false);
  assert.equal(decoded?.expected_item_count, 4);
  assert.equal(decoded?.failed_proposal_slot_key, "2026-08-01:reel:1");
  assert.equal(decoded?.commit_run_id, null);
});

/* -------------------------------------------------- architecture boundaries */

test("Stage 4 imports no model provider anywhere", async () => {
  const files = [
    "supabase/functions/commit-ideation-content/handler.ts",
    "supabase/functions/commit-ideation-content/index.ts",
    "supabase/functions/_shared/ideation/commit/targets.ts",
    "supabase/functions/_shared/ideation/commit/eligibility.ts",
    "supabase/functions/_shared/ideation/commit/configuration.ts",
  ];
  for (const file of files) {
    const source = stripComments(await readFile(file, "utf8"));
    for (const forbidden of ["anthropic", "openai", "callAnthropic", "Anthropic", "OpenAI"]) {
      assert.equal(source.includes(forbidden), false, `${file} must not reference ${forbidden}`);
    }
    // Nothing in the import graph may reach a provider adapter either.
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    for (const specifier of imports) {
      assert.equal(/anthropic|openai/i.test(specifier), false, `${file} imports ${specifier}`);
    }
  }
});

test("Stage 4 writes no prohibited operational domain", async () => {
  const files = await readdir("supabase/functions/_shared/ideation/commit");
  const sources = await Promise.all([
    ...files.map((file) => readFile(`supabase/functions/_shared/ideation/commit/${file}`, "utf8")),
    readFile("supabase/functions/commit-ideation-content/handler.ts", "utf8"),
    readFile("supabase/functions/commit-ideation-content/index.ts", "utf8"),
  ]);
  const combined = sources.map(stripComments).join("\n");
  for (const table of ["ads_master", "client_production_briefs", "client_assets", "client_distribution_records", "client_analytics_records", "video_projects", "video_shots"]) {
    // The prohibition list itself names them; nothing else may.
    const occurrences = combined.split(new RegExp(`\\b${table}\\b`)).length - 1;
    const inManifest = IDEATION_COMMIT_PROHIBITED_TARGETS.includes(table) ? 1 : 0;
    assert.ok(
      occurrences <= inManifest,
      `${table} appears ${occurrences} times outside the prohibition manifest`,
    );
  }
});

test("the Stage 4 migration writes only the two canonical masters and calendar_cells", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const inserts = [...sql.matchAll(/insert\s+into\s+public\.(\w+)/gi)].map((match) => match[1]);
  const allowed = new Set([
    "organic_master",
    "story_master",
    "calendar_cells",
    "client_ideation_commit_runs",
    "client_ideation_commit_items",
    "activity_log",
  ]);
  for (const table of inserts) {
    assert.equal(allowed.has(table), true, `Stage 4 must not insert into ${table}`);
  }
  assert.equal(inserts.includes("ads_master"), false);
});

test("the Stage 4 migration alters no operational or frozen table", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const altered = [...sql.matchAll(/alter\s+table\s+public\.(\w+)/gi)].map((match) => match[1]);
  // The one additive change to a Stage 3 table is the composite unique key a
  // commit item needs for its ownership foreign key.
  assert.deepEqual(new Set(altered), new Set([
    "client_ideation_calendar_proposal_slots",
    "client_ideation_commit_runs",
    "client_ideation_commit_items",
  ]));
  for (const frozen of ["organic_master", "story_master", "calendar_cells", "client_context_files", "client_execution_files", "playbooks", "playbook_runs", "ads_master"]) {
    assert.equal(altered.includes(frozen), false, `${frozen} must not be altered`);
  }
});

test("no earlier stage imports the Stage 4 commit runtime", async () => {
  // The dependency runs one way only: Stage 4 reads Stage 1-3 output, and no
  // earlier stage may reach the one module that can write operational content.
  for (const fn of ["run-ideation", "score-ideation-candidates", "create-ideation-calendar-proposal"]) {
    const files = await readdir(`supabase/functions/${fn}`);
    const source = (await Promise.all(
      files.map((file) => readFile(`supabase/functions/${fn}/${file}`, "utf8")),
    )).join("\n");
    assert.equal(/ideation\/commit\//.test(source), false, `${fn} must not import Stage 4 modules`);
    assert.equal(/commit_ideation_content/.test(source), false, `${fn} must not call the Stage 4 RPC`);
  }
});

test("Stage 4 depends on neither playbooks nor playbook_runs", async () => {
  const sources = await Promise.all([
    readFile("supabase/functions/commit-ideation-content/handler.ts", "utf8"),
    readFile("supabase/functions/commit-ideation-content/index.ts", "utf8"),
    readFile(MIGRATION, "utf8"),
    readFile("src/lib/ideation-commit-view.ts", "utf8"),
  ]);
  for (const source of sources) {
    for (const table of ["playbooks", "playbook_runs"]) {
      assert.equal(new RegExp(`\\b${table}\\b`).test(source), false);
    }
  }
});

test("the commit RPC and its audit helpers are service-role only", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  for (const fn of ["commit_ideation_content", "record_ideation_commit_failure", "log_ideation_commit_replay", "ideation_commit_target"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`, "i"));
  }
});

test("every Stage 4 SECURITY DEFINER function pins its search_path", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const definers = [...sql.matchAll(/security\s+definer\s+set\s+search_path\s*=\s*public/gi)];
  assert.equal(definers.length, 3, "commit, failure audit, and replay audit");
  assert.equal(/security\s+definer(?!\s+set\s+search_path)/i.test(sql.replace(/security\s+definer\s+set\s+search_path\s*=\s*public/gi, "")), false);
});

test("commit tables enable RLS with staff-select-only policies", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  for (const table of ["client_ideation_commit_runs", "client_ideation_commit_items"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from anon, authenticated`, "i"));
    assert.match(sql, new RegExp(`grant select on public\\.${table} to authenticated`, "i"));
  }
  const policies = [...sql.matchAll(/create policy [\w_]+\s+on public\.client_ideation_commit_\w+ for (\w+)/gi)]
    .map((match) => match[1].toLowerCase());
  assert.deepEqual(policies, ["select", "select"], "no insert, update, or delete policy exists");
});

test("committed masters use the canonical unapproved review state", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const masterInserts = sql.split(/insert into public\.(?:organic_master|story_master)/i).slice(1);
  assert.equal(masterInserts.length, 2);
  for (const block of masterInserts) {
    const values = block.slice(0, block.indexOf("returning id"));
    assert.equal(values.includes("'needs_review'"), true);
    assert.equal(values.includes("'idea'"), true);
    assert.equal(/'approved'/.test(values), false, "a committed master is never auto-approved");
  }
});

test("Stage 4 reuses the existing canonical reference allocator", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.match(sql, /public\.allocate_phase3_ref\(/);
  // Stage 4 must not define its own competing allocator.
  assert.equal(/create\s+(or replace\s+)?function\s+public\.allocate/i.test(sql), false);
});

test("the Ideation display reference is never used as an operational ref", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  assert.equal(sql.includes("candidate_display_reference"), false);
  assert.equal(sql.includes("IDEATION/"), false);
});

test("the committed Story type is the neutral canonical default, and implies nothing stronger", async () => {
  const stage5 = await readFile(
    "supabase/migrations/20260731000041_ideation_stage5_authority_race.sql",
    "utf8",
  );
  // story_master.story_type is one of daily|sequence|poll|dm_prompt|proof|offer|
  // bts|faq. Only the neutral default is ever written: an Ideation candidate
  // carries no story type, and approved authority defines no deterministic rule
  // for choosing one, so anything else would assert meaning nobody approved.
  const storyInsert = stage5.slice(
    stage5.indexOf("insert into public.story_master"),
    stage5.indexOf("returning id into v_master_id", stage5.indexOf("insert into public.story_master")),
  );
  assert.match(storyInsert, /'daily'/);
  for (const stronger of ["sequence", "poll", "dm_prompt", "proof", "offer", "bts", "faq"]) {
    assert.equal(
      new RegExp(`'${stronger}'`).test(storyInsert),
      false,
      `${stronger} implies meaning no approved authority established`,
    );
  }
  // The choice is recorded in provenance as a default, not as derived authority.
  assert.match(stage5, /'story_type_source', case when v_slot\.master_table = 'story_master'/);
  assert.match(stage5, /'neutral_canonical_default'/);
  // It matches the Phase 3 fallback exactly, so Ideation introduces no new rule.
  const phase3 = await readFile("supabase/functions/_shared/phase3-scope.ts", "utf8");
  assert.match(phase3, /story_type: str\(row, "story_type"\) \?\? "daily"/);
  // Committed Story content still enters normal review.
  assert.match(storyInsert, /'needs_review'/);
});

test("Stage 5 closes the Ideation system and starts no Stage 6 or next feature", async () => {
  // Stage 5 is the final Ideation stage. It adds one forward migration and no
  // new Edge Function; there is no Stage 6, and no work has begun on the
  // features that come after Ideation.
  const functions = await readdir("supabase/functions");
  for (const name of functions) {
    assert.equal(/stage-?6/i.test(name), false, name);
    assert.equal(/proof-upload|website-build|paid-distribution-build/i.test(name), false, name);
  }
  const migrations = await readdir("supabase/migrations");
  const stage5 = migrations.filter((name) => /ideation_stage5/i.test(name));
  assert.equal(stage5.length, 1, "exactly one Stage 5 forward migration exists");
  for (const name of migrations) {
    assert.equal(/stage6|stage_6/i.test(name), false, name);
  }
  // The deployed Stage 4 migration is never edited in place.
  const stage4 = await readFile("supabase/migrations/20260730000040_ideation_stage4_commit_content.sql", "utf8");
  assert.match(stage4, /create table public\.client_ideation_commit_runs/);
  assert.equal(/for share/i.test(stage4), false, "the authority lock belongs to the Stage 5 forward migration");
});

test("IDEATION-D1 remains documented as open and deferred to Stage 5", async () => {
  const doc = await readFile("docs/AA_IDEATION_STAGE_4_COMMIT_CONTENT.md", "utf8");
  assert.match(doc, /IDEATION-D1/);
  assert.match(doc, /still open|not\s+resolved/i);
  assert.match(doc, /Stage 5/);
});
