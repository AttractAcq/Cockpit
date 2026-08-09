// Programme Stage N — deterministic unit coverage for the automation-policy
// gate, retry-cap resolution, and cross-client capacity allocation. All
// pure functions — no network, no database.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkAutomationGate, resolveRetryCap, allocateCapacity, DEFAULT_AUTOMATION_LEVEL,
  type AutomationLevel, type CapacityCandidate,
} from "../supabase/functions/_shared/automation-policy.ts";

// ── checkAutomationGate ──────────────────────────────────────────────────────

test("a manual attempt (isAutomaticAttempt: false) is always allowed regardless of level", () => {
  for (const level of ["manual", "assisted", "automatic"] as AutomationLevel[]) {
    const result = checkAutomationGate(level, false);
    assert.equal(result.allowed, true);
    assert.equal(result.code, "OK");
  }
});

test("an automatic attempt is only allowed when the level is automatic — automatic jobs cannot bypass approval policy", () => {
  assert.equal(checkAutomationGate("automatic", true).allowed, true);
  assert.equal(checkAutomationGate("manual", true).allowed, false);
  assert.equal(checkAutomationGate("assisted", true).allowed, false);
});

test("manual and assisted produce distinct, non-empty reasons an operator can act on", () => {
  const manual = checkAutomationGate("manual", true);
  const assisted = checkAutomationGate("assisted", true);
  assert.equal(manual.code, "MANUAL_MODE_BLOCKS_AUTOMATIC_ATTEMPT");
  assert.equal(assisted.code, "ASSISTED_MODE_REQUIRES_APPROVAL");
  assert.notEqual(manual.reason, assisted.reason);
  assert.ok(manual.reason && manual.reason.length > 0);
  assert.ok(assisted.reason && assisted.reason.length > 0);
});

test("DEFAULT_AUTOMATION_LEVEL is automatic — no policy row means today's unrestricted behaviour", () => {
  assert.equal(DEFAULT_AUTOMATION_LEVEL, "automatic");
  assert.equal(checkAutomationGate(DEFAULT_AUTOMATION_LEVEL, true).allowed, true);
});

// ── resolveRetryCap ───────────────────────────────────────────────────────────

test("a valid policy retry_cap wins over the fallback", () => {
  assert.equal(resolveRetryCap(3, 5), 3);
  assert.equal(resolveRetryCap(20, 5), 20);
});

test("a missing or invalid policy retry_cap falls back to the caller's default, never fails closed or open", () => {
  assert.equal(resolveRetryCap(null, 5), 5);
  assert.equal(resolveRetryCap(undefined, 5), 5);
  assert.equal(resolveRetryCap(0, 5), 5, "zero is not a usable retry cap");
  assert.equal(resolveRetryCap(-1, 5), 5, "negative is not a usable retry cap");
  assert.equal(resolveRetryCap(Number.NaN, 5), 5);
});

// ── allocateCapacity ──────────────────────────────────────────────────────────

function candidate(clientId: string, priority: CapacityCandidate["priority"], dueAt: string | null): CapacityCandidate {
  return { clientId, priority, dueAt };
}

test("an unset cap allocates every candidate — no policy means unrestricted", () => {
  const candidates = [candidate("a", "low", null), candidate("b", "high", null), candidate("c", "normal", null)];
  const result = allocateCapacity(candidates, null);
  assert.ok(result.every((r) => r.allocated));
});

test("high priority is allocated before normal, which is allocated before low", () => {
  const candidates = [candidate("low-client", "low", null), candidate("high-client", "high", null), candidate("normal-client", "normal", null)];
  const result = allocateCapacity(candidates, 1);
  const allocated = result.filter((r) => r.allocated).map((r) => r.clientId);
  assert.deepEqual(allocated, ["high-client"]);
});

test("within the same priority, an earlier due date is allocated first", () => {
  const candidates = [
    candidate("later", "normal", "2026-09-01T00:00:00Z"),
    candidate("earlier", "normal", "2026-08-01T00:00:00Z"),
  ];
  const result = allocateCapacity(candidates, 1);
  assert.equal(result.find((r) => r.allocated)?.clientId, "earlier");
});

test("a null due date sorts after any real due date within the same priority", () => {
  const candidates = [candidate("no-due-date", "normal", null), candidate("has-due-date", "normal", "2026-08-01T00:00:00Z")];
  const result = allocateCapacity(candidates, 1);
  assert.equal(result.find((r) => r.allocated)?.clientId, "has-due-date");
});

test("clientId is a stable final tiebreaker for otherwise-identical candidates — deterministic across runs", () => {
  const candidates = [candidate("zzz", "normal", null), candidate("aaa", "normal", null)];
  const first = allocateCapacity(candidates, 1);
  const second = allocateCapacity([...candidates].reverse(), 1);
  assert.equal(first.find((r) => r.allocated)?.clientId, "aaa");
  assert.equal(second.find((r) => r.allocated)?.clientId, "aaa");
});

test("a zero cap allocates nothing; a cap larger than the candidate count allocates everything", () => {
  const candidates = [candidate("a", "normal", null), candidate("b", "normal", null)];
  assert.ok(allocateCapacity(candidates, 0).every((r) => !r.allocated));
  assert.ok(allocateCapacity(candidates, 10).every((r) => r.allocated));
});

test("allocation preserves every candidate in the result, in ranked order, none dropped or duplicated", () => {
  const candidates = [candidate("a", "low", null), candidate("b", "high", null), candidate("c", "normal", null), candidate("d", "high", "2026-01-01T00:00:00Z")];
  const result = allocateCapacity(candidates, 2);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map((r) => r.clientId), ["d", "b", "c", "a"]);
  assert.deepEqual(result.map((r) => r.allocated), [true, true, false, false]);
});

test("a negative cap behaves like zero — never a negative allocation count", () => {
  const candidates = [candidate("a", "normal", null)];
  assert.ok(allocateCapacity(candidates, -5).every((r) => !r.allocated));
});
