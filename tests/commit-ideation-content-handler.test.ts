// Ideation Stage 4 — Edge Function handler behaviour.
//
// The persistence layer is injected, so every request path is exercised without
// a database and without any provider call. The fake mirrors production
// semantics: the RPC is atomic, so a rejection creates nothing at all.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyCommitDatabaseError,
  commitFailurePayload,
  createCommitHandler,
  isRetryableCommitFailure,
  type CommitBundle,
  type CommitPersistence,
} from "../supabase/functions/commit-ideation-content/handler.ts";

const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROPOSAL = "33333333-3333-4333-8333-333333333333";
const CYCLE = "11111111-1111-4111-8111-111111111111";
const SCORING = "22222222-2222-4222-8222-222222222222";
const HASH = (seed: string) => (seed.repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, "b");

const ASSETS = ["reel", "carousel", "static", "story"] as const;
const ROW_TYPES: Record<string, string> = {
  reel: "reel",
  carousel: "carousels",
  static: "feed_posts",
  story: "stories",
};

interface FakeState {
  proposalStatus: string;
  editRevision: number;
  supersededByCount: number;
  completedRunId: string | null;
  calendarDigest: string;
  rpcError: string | null;
  authorityDrift: boolean;
  masterRows: number;
  calendarRows: number;
  commitItems: number;
  commitCalls: number;
  failureCalls: number;
  replayCalls: number;
}

function createFake(overrides: Partial<FakeState> = {}) {
  const state: FakeState = {
    proposalStatus: "approved",
    editRevision: 3,
    supersededByCount: 0,
    completedRunId: null,
    calendarDigest: HASH("4"),
    rpcError: null,
    authorityDrift: false,
    masterRows: 0,
    calendarRows: 0,
    commitItems: 0,
    commitCalls: 0,
    failureCalls: 0,
    replayCalls: 0,
    ...overrides,
  };

  const slots = ASSETS.map((assetType, index) => ({
    id: `44444444-4444-4444-8444-44444444444${index}`,
    client_id: CLIENT,
    proposal_id: PROPOSAL,
    ideation_cycle_id: CYCLE,
    scoring_run_id: SCORING,
    proposal_slot_key: `2026-08-0${index + 1}:${assetType}:1`,
    proposed_date: `2026-08-0${index + 1}`,
    period_start: "2026-08-01",
    period_end: "2026-08-07",
    required_asset_type: assetType,
    calendar_row_type: ROW_TYPES[assetType],
    candidate_id: `55555555-5555-4555-8555-55555555555${index}`,
    candidate_score_id: `66666666-6666-4666-8666-66666666666${index}`,
    candidate_asset_type_snapshot: assetType,
    candidate_content_hash: HASH(String(index + 1)),
    candidate_rank_snapshot: index + 1,
    candidate_score_snapshot: 90 - index,
    conflict_status: "clear",
  }));

  const persistence: CommitPersistence = {
    async loadProposalBundle() {
      return {
        proposal: {
          id: PROPOSAL,
          client_id: CLIENT,
          ideation_cycle_id: CYCLE,
          scoring_run_id: SCORING,
          status: state.proposalStatus,
          proposal_version: 1,
          edit_revision: state.editRevision,
          expected_slot_count: 4,
          assigned_slot_count: 4,
          unassigned_candidate_count: 0,
          unresolved_conflict_count: 0,
          conflict_count: 0,
          approved_at: "2026-07-30T10:00:00Z",
          approved_by: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          configuration_hash: HASH("3"),
          calendar_conflict_digest: HASH("4"),
          authority_snapshot: { authority_hash: HASH("5") },
          period_start: "2026-08-01",
          period_end: "2026-08-07",
        },
        slots,
        supersededByCount: state.supersededByCount,
      };
    },
    async loadCycle() {
      return {
        id: CYCLE,
        client_id: CLIENT,
        status: "completed",
        expected_candidate_count: 4,
        candidate_count: 4,
        shortfall_count: 0,
        input_hash: HASH("1"),
        period_start: "2026-08-01",
        period_end: "2026-08-07",
      };
    },
    async loadScoringRun() {
      return {
        id: SCORING,
        client_id: CLIENT,
        ideation_cycle_id: CYCLE,
        status: "completed",
        expected_candidate_count: 4,
        scored_candidate_count: 4,
        failed_candidate_count: 0,
        configuration_hash: HASH("2"),
      };
    },
    async loadCandidates() {
      return ASSETS.map((assetType, index) => ({
        id: `55555555-5555-4555-8555-55555555555${index}`,
        client_id: CLIENT,
        ideation_cycle_id: CYCLE,
        asset_type: assetType,
        working_title: `Candidate ${index}`,
        hook: `Hook ${index}`,
        core_message: `Core ${index}`,
        psychological_angle: `Angle ${index}`,
        cta: `CTA ${index}`,
        input_hash: HASH(String(index + 1)),
      }));
    },
    async loadScores() {
      return ASSETS.map((_, index) => ({
        id: `66666666-6666-4666-8666-66666666666${index}`,
        client_id: CLIENT,
        scoring_run_id: SCORING,
        candidate_id: `55555555-5555-4555-8555-55555555555${index}`,
        rank: index + 1,
        overall_score: 90 - index,
        candidate_content_hash: HASH(String(index + 1)),
      }));
    },
    async loadAuthorityIdentities() {
      return [{ id: "f1", version: 2, classification: "context", hash: HASH("7") }];
    },
    async currentCalendarDigest() {
      return state.calendarDigest;
    },
    async findCompletedCommitRun() {
      return state.completedRunId;
    },
    async commitContent() {
      state.commitCalls += 1;
      if (state.rpcError) return { data: null, error: { message: state.rpcError } };
      // The real RPC is one transaction: it either creates everything or nothing.
      state.masterRows += 4;
      state.calendarRows += 4;
      state.commitItems += 4;
      state.completedRunId = "run-1";
      return { data: { replayed: false, commit_run_id: "run-1" }, error: null };
    },
    async recordFailure() {
      state.failureCalls += 1;
      return { data: null, error: null };
    },
    async logReplay() {
      state.replayCalls += 1;
      return { data: null, error: null };
    },
    async fetchCommitBundle(commitRunId): Promise<CommitBundle> {
      return {
        run: {
          id: commitRunId,
          status: "completed",
          committed_item_count: 4,
          organic_item_count: 3,
          story_item_count: 1,
          expected_item_count: 4,
          failed_item_count: 0,
        },
        items: ASSETS.map((assetType, index) => ({
          id: `item-${index}`,
          operational_ref: `AUG0${index + 1}-XX-00${index + 1}`,
          asset_type: assetType,
          target_master_table: assetType === "story" ? "story_master" : "organic_master",
        })),
      };
    },
  };

  return { state, persistence };
}

