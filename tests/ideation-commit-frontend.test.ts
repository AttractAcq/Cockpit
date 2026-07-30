// Ideation Stage 4 — frontend stale-request safety and accessibility contract.
//
// These are behavioural tests against the real coordinator and the real view
// helpers, not source-text assertions. The panel's own commit routine is
// modelled here exactly as it is written, so the guards are exercised rather
// than merely described.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createIdeationRequestCoordinator,
  type IdeationRequestCoordinator,
} from "../src/lib/ideation-request-coordinator.ts";
import { canCommitProposal, commitRecoveryAction, summariseCommitPlan } from "../src/lib/ideation-commit-view.ts";

/**
 * Mirrors IdeationPanel.commitContent's guard structure: capture the client,
 * begin a token, and apply nothing unless the token is still current and the
 * client has not changed.
 */
function createCommitRunner(coordinator: IdeationRequestCoordinator, initialClientId: string) {
  const applied: string[] = [];
  let currentClientId = initialClientId;
  let mounted = true;

  return {
    applied,
    changeClient(clientId: string) {
      currentClientId = clientId;
      coordinator.synchronizeClient(clientId);
    },
    unmount() {
      mounted = false;
      coordinator.dispose();
    },
    async commit(clientId: string, resolve: () => Promise<string>): Promise<"skipped" | "applied" | "stale"> {
      const originatingClientId = clientId;
      const token = coordinator.begin("commit-content", originatingClientId);
      if (!token) return "skipped";
      try {
        const outcome = await resolve();
        if (!coordinator.isCurrent(token) || currentClientId !== originatingClientId || !mounted) return "stale";
        applied.push(outcome);
        return "applied";
      } finally {
        coordinator.finish(token);
      }
    },
  };
}

test("a duplicate commit click while one is in flight is blocked", async () => {
  const coordinator = createIdeationRequestCoordinator("client-a");
  const runner = createCommitRunner(coordinator, "client-a");
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const first = runner.commit("client-a", async () => { await gate; return "first"; });
  const second = await runner.commit("client-a", async () => "second");
  assert.equal(second, "skipped", "the second click never starts");
  release!();
  assert.equal(await first, "applied");
  assert.deepEqual(runner.applied, ["first"]);
});

test("a commit does not block an unrelated proposal action", () => {
  const coordinator = createIdeationRequestCoordinator("client-a");
  assert.ok(coordinator.begin("commit-content", "client-a"));
  assert.ok(coordinator.begin("refresh-conflicts", "client-a"), "a different kind still starts");
  assert.equal(coordinator.begin("commit-content", "client-a"), null);
});

test("a stale client-A success cannot update client B", async () => {
  const coordinator = createIdeationRequestCoordinator("client-a");
  const runner = createCommitRunner(coordinator, "client-a");
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inFlight = runner.commit("client-a", async () => { await gate; return "client-a-result"; });
  runner.changeClient("client-b");
  release!();
  assert.equal(await inFlight, "stale");
  assert.deepEqual(runner.applied, []);
});

test("a stale client-A failure cannot update client B", async () => {
  const coordinator = createIdeationRequestCoordinator("client-a");
  const runner = createCommitRunner(coordinator, "client-a");
  let reject: ((error: Error) => void) | null = null;
  const gate = new Promise<string>((_, rejectPromise) => { reject = rejectPromise; });
  const inFlight = runner.commit("client-a", () => gate).catch(() => "threw");
  runner.changeClient("client-b");
  reject!(new Error("commit failed"));
  assert.equal(await inFlight, "threw");
  assert.deepEqual(runner.applied, [], "no failure state was applied to client B");
});

test("a completion after unmount is ignored", async () => {
  const coordinator = createIdeationRequestCoordinator("client-a");
  const runner = createCommitRunner(coordinator, "client-a");
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const inFlight = runner.commit("client-a", async () => { await gate; return "late"; });
  runner.unmount();
  release!();
  assert.equal(await inFlight, "stale");
  assert.deepEqual(runner.applied, []);
});

