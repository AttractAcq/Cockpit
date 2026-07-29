// Ideation Stage 3 — proposal handler behaviour: authorization, eligibility,
// batching, retries, leases, replay, editing, conflict refresh, and approval.
// The provider is fully injected; no real call is ever made.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createProposalHandler,
  isRetryableProposalFailure,
  type CreateProposalDependencies,
  type ProposalBundle,
  type ProposalPersistence,
  type RpcResult,
} from "../supabase/functions/create-ideation-calendar-proposal/handler.ts";
import {
  IDEATION_PROPOSAL_BATCH_POLICY,
} from "../supabase/functions/_shared/ideation/proposal/config.ts";
import type {
  ProposalCandidateRow,
  ProposalCycleRow,
  ProposalScoreRow,
  ProposalScoringRunRow,
} from "../supabase/functions/_shared/ideation/proposal/eligibility.ts";
import type { CalendarOccupancyRow } from "../supabase/functions/_shared/ideation/proposal/conflicts.ts";

const CLIENT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const CYCLE_ID = "30000000-0000-4000-8000-000000000001";
const SCORING_RUN_ID = "40000000-0000-4000-8000-000000000001";
const PROPOSAL_ID = "50000000-0000-4000-8000-000000000001";
const PREVIOUS_PROPOSAL_ID = "50000000-0000-4000-8000-0000000000ff";
const PERIOD_START = "2026-07-01";
const PERIOD_END = "2026-07-07";
const CANDIDATE_COUNT = 12;

function candidateId(index: number): string {
  return `60000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`;
}

const RUNS = [
  { id: "70000000-0000-4000-8000-000000000001", client_id: CLIENT_ID, ideation_cycle_id: CYCLE_ID, technique_slug: "review-mined-pain-language" },
  { id: "70000000-0000-4000-8000-000000000002", client_id: CLIENT_ID, ideation_cycle_id: CYCLE_ID, technique_slug: "competitor-objections" },
];

// 6 reels on technique 2, 6 stories on technique 3.
function candidateRows(): ProposalCandidateRow[] {
  return Array.from({ length: CANDIDATE_COUNT }, (_, index) => {
    const isReel = index < 6;
    return {
      id: candidateId(index),
      client_id: CLIENT_ID,
      ideation_cycle_id: CYCLE_ID,
      technique_run_id: isReel ? RUNS[0].id : RUNS[1].id,
      candidate_index: isReel ? index : index - 6,
      asset_type: isReel ? "reel" : "story",
      working_title: `Title ${index}`,
      hook: "Hook",
      core_message: "Message",
      psychological_angle: null,
      cta: "CTA",
      evidence_references: [{
        evidence_type: "paraphrase",
        source_ids: ["context:c1:v1"],
        source_ref: "02_Avatar.md",
        source_url: "aa-authority://client/c/context/c1",
        claim: `Title ${index}`,
        support_span: "Span",
        support_note: "Note",
      }],
      input_hash: "a".repeat(64),
    };
  });
}

function scoreRows(): ProposalScoreRow[] {
  return Array.from({ length: CANDIDATE_COUNT }, (_, index) => ({
    id: `80000000-0000-4000-8000-0000000000${String(index).padStart(2, "0")}`,
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    scoring_run_id: SCORING_RUN_ID,
    candidate_id: candidateId(index),
    candidate_content_hash: "c".repeat(64),
    candidate_evidence_hash: "d".repeat(64),
    overall_score: 95 - index,
    priority_band: "high",
    rank: index + 1,
    execution_plan_alignment: 8,
    proof_and_evidence_strength: 7,
    audience_and_pain_relevance: 7,
    strengths: ["Strong"],
    risks: [],
  }));
}

function cycleFixture(): ProposalCycleRow {
  return {
    id: CYCLE_ID,
    client_id: CLIENT_ID,
    status: "completed",
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    expected_candidate_count: CANDIDATE_COUNT,
    candidate_count: CANDIDATE_COUNT,
    shortfall_count: 0,
    slot_allocation: {
      "review-mined-pain-language": ["reel", "reel", "reel", "reel", "reel", "reel"],
      "competitor-objections": ["story", "story", "story", "story", "story", "story"],
    },
    quantity_plan: { total: CANDIDATE_COUNT },
    configuration_snapshot: { authority: { context: [], strategic_playbooks: [], execution: [] } },
    input_hash: "b".repeat(64),
  };
}

function scoringRunFixture(): ProposalScoringRunRow {
  return {
    id: SCORING_RUN_ID,
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    status: "completed",
    expected_candidate_count: CANDIDATE_COUNT,
    scored_candidate_count: CANDIDATE_COUNT,
    failed_candidate_count: 0,
    configuration_hash: "e".repeat(64),
    candidate_snapshot: candidateRows().map((candidate) => ({
      candidate_id: candidate.id,
      content_hash: "c".repeat(64),
      evidence_hash: "d".repeat(64),
    })),
    rubric_slug: "aa.ideation.scoring",
    rubric_version: "aa.ideation.scoring.v1",
  };
}