function handlerWith(
  fake: ReturnType<typeof createFake>,
  access: { ok: true; userId: string; role: string } | { ok: false; status: number; code: string; message: string } =
    { ok: true, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "admin" },
) {
  return createCommitHandler({
    authorize: async () => access,
    createPersistence: () => fake.persistence,
    verifyAuthority: async () => fake.state.authorityDrift
      ? { ok: false as const, message: "Authority 02_Avatar.md content changed since this cycle was generated." }
      : { ok: true as const },
  });
}

function request(body: unknown, headers: Record<string, string> = { Authorization: "Bearer token" }): Request {
  return new Request("https://example.test/commit-ideation-content", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validBody = {
  client_id: CLIENT,
  proposal_id: PROPOSAL,
  expected_edit_revision: 3,
  confirm_commit: true,
};

/* -------------------------------------------------------------- happy path */

test("a confirmed commit creates every operational row exactly once", async () => {
  const fake = createFake();
  const response = await handlerWith(fake)(request(validBody));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.committed, true);
  assert.equal(body.replayed, false);
  assert.equal(body.commit.committed_item_count, 4);
  assert.equal(fake.state.masterRows, 4);
  assert.equal(fake.state.calendarRows, 4);
  assert.equal(fake.state.commitItems, 4);
  assert.equal(fake.state.failureCalls, 0);
});

test("a completed commit replays as a success and creates nothing new", async () => {
  const fake = createFake({ completedRunId: "run-1" });
  const response = await handlerWith(fake)(request(validBody));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.replayed, true);
  assert.equal(body.commit_run_id, "run-1");
  assert.equal(fake.state.commitCalls, 0, "the commit RPC is never invoked again");
  assert.equal(fake.state.masterRows, 0);
  assert.equal(fake.state.calendarRows, 0);
  assert.equal(fake.state.commitItems, 0);
  assert.equal(fake.state.replayCalls, 1, "the replay is logged for audit");
});