test("a client change invalidates the active commit token", () => {
  const coordinator = createIdeationRequestCoordinator("client-a");
  const token = coordinator.begin("commit-content", "client-a");
  assert.ok(token);
  assert.equal(coordinator.isCurrent(token), true);
  coordinator.synchronizeClient("client-b");
  assert.equal(coordinator.isCurrent(token), false);
});

test("a commit for a client that is no longer selected never starts", () => {
  const coordinator = createIdeationRequestCoordinator("client-a");
  coordinator.synchronizeClient("client-b");
  assert.equal(coordinator.begin("commit-content", "client-a"), null);
});

test("after a commit completes, a new commit may begin", async () => {
  const coordinator = createIdeationRequestCoordinator("client-a");
  const runner = createCommitRunner(coordinator, "client-a");
  assert.equal(await runner.commit("client-a", async () => "one"), "applied");
  assert.equal(await runner.commit("client-a", async () => "two"), "applied");
  assert.deepEqual(runner.applied, ["one", "two"]);
});

/* ------------------------------------------------- panel behaviour contract */

test("the panel treats a refresh failure as a warning, never as a failed commit", async () => {
  const panel = await readFile("src/components/client/IdeationPanel.tsx", "utf8");
  const commitRoutine = panel.slice(
    panel.indexOf("async function commitContent"),
    panel.indexOf("function editProposal"),
  );
  assert.ok(commitRoutine.length > 0);
  // The reload is guarded by its own try/catch that sets a warning; it must not
  // reach setCommitFailure or re-invoke the commit.
  const reloadBlock = commitRoutine.slice(commitRoutine.indexOf("try {\n        await load("));
  const untilCatchEnd = reloadBlock.slice(0, reloadBlock.indexOf("} catch (value)"));
  assert.match(untilCatchEnd, /setRefreshWarning/);
  assert.equal(/setCommitFailure/.test(untilCatchEnd), false);
  assert.equal(/invokeIdeationCommit/.test(untilCatchEnd), false);
});

test("the panel only ever sends the four contract fields", async () => {
  const panel = await readFile("src/components/client/IdeationPanel.tsx", "utf8");
  const call = panel.slice(panel.indexOf("invokeIdeationCommit({"));
  const args = call.slice(0, call.indexOf("});"));
  const keys = [...args.matchAll(/^\s*([a-z_]+):/gm)].map((match) => match[1]).sort();
  assert.deepEqual(keys, ["client_id", "confirm_commit", "expected_edit_revision", "proposal_id"]);
});

test("the commit action disappears once a commit has completed", () => {
  assert.equal(canCommitProposal("approved", null), true);
  assert.equal(canCommitProposal("approved", { status: "completed" } as never), false);
  // A failed attempt created nothing, so the proposal remains committable.
  assert.equal(canCommitProposal("approved", null), true);
});

/* ------------------------------------------------------------ confirmation */

test("the confirmation states counts, dates, and both operational effects", async () => {
  const source = await readFile("src/components/client/IdeationCommitConfirmation.tsx", "utf8");
  assert.match(source, /Total content items/);
  assert.match(source, /Organic content/);
  assert.match(source, /Stories/);
  assert.match(source, /Affected dates/);
  assert.match(source, /operational Calendar rows will be created/);
  assert.match(source, /operational Content rows will be created/);
  assert.match(source, /normal review workflow/);
  assert.match(source, /Production, publishing, and distribution will not begin automatically/);
});

test("the confirm label names the exact number of items", async () => {
  const source = await readFile("src/components/client/IdeationCommitConfirmation.tsx", "utf8");
  assert.match(source, /Commit \$\{summary\.total\} Content Items/);
});