interface HarnessOptions {
  authorizeRole?: "admin" | "account_manager" | "editor" | "none" | "wrong-client";
  aiConfigured?: boolean;
  cycle?: Partial<ProposalCycleRow> | null;
  scoringRun?: Partial<ProposalScoringRunRow> | null;
  candidates?: ProposalCandidateRow[];
  scores?: ProposalScoreRow[];
  occupancy?: CalendarOccupancyRow[];
  authorityFailure?: { code: string; message: string };
  beginReplay?: "draft" | "approved" | "failed" | "running";
  attemptsExhausted?: boolean;
  beginError?: string;
  batchFailures?: Record<number, { code: string; error: string; retryable: boolean }>;
  preassigned?: string[];
  persistError?: string;
  completeError?: string;
  editError?: string;
  approveError?: string;
  proposalStatus?: string;
  editRevision?: number;
}

interface Harness {
  handler: ReturnType<typeof createProposalHandler>;
  persistence: MemoryPersistence;
  calls: {
    proposeBatch: number;
    beginArgs: Record<string, unknown>[];
    editArgs: Record<string, unknown>[];
    approveArgs: Record<string, unknown>[];
    refreshArgs: Record<string, unknown>[];
    failArgs: Record<string, unknown>[];
    batchSlotCounts: number[];
  };
}

class MemoryPersistence implements ProposalPersistence {
  private options: HarnessOptions;
  private calls: Harness["calls"];
  private assigned = new Map<string, string>();
  proposal: Record<string, unknown>;
  slots: Array<Record<string, unknown>> = [];
  persistCalls = 0;
  completeCalls = 0;
  failCalls = 0;

  constructor(options: HarnessOptions, calls: Harness["calls"]) {
    this.options = options;
    this.calls = calls;
    for (const id of options.preassigned ?? []) this.assigned.set(id, `slot-${id}`);
    this.proposal = {
      id: PROPOSAL_ID,
      client_id: CLIENT_ID,
      ideation_cycle_id: CYCLE_ID,
      scoring_run_id: SCORING_RUN_ID,
      status: options.proposalStatus ?? options.beginReplay ?? "running",
      proposal_version: 1,
      supersedes_proposal_id: null,
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      expected_slot_count: CANDIDATE_COUNT,
      assigned_slot_count: this.assigned.size,
      unassigned_candidate_count: CANDIDATE_COUNT - this.assigned.size,
      conflict_count: 0,
      unresolved_conflict_count: 0,
      attempt_count: 1,
      maximum_attempts: 3,
      retryable: false,
      warnings: [],
      failure_code: options.beginReplay === "failed" ? "PROPOSAL_ATTEMPTS_EXHAUSTED" : null,
      failure_message: options.beginReplay === "failed" ? "Attempts exhausted." : null,
      edit_revision: options.editRevision ?? 0,
      slot_manifest_snapshot: [],
    };
  }

  async loadCycleBundle() {
    return {
      cycle: this.options.cycle === null ? null : { ...cycleFixture(), ...this.options.cycle },
      techniqueRuns: RUNS,
      candidates: this.options.candidates ?? candidateRows(),
    };
  }

  async loadScoringRun() {
    return {
      scoringRun: this.options.scoringRun === null ? null : { ...scoringRunFixture(), ...this.options.scoringRun },
      scores: this.options.scores ?? scoreRows(),
    };
  }

  async loadAuthorityRows() {
    return { contextRows: [], executionRows: [] };
  }

  async loadCalendarOccupancy(): Promise<CalendarOccupancyRow[]> {
    return this.options.occupancy ?? [];
  }

  async clientName() {
    return "Test Client";
  }

  async beginProposal(args: Record<string, unknown>): Promise<RpcResult> {
    this.calls.beginArgs.push(args);
    if (this.options.beginError) return { data: null, error: { message: this.options.beginError } };
    this.proposal.slot_manifest_snapshot = args.p_slot_manifest;
    // Production only materialises slot rows when the proposal is first
    // created; a reclaim leaves existing rows and their assignments intact.
    const manifest = args.p_slot_manifest as Array<Record<string, unknown>>;
    const preassigned = [...this.assigned.keys()];
    const candidateAssetType = (id: string) =>
      candidateRows().find((candidate) => candidate.id === id)!.asset_type;
    this.slots = manifest.map((slot) => ({ ...slot, proposal_id: PROPOSAL_ID, candidate_id: null }));
    for (const candidateIdValue of preassigned) {
      const assetType = candidateAssetType(candidateIdValue);
      const target = this.slots.find((slot) =>
        slot.candidate_id === null && slot.required_asset_type === assetType);
      if (target) {
        target.candidate_id = candidateIdValue;
        this.assigned.set(candidateIdValue, String(target.proposal_slot_key));
      }
    }
    if (this.options.beginReplay) {
      return {
        data: {
          created: false,
          reclaimed: false,
          attempts_exhausted: this.options.attemptsExhausted ?? false,
          proposal: { id: PROPOSAL_ID, status: this.options.beginReplay, attempt_count: 1 },
        },
        error: null,
      };
    }
    return {
      data: { created: true, reclaimed: false, proposal: { id: PROPOSAL_ID, status: "running", attempt_count: 1 } },
      error: null,
    };
  }