test("a second identical request after a commit still creates nothing", async () => {
  const fake = createFake();
  const handler = handlerWith(fake);
  await handler(request(validBody));
  const second = await handler(request(validBody));
  const body = await second.json();
  assert.equal(body.ok, true);
  assert.equal(body.replayed, true);
  assert.equal(fake.state.commitCalls, 1);
  assert.equal(fake.state.masterRows, 4);
  assert.equal(fake.state.calendarRows, 4);
  assert.equal(fake.state.commitItems, 4);
});

/* ------------------------------------------------------------- validation */

test("a non-POST method is refused", async () => {
  const fake = createFake();
  const response = await handlerWith(fake)(
    new Request("https://example.test/commit-ideation-content", { method: "GET" }),
  );
  assert.equal(response.status, 405);
  assert.equal(fake.state.commitCalls, 0);
});

test("a malformed body is refused before any load", async () => {
  const fake = createFake();
  const response = await handlerWith(fake)(request("not json"));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "MALFORMED_REQUEST");
  assert.equal(fake.state.commitCalls, 0);
});

test("an unexpected field is rejected rather than ignored", async () => {
  const fake = createFake();
  const response = await handlerWith(fake)(request({ ...validBody, configuration_hash: HASH("9") }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "MALFORMED_REQUEST");
  assert.match(body.error.message, /configuration_hash/);
  assert.equal(fake.state.commitCalls, 0);
});

test("caller-supplied content, refs, and targets are all rejected", async () => {
  const fake = createFake();
  for (const field of [
    "candidate_id", "candidate_ids", "operational_ref", "target_master_table",
    "proposed_date", "master_payload", "calendar_payload", "role", "user_role", "approved_by",
  ]) {
    const response = await handlerWith(fake)(request({ ...validBody, [field]: "x" }));
    assert.equal(response.status, 400, field);
    assert.equal(fake.state.commitCalls, 0);
  }
});

test("a missing or non-integer expected_edit_revision is refused", async () => {
  const fake = createFake();
  for (const value of [undefined, "3", 3.5, -1]) {
    const body: Record<string, unknown> = { ...validBody };
    if (value === undefined) delete body.expected_edit_revision;
    else body.expected_edit_revision = value;
    const response = await handlerWith(fake)(request(body));
    assert.equal(response.status, 400);
    assert.equal(fake.state.commitCalls, 0);
  }
});

test("a commit without explicit confirmation is refused", async () => {
  const fake = createFake();
  const response = await handlerWith(fake)(request({ ...validBody, confirm_commit: false }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error.code, "COMMIT_NOT_CONFIRMED");
  assert.equal(fake.state.commitCalls, 0);
});

test("an invalid client_id or proposal_id is refused before authorization", async () => {
  const fake = createFake();
  let authorizeCalls = 0;
  const handler = createCommitHandler({
    authorize: async () => {
      authorizeCalls += 1;
      return { ok: true as const, userId: "u", role: "admin" };
    },
    createPersistence: () => fake.persistence,
    verifyAuthority: async () => ({ ok: true as const }),
  });
  const response = await handler(request({ ...validBody, proposal_id: "not-a-uuid" }));
  assert.equal(response.status, 400);
  assert.equal(authorizeCalls, 0);
});

/* --------------------------------------------------------- authorization */

test("an unauthenticated caller is refused and nothing is loaded", async () => {
  const fake = createFake();
  const handler = handlerWith(fake, {
    ok: false, status: 401, code: "NOT_AUTHENTICATED", message: "A bearer token is required.",
  });
  const response = await handler(request(validBody, {}));
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error.code, "NOT_AUTHENTICATED");
  assert.equal(fake.state.commitCalls, 0);
});

test("an unsupported role is refused", async () => {
  const fake = createFake();
  const handler = handlerWith(fake, {
    ok: false, status: 403, code: "STAFF_ROLE_REQUIRED", message: "Ideation requires an admin or account manager role.",
  });
  const response = await handler(request(validBody));
  assert.equal(response.status, 403);
  assert.equal(fake.state.commitCalls, 0);
});

test("a caller without access to the client is refused", async () => {
  const fake = createFake();
  const handler = handlerWith(fake, {
    ok: false, status: 403, code: "CLIENT_ACCESS_DENIED", message: "The caller cannot access this client.",
  });
  const response = await handler(request(validBody));
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error.code, "FORBIDDEN_CLIENT");
  assert.equal(fake.state.commitCalls, 0);
});