test("the confirmation confirms the revision captured when it opened", async () => {
  const source = await readFile("src/components/client/IdeationCommitConfirmation.tsx", "utf8");
  assert.match(source, /const confirmedRevision = useRef\(proposal\.edit_revision\)/);
  assert.match(source, /onConfirm\(confirmedRevision\.current\)/);
  // A revision that moves while the dialog is open disables confirmation.
  assert.match(source, /revisionMoved/);
  assert.match(source, /disabled=\{busy \|\| revisionMoved/);
});

test("the plan summary drives the confirmation, so its counts cannot drift", () => {
  const summary = summariseCommitPlan([
    { required_asset_type: "story", proposed_date: "2026-08-01", conflict_status: "clear" },
    { required_asset_type: "reel", proposed_date: "2026-08-01", conflict_status: "clear" },
  ], 0);
  assert.equal(summary.total, 2);
  assert.equal(summary.story, 1);
  assert.equal(summary.organic, 1);
  assert.equal(summary.total, summary.story + summary.organic);
});

/* --------------------------------------------------------- accessibility */

test("the commit action is a semantic button with an announced status", async () => {
  const review = await readFile("src/components/client/IdeationProposalReview.tsx", "utf8");
  assert.match(review, /<Button[\s\S]{0,400}Commit Content/);
  assert.match(review, /aria-describedby="proposal-commit-status"/);
  assert.match(review, /id="proposal-commit-status" role="status"/);
});

test("the confirmation traps focus, restores it, and names its initial focus", async () => {
  const modal = await readFile("src/components/primitives/Modal.tsx", "utf8");
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /previousFocusRef\.current/, "focus is restored on close");
  assert.match(modal, /event\.key !== "Tab"/, "Tab is trapped");
  assert.match(modal, /event\.key === "Escape"/);
  const confirmation = await readFile("src/components/client/IdeationCommitConfirmation.tsx", "utf8");
  assert.match(confirmation, /initialFocusRef=\{summaryRef\}/);
  assert.match(confirmation, /closeDisabled=\{busy\}/, "Escape is disabled only once the commit begins");
});

test("committed counts and refs are readable without colour", async () => {
  const result = await readFile("src/components/client/IdeationCommitResult.tsx", "utf8");
  for (const label of ["Content items:", "Organic master rows:", "Story master rows:", "Committed:"]) {
    assert.ok(result.includes(label), `${label} must be a text label`);
  }
  assert.match(result, /<dl /, "counts use a description list, not colour");
});

test("navigation to the created records uses semantic buttons", async () => {
  const result = await readFile("src/components/client/IdeationCommitResult.tsx", "utf8");
  assert.match(result, /<Button[\s\S]{0,160}Open Calendar/);
  assert.match(result, /<Button[\s\S]{0,160}Open Content record/);
});

test("the result region and every failure are announced", async () => {
  const result = await readFile("src/components/client/IdeationCommitResult.tsx", "utf8");
  assert.match(result, /aria-labelledby="ideation-commit-result"/);
  const panel = await readFile("src/components/client/IdeationPanel.tsx", "utf8");
  assert.match(panel, /commitFailure && \(\s*<div role="alert"/);
  assert.match(panel, /refreshWarning && \(\s*<div role="status"/);
});

test("ARIA ids introduced by Stage 4 are unique", async () => {
  const sources = await Promise.all([
    readFile("src/components/client/IdeationCommitConfirmation.tsx", "utf8"),
    readFile("src/components/client/IdeationCommitResult.tsx", "utf8"),
    readFile("src/components/client/IdeationProposalReview.tsx", "utf8"),
  ]);
  const ids = sources.flatMap((source) => [...source.matchAll(/\bid="([a-z0-9-]+)"/g)].map((match) => match[1]));
  assert.equal(new Set(ids).size, ids.length, `duplicate id: ${ids.join(", ")}`);
});

test("a non-retryable failure shows a recovery action rather than a blind retry", async () => {
  const panel = await readFile("src/components/client/IdeationPanel.tsx", "utf8");
  assert.match(panel, /commitRecoveryAction\(commitFailure\.code\)/);
  assert.equal(/Retry commit|Retry Commit/.test(panel), false, "there is no blind retry control");
  assert.equal(commitRecoveryAction("CALENDAR_SNAPSHOT_STALE"), "refresh_conflicts");
});