  async renewLease(): Promise<RpcResult> {
    return { data: { renewed: true }, error: null };
  }

  async persistBatch(args: Record<string, unknown>): Promise<RpcResult> {
    this.persistCalls += 1;
    if (this.options.persistError) return { data: null, error: { message: this.options.persistError } };
    for (const row of args.p_assignments as Array<Record<string, unknown>>) {
      this.assigned.set(String(row.candidate_id), String(row.proposal_slot_key));
      const slot = this.slots.find((entry) => entry.proposal_slot_key === row.proposal_slot_key);
      if (slot) slot.candidate_id = row.candidate_id;
    }
    this.proposal.assigned_slot_count = this.assigned.size;
    this.proposal.unassigned_candidate_count = CANDIDATE_COUNT - this.assigned.size;
    return { data: { applied: this.assigned.size }, error: null };
  }

  async completeProposal(): Promise<RpcResult> {
    this.completeCalls += 1;
    if (this.options.completeError) return { data: null, error: { message: this.options.completeError } };
    if (this.assigned.size !== CANDIDATE_COUNT) return { data: null, error: { message: "PROPOSAL_INCOMPLETE" } };
    this.proposal.status = "draft";
    return { data: this.proposal, error: null };
  }

  async failProposal(args: Record<string, unknown>): Promise<RpcResult> {
    this.failCalls += 1;
    this.calls.failArgs.push(args);
    const retryable = args.p_retryable === true
      && Number(this.proposal.attempt_count) < Number(this.proposal.maximum_attempts);
    this.proposal.status = retryable ? "retryable" : "failed";
    this.proposal.retryable = retryable;
    this.proposal.failure_code = args.p_failure_code;
    this.proposal.failure_message = args.p_failure_message;
    this.proposal.warnings = args.p_warnings ?? [];
    return { data: this.proposal, error: null };
  }

  async editAssignment(args: Record<string, unknown>): Promise<RpcResult> {
    this.calls.editArgs.push(args);
    if (this.options.editError) return { data: null, error: { message: this.options.editError } };
    this.proposal.edit_revision = Number(this.proposal.edit_revision) + 1;
    return { data: this.proposal, error: null };
  }

  async refreshConflicts(args: Record<string, unknown>): Promise<RpcResult> {
    this.calls.refreshArgs.push(args);
    this.proposal.edit_revision = Number(this.proposal.edit_revision) + 1;
    return { data: this.proposal, error: null };
  }

  async approveProposal(args: Record<string, unknown>): Promise<RpcResult> {
    this.calls.approveArgs.push(args);
    if (this.options.approveError) return { data: null, error: { message: this.options.approveError } };
    this.proposal.status = "approved";
    return { data: this.proposal, error: null };
  }

  async fetchProposalBundle(): Promise<ProposalBundle> {
    return {
      proposal: structuredClone(this.proposal) as ProposalBundle["proposal"],
      slots: structuredClone(this.slots),
    };
  }

  async assignedCandidateIds(): Promise<string[]> {
    return [...this.assigned.keys()];
  }
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const calls: Harness["calls"] = {
    proposeBatch: 0,
    beginArgs: [],
    editArgs: [],
    approveArgs: [],
    refreshArgs: [],
    failArgs: [],
    batchSlotCounts: [],
  };
  const persistence = new MemoryPersistence(options, calls);
  let batchIndex = -1;

  const deps: CreateProposalDependencies = {
    authorize: async (header) => {
      const role = options.authorizeRole ?? "admin";
      if (!header) return { ok: false, status: 401, code: "NOT_AUTHENTICATED", message: "A bearer token is required." };
      if (role === "wrong-client") return { ok: false, status: 403, code: "CLIENT_ACCESS_DENIED", message: "The caller cannot access this client." };
      if (role === "editor" || role === "none") return { ok: false, status: 403, code: "STAFF_ROLE_REQUIRED", message: "Staff role required." };
      return { ok: true, userId: USER_ID, role };
    },
    aiConfigured: () => options.aiConfigured ?? true,
    createPersistence: () => persistence,
    reconstructAuthority: async () => options.authorityFailure
      ? { ok: false, ...options.authorityFailure }
      : {
        ok: true,
        authority: {
          context: [], strategicPlaybooks: [], execution: [],
          verified: { context: [], strategic_playbooks: [], execution: [] },
        },
      },
    buildConfigurationSnapshot: async () => ({
      authority: { context: [], strategic_playbooks: [], execution: [] },
      prompt: { digest: "f".repeat(64) },
    }),
    hashConfiguration: async () => "9".repeat(64),
    proposeBatch: async ({ slots, candidates }) => {
      calls.proposeBatch += 1;
      calls.batchSlotCounts.push(slots.length);
      batchIndex += 1;
      const failure = options.batchFailures?.[batchIndex];
      if (failure) return { ok: false, ...failure, model: "test-model", retried: false };
      const pool = [...candidates];
      return {
        ok: true,
        model: "test-model",
        retried: false,
        assignments: slots.map((slot) => {
          const index = pool.findIndex((candidate) => candidate.asset_type === slot.required_asset_type);
          const candidate = pool.splice(index, 1)[0];
          return {
            proposal_slot_key: slot.proposal_slot_key,
            candidate_id: candidate.candidate_id,
            placement_rationale: "Rationale",
            authority_references: [],
            evidence_references: [],
            warnings: [],
          };
        }),
      };
    },
    selectedModel: () => "test-model",
    randomUUID: () => "aaaaaaaa-0000-4000-8000-000000000001",
  };
  return { handler: createProposalHandler(deps), persistence, calls };
}