test("authorization runs before the commit is confirmed", async () => {
  // An unauthorised caller sending an unconfirmed body still gets the auth
  // failure: the body is never the reason a caller learns about a proposal.
  const fake = createFake();
  const handler = handlerWith(fake, {
    ok: false, status: 403, code: "STAFF_ROLE_REQUIRED", message: "denied",
  });
  const response = await handler(request({ ...validBody, confirm_commit: false }));
  assert.equal(response.status, 403);
});

/* --------------------------------------------------------- eligibility */

test("an unapproved proposal is refused with no operational write", async () => {
  const fake = createFake({ proposalStatus: "draft" });
  const response = await handlerWith(fake)(request(validBody));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "PROPOSAL_NOT_APPROVED");
  assert.equal(fake.state.commitCalls, 0);
  assert.equal(fake.state.masterRows, 0);
});

test("a superseded proposal is refused", async () => {
  const fake = createFake({ supersededByCount: 1 });
  const response = await handlerWith(fake)(request(validBody));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "PROPOSAL_SUPERSEDED");
  assert.equal(fake.state.commitCalls, 0);
});

test("a stale revision is refused and reports the current revision", async () => {
  const fake = createFake({ editRevision: 5 });
  const response = await handlerWith(fake)(request(validBody));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "PROPOSAL_REVISION_CONFLICT");
  assert.equal(body.error.current_edit_revision, 5);
  assert.equal(fake.state.commitCalls, 0);
});

test("authority drift is refused before the transaction opens", async () => {
  const fake = createFake({ authorityDrift: true });
  const response = await handlerWith(fake)(request(validBody));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "AUTHORITY_SNAPSHOT_MISMATCH");
  assert.equal(fake.state.commitCalls, 0);
  assert.equal(fake.state.masterRows, 0);
});

test("Calendar drift is refused before the transaction opens", async () => {
  const fake = createFake({ calendarDigest: HASH("9") });
  const response = await handlerWith(fake)(request(validBody));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "CALENDAR_SNAPSHOT_STALE");
  assert.equal(body.error.retryable, false);
  assert.equal(fake.state.commitCalls, 0);
});

/* ------------------------------------------------- database failure mapping */

test("a rolled-back transaction reports a typed failure and creates nothing", async () => {
  const fake = createFake({ rpcError: 'ERROR: IDEATION_COMMIT_CALENDAR_CONFLICT: 2026-08-02:reel:1' });
  const response = await handlerWith(fake)(request(validBody));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "CALENDAR_CONFLICT");
  assert.equal(body.error.failed_proposal_slot_key, "2026-08-02:reel:1");
  assert.equal(body.committed, false);
  assert.equal(fake.state.masterRows, 0);
  assert.equal(fake.state.calendarRows, 0);
  assert.equal(fake.state.commitItems, 0);
  assert.equal(fake.state.failureCalls, 1, "the attempt is recorded for audit");
});

test("every documented database marker maps to its typed code", () => {
  const cases: Array<[string, string, number]> = [
    ["IDEATION_COMMIT_PROPOSAL_NOT_FOUND", "PROPOSAL_NOT_FOUND", 404],
    ["IDEATION_COMMIT_PROPOSAL_SUPERSEDED", "PROPOSAL_SUPERSEDED", 409],
    ["IDEATION_COMMIT_PROPOSAL_NOT_APPROVED", "PROPOSAL_NOT_APPROVED", 409],
    ["IDEATION_COMMIT_PROPOSAL_REVISION_CONFLICT", "PROPOSAL_REVISION_CONFLICT", 409],
    ["IDEATION_COMMIT_CYCLE_NOT_ELIGIBLE", "CYCLE_NOT_ELIGIBLE", 409],
    ["IDEATION_COMMIT_SCORING_RUN_NOT_ELIGIBLE", "SCORING_RUN_NOT_ELIGIBLE", 409],
    ["IDEATION_COMMIT_AUTHORITY_SNAPSHOT_MISMATCH", "AUTHORITY_SNAPSHOT_MISMATCH", 409],
    ["IDEATION_COMMIT_CANDIDATE_SNAPSHOT_MISMATCH", "CANDIDATE_SNAPSHOT_MISMATCH", 409],
    ["IDEATION_COMMIT_SCORE_SNAPSHOT_MISMATCH", "SCORE_SNAPSHOT_MISMATCH", 409],
    ["IDEATION_COMMIT_CALENDAR_SNAPSHOT_STALE", "CALENDAR_SNAPSHOT_STALE", 409],
    ["IDEATION_COMMIT_UNSUPPORTED_ASSET_TYPE", "UNSUPPORTED_ASSET_TYPE", 409],
    ["IDEATION_COMMIT_MASTER_MAPPING_INVALID", "MASTER_MAPPING_INVALID", 409],
    ["IDEATION_COMMIT_REQUIRED_FIELD_MISSING", "REQUIRED_FIELD_MISSING", 409],
    ["IDEATION_COMMIT_REFERENCE_ALLOCATION_FAILED", "REFERENCE_ALLOCATION_FAILED", 409],
    ["IDEATION_COMMIT_RECONCILIATION_FAILED", "RECONCILIATION_FAILED", 500],
    ["IDEATION_COMMIT_FORBIDDEN", "COMMIT_FORBIDDEN", 403],
  ];
  for (const [marker, code, status] of cases) {
    const classified = classifyCommitDatabaseError(`ERROR: ${marker}`);
    assert.equal(classified.code, code, marker);
    assert.equal(classified.status, status, marker);
  }
});

