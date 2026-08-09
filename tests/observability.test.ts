// Programme Stage O — deterministic unit coverage for the observability
// aggregation functions. All pure — no network, no database — since these
// compute the operator-dashboard metrics directly from already-fetched rows.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computePublishSuccessRate, summariseExceptions, ageInHours, summariseQueueAge, summariseApprovalDelays,
  type PublishAttemptLike, type ExceptionLike, type AgeableItem, type WorkItemLike,
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