function request(token: string | null = "admin", body: unknown = {
  action: "create",
  client_id: CLIENT_ID,
  ideation_cycle_id: CYCLE_ID,
  scoring_run_id: SCORING_RUN_ID,
}): Request {
  return new Request("http://local.test/functions/v1/create-ideation-calendar-proposal", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

async function errorOf(response: Response): Promise<Record<string, unknown>> {
  return (await body(response)).error as Record<string, unknown>;
}

/* ================================================================== */
/* Authorization and request validation                                */
/* ================================================================== */

test("admin and account manager are allowed; every other caller is denied", async () => {
  for (const role of ["admin", "account_manager"] as const) {
    const harness = makeHarness({ authorizeRole: role });
    assert.equal((await harness.handler(request(role))).status, 201, role);
  }
  for (const [role, status, code] of [
    ["editor", 403, "STAFF_ROLE_REQUIRED"],
    ["none", 403, "STAFF_ROLE_REQUIRED"],
    ["wrong-client", 403, "CLIENT_ACCESS_DENIED"],
  ] as const) {
    const harness = makeHarness({ authorizeRole: role });
    const response = await harness.handler(request("token"));
    assert.equal(response.status, status, role);
    assert.equal((await errorOf(response)).code, code, role);
    assert.equal(harness.calls.proposeBatch, 0, role);
    assert.equal(harness.calls.beginArgs.length, 0, role);
  }
  const anonymous = makeHarness();
  assert.equal((await anonymous.handler(request(null))).status, 401);
});

test("unknown request fields and malformed bodies are rejected outright", async () => {
  // A caller cannot smuggle a role, a hash, or an operational identifier.
  for (const field of ["role", "auth_role", "configuration_hash", "calendar_cell_id", "organic_master_id", "status"]) {
    const harness = makeHarness();
    const response = await harness.handler(request("admin", {
      action: "create",
      client_id: CLIENT_ID,
      ideation_cycle_id: CYCLE_ID,
      scoring_run_id: SCORING_RUN_ID,
      [field]: "x",
    }));
    assert.equal(response.status, 400, field);
    assert.equal((await errorOf(response)).code, "UNEXPECTED_REQUEST_FIELD", field);
  }
  for (const [label, payload, code] of [
    ["bad action", { action: "commit", client_id: CLIENT_ID }, "PROPOSAL_ACTION_INVALID"],
    ["bad client", { action: "create", client_id: "nope" }, "CLIENT_ID_INVALID"],
    ["bad cycle", { action: "create", client_id: CLIENT_ID, ideation_cycle_id: "nope", scoring_run_id: SCORING_RUN_ID }, "CYCLE_ID_INVALID"],
    ["bad scoring run", { action: "create", client_id: CLIENT_ID, ideation_cycle_id: CYCLE_ID, scoring_run_id: "nope" }, "SCORING_RUN_ID_INVALID"],
    ["regen without target", { action: "regenerate", client_id: CLIENT_ID, ideation_cycle_id: CYCLE_ID, scoring_run_id: SCORING_RUN_ID }, "REGENERATE_TARGET_INVALID"],
    ["regen target on create", { action: "create", client_id: CLIENT_ID, ideation_cycle_id: CYCLE_ID, scoring_run_id: SCORING_RUN_ID, regenerate_from_proposal_id: PREVIOUS_PROPOSAL_ID }, "REGENERATE_TARGET_INVALID"],
    ["array body", [], "INVALID_REQUEST"],
  ] as const) {
    const harness = makeHarness();
    const response = await harness.handler(request("admin", payload));
    assert.equal(response.status, 400, label);
    assert.equal((await errorOf(response)).code, code, label);
  }
  assert.equal((await makeHarness().handler(new Request("http://x/", { method: "GET" }))).status, 405);
});

/* ================================================================== */
/* Eligibility and authority                                           */
/* ================================================================== */

test("ineligible cycles and scoring runs are rejected before any proposal is created", async () => {
  const cases: Array<[string, HarnessOptions, number, string]> = [
    ["missing cycle", { cycle: null }, 404, "CYCLE_NOT_FOUND"],
    ["other client", { cycle: { client_id: "10000000-0000-4000-8000-0000000000aa" } }, 403, "CYCLE_CLIENT_MISMATCH"],
    ["retryable cycle", { cycle: { status: "retryable" } }, 409, "CYCLE_NOT_ELIGIBLE"],
    ["partial cycle", { cycle: { shortfall_count: 1 } }, 409, "CYCLE_NOT_ELIGIBLE"],
    ["missing scoring run", { scoringRun: null }, 404, "SCORING_RUN_NOT_FOUND"],
    ["incomplete scoring", { scoringRun: { status: "retryable" } }, 409, "SCORING_RUN_NOT_ELIGIBLE"],
    ["scoring shortfall", { scoringRun: { scored_candidate_count: 5 } }, 409, "SCORING_RUN_NOT_ELIGIBLE"],
    ["cross-cycle scoring run", { scoringRun: { ideation_cycle_id: "30000000-0000-4000-8000-0000000000ff" } }, 409, "SCORING_RUN_CYCLE_MISMATCH"],
    ["missing score", { scores: scoreRows().slice(0, 11) }, 409, "SCORE_SET_INVALID"],
    ["duplicate rank", { scores: scoreRows().map((score, index) => index === 1 ? { ...score, rank: 1 } : score) }, 409, "RANKS_INVALID"],
  ];
  for (const [label, options, status, code] of cases) {
    const harness = makeHarness(options);
    const response = await harness.handler(request());
    assert.equal(response.status, status, label);
    const error = await errorOf(response);
    assert.equal(error.code, code, label);
    assert.equal(error.retryable, false, label);
    assert.equal(harness.calls.beginArgs.length, 0, `${label} must not create a proposal`);
    assert.equal(harness.calls.proposeBatch, 0, label);
  }
});

test("drifted authority fails closed before any proposal is created", async () => {
  const harness = makeHarness({
    authorityFailure: {
      code: "AUTHORITY_SNAPSHOT_MISMATCH",
      message: "Authority 02_Avatar.md content changed since this cycle was generated.",
    },
  });
  const response = await harness.handler(request());
  assert.equal(response.status, 409);
  const error = await errorOf(response);
  assert.equal(error.code, "AUTHORITY_SNAPSHOT_MISMATCH");
  assert.equal(error.retryable, false);
  assert.equal(harness.calls.beginArgs.length, 0);
});

test("an unconfigured provider fails closed before any proposal is created", async () => {
  const harness = makeHarness({ aiConfigured: false });
  const response = await harness.handler(request());
  assert.equal(response.status, 503);
  assert.equal((await errorOf(response)).code, "ANTHROPIC_NOT_CONFIGURED");
  assert.equal(harness.calls.beginArgs.length, 0);
});

/* ================================================================== */
/* Generation, batching, and the slot manifest                         */
/* ================================================================== */

test("a full proposal plans an exact manifest, batches, and completes as a draft", async () => {
  const harness = makeHarness();
  const response = await harness.handler(request());
  assert.equal(response.status, 201);
  const payload = await body(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.idempotent_replay, false);

  const beginArgs = harness.calls.beginArgs[0];
  const manifest = beginArgs.p_slot_manifest as Array<Record<string, unknown>>;
  assert.equal(manifest.length, CANDIDATE_COUNT, "manifest matches the candidate count exactly");
  assert.equal(beginArgs.p_expected_slot_count, CANDIDATE_COUNT);
  assert.equal(beginArgs.p_period_start, PERIOD_START);
  assert.equal(beginArgs.p_period_end, PERIOD_END);
  for (const slot of manifest) {
    assert.ok(String(slot.proposed_date) >= PERIOD_START && String(slot.proposed_date) <= PERIOD_END);
  }
  const assetTotals = manifest.reduce((totals, slot) => {
    totals[String(slot.required_asset_type)] = (totals[String(slot.required_asset_type)] ?? 0) + 1;
    return totals;
  }, {} as Record<string, number>);
  assert.deepEqual(assetTotals, { reel: 6, story: 6 }, "asset totals reconcile with the allocation");

  // Every candidate carries a non-operational display reference.
  const snapshot = beginArgs.p_candidate_snapshot as Array<Record<string, unknown>>;
  assert.equal(snapshot.length, CANDIDATE_COUNT);
  for (const entry of snapshot) {
    assert.match(String(entry.display_reference), /^IDEATION\//);
  }

  const expectedBatches = Math.ceil(CANDIDATE_COUNT / IDEATION_PROPOSAL_BATCH_POLICY.batch_size);
  assert.equal(harness.calls.proposeBatch, expectedBatches, "slots are proposed in bounded batches");
  assert.equal(harness.persistence.persistCalls, expectedBatches);
  assert.equal(harness.persistence.completeCalls, 1);
  assert.equal(harness.persistence.failCalls, 0);
  assert.equal((payload.proposal as Record<string, unknown>).status, "draft");
});

test("the proposal identity is server-derived and cannot be supplied by the caller", async () => {
  const harness = makeHarness();
  await harness.handler(request());
  const args = harness.calls.beginArgs[0];
  assert.equal(args.p_configuration_hash, "9".repeat(64), "the hash comes from the server snapshot");
  assert.match(String(args.p_idempotency_key), /^proposal:/);
  assert.ok(String(args.p_idempotency_key).includes(CYCLE_ID));
  assert.ok(String(args.p_idempotency_key).includes(SCORING_RUN_ID));
  assert.equal(args.p_supersedes_proposal_id, null);
  assert.equal(args.p_maximum_attempts, 3);
});

test("Calendar occupancy is read and classified onto the manifest", async () => {
  const harness = makeHarness({
    occupancy: [{
      id: "cal-1",
      date: PERIOD_START,
      row_type: "reel",
      ref: "JUL26-RL-001",
      review_state: "approved",
      updated_at: "2026-07-01T00:00:00.000Z",
    }],
  });
  await harness.handler(request());
  const manifest = harness.calls.beginArgs[0].p_slot_manifest as Array<Record<string, unknown>>;
  const conflicted = manifest.filter((slot) => slot.conflict_status !== "clear");
  assert.ok(conflicted.length >= 1, "an approved Calendar row produces a conflict");
  assert.ok(conflicted.some((slot) => slot.conflict_status === "protected"));
  // The digest is recorded so drift can be detected at approval.
  assert.match(String(harness.calls.beginArgs[0].p_calendar_conflict_digest), /^[0-9a-f]{64}$/);
});

/* ================================================================== */
/* Retry, partial failure, and replay                                  */
/* ================================================================== */

test("successful assignments persist during a partial failure and the proposal is retryable", async () => {
  const harness = makeHarness({
    batchFailures: { 1: { code: "ANTHROPIC_TIMEOUT", error: "Provider timed out.", retryable: true } },
  });
  const response = await harness.handler(request());
  assert.equal(response.status, 504);
  const error = await errorOf(response);
  assert.equal(error.code, "ANTHROPIC_TIMEOUT");
  assert.equal(error.retryable, true);
  assert.equal(isRetryableProposalFailure("ANTHROPIC_TIMEOUT"), true);

  const details = error.details as Record<string, unknown>;
  assert.equal(details.proposal_status, "retryable");
  assert.equal(details.expected_slot_count, CANDIDATE_COUNT);
  assert.ok(Number(details.assigned_slot_count) > 0, "the successful batch was retained");
  assert.ok(Number(details.assigned_slot_count) < CANDIDATE_COUNT);
  assert.equal(details.retry_allowed, true);
  assert.equal(harness.persistence.completeCalls, 0, "a partial proposal is never completed");
  assert.equal((details.warnings as unknown[]).length, 1);
});

test("a retry proposes only the outstanding slots", async () => {
  const preassigned = Array.from({ length: 8 }, (_, index) => candidateId(index));
  const harness = makeHarness({ preassigned });
  const response = await harness.handler(request("admin", {
    action: "retry",
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    scoring_run_id: SCORING_RUN_ID,
  }));
  assert.equal(response.status, 201);
  // Only 4 slots remained open, so a single bounded batch covers them.
  assert.equal(harness.calls.proposeBatch, 1);
  assert.equal(harness.calls.batchSlotCounts[0], 4, "only the outstanding slots are proposed");
  assert.equal(harness.persistence.completeCalls, 1);
});

test("a non-retryable failure is terminal and mixed outcomes stay terminal", async () => {
  const harness = makeHarness({
    batchFailures: { 0: { code: "PROPOSAL_OUTPUT_INVALID", error: "invalid", retryable: false } },
  });
  const response = await harness.handler(request());
  assert.equal(response.status, 502);
  const error = await errorOf(response);
  assert.equal(error.code, "PROPOSAL_OUTPUT_INVALID");
  assert.equal(error.retryable, false);
  assert.equal((error.details as Record<string, unknown>).proposal_status, "failed");

  const mixed = makeHarness({
    batchFailures: {
      0: { code: "ANTHROPIC_TIMEOUT", error: "timeout", retryable: true },
      1: { code: "PROPOSAL_OUTPUT_INVALID", error: "invalid", retryable: false },
    },
  });
  await mixed.handler(request());
  assert.equal(mixed.calls.failArgs[0].p_retryable, false, "a mixed outcome is never retryable");
});

test("a lost lease during persistence prevents completion", async () => {
  const harness = makeHarness({ persistError: "PROPOSAL_LEASE_OWNERSHIP_LOST" });
  const response = await harness.handler(request());
  assert.equal(harness.persistence.completeCalls, 0);
  assert.equal(harness.persistence.failCalls, 1);
  assert.equal(response.status, 500);
  const error = await errorOf(response);
  assert.equal(error.code, "IDEATION_PROPOSAL_ORCHESTRATION_FAILED");
  assert.match(String(error.message), /PROPOSAL_PERSISTENCE_FAILED/);
});

test("an active proposal is refused and a completed one replays with no provider call", async () => {
  const active = makeHarness({ beginReplay: "running" });
  const activeResponse = await active.handler(request());
  assert.equal(activeResponse.status, 409);
  assert.equal((await errorOf(activeResponse)).code, "PROPOSAL_RUN_IN_PROGRESS");
  assert.equal(active.calls.proposeBatch, 0);

  for (const status of ["draft", "approved"] as const) {
    const replay = makeHarness({ beginReplay: status });
    const response = await replay.handler(request());
    assert.equal(response.status, 200, status);
    const payload = await body(response);
    assert.equal(payload.created, false, status);
    assert.equal(payload.idempotent_replay, true, status);
    assert.equal(replay.calls.proposeBatch, 0, `${status} replay makes no provider call`);
    assert.equal(replay.persistence.persistCalls, 0, status);
  }
});

test("a terminal proposal replays as a structured non-retryable failure", async () => {
  const harness = makeHarness({ beginReplay: "failed", attemptsExhausted: true });
  const response = await harness.handler(request());
  assert.equal(response.status, 409);
  const error = await errorOf(response);
  assert.equal(error.code, "PROPOSAL_ATTEMPTS_EXHAUSTED");
  assert.equal(error.retryable, false);
  assert.equal((error.details as Record<string, unknown>).retry_allowed, false);
  assert.equal(harness.calls.proposeBatch, 0);
});

test("a regeneration names its predecessor and yields a distinct identity", async () => {
  const plain = makeHarness();
  await plain.handler(request());
  const plainKey = String(plain.calls.beginArgs[0].p_idempotency_key);

  const regenerate = makeHarness();
  const response = await regenerate.handler(request("admin", {
    action: "regenerate",
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    scoring_run_id: SCORING_RUN_ID,
    regenerate_from_proposal_id: PREVIOUS_PROPOSAL_ID,
  }));
  assert.equal(response.status, 201);
  const args = regenerate.calls.beginArgs[0];
  assert.equal(args.p_supersedes_proposal_id, PREVIOUS_PROPOSAL_ID);
  assert.notEqual(String(args.p_idempotency_key), plainKey);
  assert.ok(String(args.p_idempotency_key).includes(PREVIOUS_PROPOSAL_ID));

  const invalid = makeHarness({ beginError: "REGENERATE_PREDECESSOR_INVALID" });
  const invalidResponse = await invalid.handler(request("admin", {
    action: "regenerate",
    client_id: CLIENT_ID,
    ideation_cycle_id: CYCLE_ID,
    scoring_run_id: SCORING_RUN_ID,
    regenerate_from_proposal_id: PREVIOUS_PROPOSAL_ID,
  }));
  assert.equal(invalidResponse.status, 409);
  assert.equal((await errorOf(invalidResponse)).code, "REGENERATE_PREDECESSOR_INVALID");
});

/* ================================================================== */
/* Manual editing, conflict refresh, and approval                      */
/* ================================================================== */

function editRequest(action: string, extra: Record<string, unknown> = {}) {
  return request("admin", {
    action,
    client_id: CLIENT_ID,
    proposal_id: PROPOSAL_ID,
    expected_edit_revision: 3,
    ...extra,
  });
}

test("every edit action passes its ownership identity and expected revision", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["move", { from_slot_key: "2026-07-01:reel:1", to_slot_key: "2026-07-03:reel:1" }],
    ["swap", { from_slot_key: "2026-07-01:reel:1", to_slot_key: "2026-07-03:reel:1" }],
    ["unassign", { from_slot_key: "2026-07-01:reel:1" }],
    ["assign", { to_slot_key: "2026-07-03:reel:1", candidate_id: candidateId(0) }],
  ];
  for (const [action, extra] of cases) {
    const harness = makeHarness({ proposalStatus: "draft", editRevision: 3 });
    const response = await harness.handler(editRequest(action, extra));
    assert.equal(response.status, 200, action);
    const args = harness.calls.editArgs[0];
    assert.equal(args.p_action, action);
    assert.equal(args.p_proposal_id, PROPOSAL_ID);
    assert.equal(args.p_client_id, CLIENT_ID);
    assert.equal(args.p_expected_edit_revision, 3, `${action} carries the loaded revision`);
    assert.equal(args.p_actor_id, USER_ID);
    assert.equal(harness.calls.proposeBatch, 0, `${action} makes no provider call`);
  }
});

test("edits require a proposal id, a revision, and matching client ownership", async () => {
  const missingRevision = makeHarness({ proposalStatus: "draft" });
  const response = await missingRevision.handler(request("admin", {
    action: "unassign",
    client_id: CLIENT_ID,
    proposal_id: PROPOSAL_ID,
    from_slot_key: "a",
  }));
  assert.equal(response.status, 400);
  assert.equal((await errorOf(response)).code, "PROPOSAL_EDIT_REVISION_INVALID");

  const badId = makeHarness({ proposalStatus: "draft" });
  const badIdResponse = await badId.handler(request("admin", {
    action: "unassign", client_id: CLIENT_ID, proposal_id: "nope", expected_edit_revision: 0,
  }));
  assert.equal(badIdResponse.status, 400);
  assert.equal((await errorOf(badIdResponse)).code, "PROPOSAL_ID_INVALID");

  const assignWithoutCandidate = makeHarness({ proposalStatus: "draft", editRevision: 0 });
  const assignResponse = await assignWithoutCandidate.handler(request("admin", {
    action: "assign", client_id: CLIENT_ID, proposal_id: PROPOSAL_ID, expected_edit_revision: 0, to_slot_key: "a",
  }));
  assert.equal(assignResponse.status, 400);
  assert.equal((await errorOf(assignResponse)).code, "CANDIDATE_ID_INVALID");
});

test("typed edit conflicts map to precise, non-retryable failures", async () => {
  const cases: Array<[string, number]> = [
    ["PROPOSAL_EDIT_REVISION_CONFLICT", 409],
    ["PROPOSAL_ASSET_TYPE_INCOMPATIBLE", 409],
    ["PROPOSAL_SLOT_ALREADY_OCCUPIED", 409],
    ["PROPOSAL_CANDIDATE_ALREADY_ASSIGNED", 409],
    ["PROPOSAL_CANDIDATE_NOT_ASSIGNED", 409],
    ["PROPOSAL_NOT_EDITABLE", 409],
    ["PROPOSAL_SLOT_NOT_FOUND", 404],
  ];
  for (const [code, status] of cases) {
    const harness = makeHarness({ proposalStatus: "draft", editRevision: 3, editError: code });
    const response = await harness.handler(editRequest("move", {
      from_slot_key: "a", to_slot_key: "b",
    }));
    assert.equal(response.status, status, code);
    const error = await errorOf(response);
    assert.equal(error.code, code, code);
    assert.equal(error.retryable, false, code);
  }
});

test("conflict refresh re-reads the Calendar and advances the revision", async () => {
  const harness = makeHarness({
    proposalStatus: "draft",
    editRevision: 3,
    occupancy: [{
      id: "cal-1", date: PERIOD_START, row_type: "reel", ref: "JUL26-RL-001",
      review_state: "approved", updated_at: "2026-07-01T00:00:00.000Z",
    }],
  });
  const response = await harness.handler(editRequest("refresh_conflicts"));
  assert.equal(response.status, 200);
  const args = harness.calls.refreshArgs[0];
  assert.equal(args.p_proposal_id, PROPOSAL_ID);
  assert.equal(args.p_expected_edit_revision, 3);
  assert.match(String(args.p_calendar_conflict_digest), /^[0-9a-f]{64}$/);
  assert.ok(Array.isArray(args.p_conflicts));
  assert.equal(harness.calls.proposeBatch, 0);
});

test("approval passes the live Calendar digest and the loaded revision", async () => {
  const harness = makeHarness({ proposalStatus: "draft", editRevision: 3 });
  const response = await harness.handler(editRequest("approve"));
  assert.equal(response.status, 200);
  const args = harness.calls.approveArgs[0];
  assert.equal(args.p_proposal_id, PROPOSAL_ID);
  assert.equal(args.p_client_id, CLIENT_ID);
  assert.equal(args.p_expected_edit_revision, 3);
  assert.match(String(args.p_current_calendar_digest), /^[0-9a-f]{64}$/);
  assert.equal(args.p_actor_id, USER_ID);
  assert.equal((await body(response)).action, "approve");
  assert.equal(harness.calls.proposeBatch, 0, "approval never calls the provider");
});

test("approval blockers surface as typed non-retryable failures", async () => {
  const cases: Array<[string, number]> = [
    ["PROPOSAL_CALENDAR_SNAPSHOT_STALE", 409],
    ["PROPOSAL_UNRESOLVED_CONFLICT", 409],
    ["PROPOSAL_INCOMPLETE", 409],
    ["PROPOSAL_CANDIDATE_DRIFTED", 409],
    ["PROPOSAL_CANDIDATE_RECONCILIATION_FAILED", 409],
    ["PROPOSAL_NOT_APPROVABLE", 409],
    ["PROPOSAL_EDIT_REVISION_CONFLICT", 409],
    ["CYCLE_NOT_ELIGIBLE", 409],
    ["SCORING_RUN_NOT_ELIGIBLE", 409],
  ];
  for (const [code, status] of cases) {
    const harness = makeHarness({ proposalStatus: "draft", editRevision: 3, approveError: code });
    const response = await harness.handler(editRequest("approve"));
    assert.equal(response.status, status, code);
    const error = await errorOf(response);
    assert.equal(error.code, code, code);
    assert.equal(error.retryable, false, code);
  }
});

test("a proposal belonging to another client is refused for every edit action", async () => {
  for (const action of ["move", "swap", "unassign", "assign", "refresh_conflicts", "approve"]) {
    const harness = makeHarness({ proposalStatus: "draft", editRevision: 0 });
    harness.persistence.proposal.client_id = "10000000-0000-4000-8000-0000000000aa";
    const response = await harness.handler(request("admin", {
      action, client_id: CLIENT_ID, proposal_id: PROPOSAL_ID, expected_edit_revision: 0,
      from_slot_key: "a", to_slot_key: "b", candidate_id: candidateId(0),
    }));
    assert.equal(response.status, 403, action);
    assert.equal((await errorOf(response)).code, "PROPOSAL_CLIENT_MISMATCH", action);
  }
});

/* ================================================================== */
/* Leak safety                                                         */
/* ================================================================== */

test("proposal responses never leak credentials, prompts, or lease owners", async () => {
  const harness = makeHarness({
    batchFailures: {
      0: {
        code: "ANTHROPIC_HTTP_ERROR",
        error: "Anthropic API returned HTTP 500: sk-ant-secret\nstack trace line\nservice_role key abc",
        retryable: true,
      },
    },
  });
  const response = await harness.handler(request());
  const serialized = JSON.stringify(await body(response));
  assert.equal(serialized.includes("sk-ant-secret") && serialized.includes("service_role key abc"), false);
  assert.equal(serialized.includes("stack trace line"), false, "multi-line detail is truncated");
  assert.equal(serialized.includes("aaaaaaaa-0000-4000-8000-000000000001"), false, "the lease owner is never returned");
});