test("a serialization failure or deadlock is a concurrent-commit conflict", () => {
  for (const raw of ["could not serialize access", "deadlock detected"]) {
    assert.equal(classifyCommitDatabaseError(raw).code, "CONCURRENT_COMMIT_CONFLICT");
  }
});

test("an unrecognised database error never leaks its raw text", async () => {
  const fake = createFake({
    rpcError: 'duplicate key value violates unique constraint "organic_master_client_id_ref_key" DETAIL: Key (ref)=(AUG01-RL-001)',
  });
  const response = await handlerWith(fake)(request(validBody));
  const body = await response.json();
  assert.equal(body.error.code, "COMMIT_PERSISTENCE_FAILED");
  const serialized = JSON.stringify(body);
  for (const leaked of ["duplicate key", "organic_master_client_id_ref_key", "DETAIL", "AUG01-RL-001"]) {
    assert.equal(serialized.includes(leaked), false, `${leaked} must not be exposed`);
  }
});

test("a thrown persistence error is reported without a stack trace or token", async () => {
  const fake = createFake();
  fake.persistence.loadProposalBundle = async () => {
    throw new Error("connect ECONNREFUSED\n    at Object.<anonymous> (/app/index.ts:1:1)\nBearer eyJhbGciOiJIUzI1NiJ9abcdefghijklmnop");
  };
  const response = await handlerWith(fake)(request(validBody));
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error.code, "COMMIT_PERSISTENCE_FAILED");
  assert.equal(body.error.message.includes("at Object"), false);
  assert.equal(body.error.message.includes("eyJhbGciOiJIUzI1NiJ9"), false);
});

/* -------------------------------------------------------- failure contract */

test("only genuine infrastructure faults are retryable", () => {
  assert.equal(isRetryableCommitFailure("COMMIT_PERSISTENCE_FAILED"), true);
  for (const code of [
    "CALENDAR_SNAPSHOT_STALE", "CANDIDATE_SNAPSHOT_MISMATCH", "UNSUPPORTED_ASSET_TYPE",
    "PROPOSAL_REVISION_CONFLICT", "PROPOSAL_ALREADY_COMMITTED", "RECONCILIATION_FAILED",
  ]) {
    assert.equal(isRetryableCommitFailure(code), false, code);
  }
});

test("the failure payload carries the full documented contract", () => {
  const payload = commitFailurePayload({
    code: "CALENDAR_CONFLICT",
    message: "blocked",
    proposalId: PROPOSAL,
    cycleId: CYCLE,
    scoringRunId: SCORING,
    expectedItemCount: 4,
    currentEditRevision: 3,
    failedProposalSlotKey: "2026-08-01:reel:1",
  });
  for (const key of [
    "code", "message", "retryable", "commit_run_id", "proposal_id", "ideation_cycle_id",
    "scoring_run_id", "commit_status", "expected_item_count", "committed_item_count",
    "organic_item_count", "story_item_count", "failed_item_count", "current_edit_revision",
    "failed_proposal_slot_key", "warnings",
  ]) {
    assert.ok(key in payload, `${key} is missing from the failure contract`);
  }
  assert.equal(payload.committed_item_count, 0, "a failed commit committed nothing");
});

test("CORS preflight is answered without touching persistence", async () => {
  const fake = createFake();
  const response = await handlerWith(fake)(
    new Request("https://example.test/commit-ideation-content", { method: "OPTIONS" }),
  );
  assert.equal(response.status, 200);
  assert.equal(fake.state.commitCalls, 0);
});
