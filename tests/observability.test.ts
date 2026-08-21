// Programme Stage O — deterministic unit coverage for the observability
// aggregation functions. All pure — no network, no database — since these
// compute the operator-dashboard metrics directly from already-fetched rows.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computePublishSuccessRate, summariseExceptions, ageInHours, summariseQueueAge, summariseApprovalDelays, summariseSalesPipeline,
  type PublishAttemptLike, type ExceptionLike, type AgeableItem, type WorkItemLike, type SalesLeadLike,
} from "../src/lib/observability.ts";

// ── computePublishSuccessRate ────────────────────────────────────────────────

test("no attempts produces a null success rate, never a fabricated 0% or 100%", () => {
  const result = computePublishSuccessRate([]);
  assert.equal(result.successRate, null);
  assert.equal(result.terminalAttempts, 0);
});

test("only terminal outcomes (published/permanent_failure) count toward the rate", () => {
  const attempts: PublishAttemptLike[] = [
    { result: "published", completed_at: "x", started_at: "x" },
    { result: "retryable_failure", completed_at: "x", started_at: "x" },
    { result: "started", completed_at: null, started_at: "x" },
    { result: "skipped", completed_at: "x", started_at: "x" },
  ];
  const result = computePublishSuccessRate(attempts);
  assert.equal(result.totalAttempts, 4);
  assert.equal(result.terminalAttempts, 1);
  assert.equal(result.successRate, 100);
});

test("success rate is the percentage of terminal attempts that published, rounded to one decimal", () => {
  const attempts: PublishAttemptLike[] = [
    { result: "published", completed_at: "x", started_at: "x" },
    { result: "published", completed_at: "x", started_at: "x" },
    { result: "permanent_failure", completed_at: "x", started_at: "x" },
  ];
  const result = computePublishSuccessRate(attempts);
  assert.equal(result.successRate, 66.7);
});

// ── summariseExceptions ──────────────────────────────────────────────────────

test("summariseExceptions counts by status and flags unresolved high-severity separately", () => {
  const exceptions: ExceptionLike[] = [
    { status: "open", severity: "high", created_at: "x" },
    { status: "open", severity: "low", created_at: "x" },
    { status: "acknowledged", severity: "high", created_at: "x" },
    { status: "resolved", severity: "high", created_at: "x" },
  ];
  const result = summariseExceptions(exceptions);
  assert.equal(result.openCount, 2);
  assert.equal(result.acknowledgedCount, 1);
  assert.equal(result.resolvedCount, 1);
  assert.equal(result.highSeverityOpenCount, 2, "both open and acknowledged high-severity count as unresolved");
});

// ── ageInHours / summariseQueueAge ───────────────────────────────────────────

test("ageInHours never goes negative even for a future-dated created_at (clock skew)", () => {
  const future = new Date(Date.now() + 3_600_000).toISOString();
  assert.equal(ageInHours(future), 0);
});

test("ageInHours computes elapsed time correctly", () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
  assert.equal(ageInHours(twoHoursAgo), 2);
});

test("summariseQueueAge excludes resolved statuses and reports oldest/average over what remains", () => {
  const now = new Date();
  const items: AgeableItem[] = [
    { created_at: new Date(now.getTime() - 10 * 3_600_000).toISOString(), status: "open" },
    { created_at: new Date(now.getTime() - 2 * 3_600_000).toISOString(), status: "open" },
    { created_at: new Date(now.getTime() - 100 * 3_600_000).toISOString(), status: "resolved" },
  ];
  const result = summariseQueueAge(items, ["resolved"], now);
  assert.equal(result.openCount, 2);
  assert.equal(result.oldestAgeHours, 10);
  assert.equal(result.averageAgeHours, 6);
});

test("summariseQueueAge returns nulls, not zeros, when nothing is open", () => {
  const result = summariseQueueAge([{ created_at: new Date().toISOString(), status: "resolved" }], ["resolved"]);
  assert.equal(result.openCount, 0);
  assert.equal(result.oldestAgeHours, null);
  assert.equal(result.averageAgeHours, null);
});

// ── summariseApprovalDelays ──────────────────────────────────────────────────

test("summariseApprovalDelays separates overdue from due-soon and ignores done items", () => {
  const now = new Date();
  const items: WorkItemLike[] = [
    { status: "open", due_at: new Date(now.getTime() - 3_600_000).toISOString(), priority: "normal" }, // overdue
    { status: "in_progress", due_at: new Date(now.getTime() + 12 * 3_600_000).toISOString(), priority: "high" }, // due soon
    { status: "review", due_at: new Date(now.getTime() + 48 * 3_600_000).toISOString(), priority: "low" }, // not due soon
    { status: "done", due_at: new Date(now.getTime() - 100 * 3_600_000).toISOString(), priority: "urgent" }, // done, ignored even though "overdue"
    { status: "open", due_at: null, priority: "normal" }, // no due date, ignored
  ];
  const result = summariseApprovalDelays(items, now);
  assert.equal(result.overdueCount, 1);
  assert.equal(result.dueSoonCount, 1);
});

test("summariseApprovalDelays with no items reports zero, not undefined or NaN", () => {
  const result = summariseApprovalDelays([]);
  assert.equal(result.overdueCount, 0);
  assert.equal(result.dueSoonCount, 0);
});

// ── summariseSalesPipeline (Cockpit v3 Step 4 — Overview's Business Health) ──

test("summariseSalesPipeline sums open value across every non-closed stage", () => {
  const leads: SalesLeadLike[] = [
    { stage: "lead", estimated_value_cents: 10_000 },
    { stage: "conversation", estimated_value_cents: 5_000 },
    { stage: "closed_won", estimated_value_cents: 20_000 },
    { stage: "closed_lost", estimated_value_cents: 15_000 },
  ];
  const result = summariseSalesPipeline(leads);
  assert.equal(result.openCount, 2);
  assert.equal(result.openValueCents, 15_000);
  assert.equal(result.wonCount, 1);
  assert.equal(result.wonValueCents, 20_000);
});

test("summariseSalesPipeline treats a null estimated_value_cents as 0, never drops the lead from the count", () => {
  const leads: SalesLeadLike[] = [{ stage: "opportunity", estimated_value_cents: null }];
  const result = summariseSalesPipeline(leads);
  assert.equal(result.openCount, 1);
  assert.equal(result.openValueCents, 0);
});

test("summariseSalesPipeline with no leads reports zero, not undefined or NaN", () => {
  const result = summariseSalesPipeline([]);
  assert.deepEqual(result, { openCount: 0, openValueCents: 0, wonCount: 0, wonValueCents: 0 });
});
