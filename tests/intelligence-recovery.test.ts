import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const intelligencePath = new URL("../src/lib/intelligence.ts", import.meta.url);
const boardPath = new URL("../docs/AA_INTELLIGENCE_OS_RECOVERY_BOARD_PLAN.md", import.meta.url);

test("Intelligence retry helper has a complete domain-to-function contract", async () => {
  const source = await readFile(intelligencePath, "utf8");
  assert.match(source, /const INTELLIGENCE_RETRY_FUNCTIONS: Record<IntelligenceDomain, string> = \{/);
  assert.match(source, /market_os: "run-market-os"/);
  assert.match(source, /avatar_os: "run-avatar-os"/);
  assert.match(source, /competitor_os: "run-competitor-os"/);
  assert.match(source, /association_os: "run-association-os"/);
  assert.match(source, /brand_strategist: "run-brand-strategist"/);
  assert.match(source, /domain: IntelligenceDomain/);
  assert.match(source, /action: "retry_step"/);
});

test("Intelligence recovery board marks implemented stages and leaves remaining backend gaps explicit", async () => {
  const board = await readFile(boardPath, "utf8");
  assert.match(board, /Status: Stage 5 Brand Strategist backend retry implemented/);
  assert.match(board, /### Card 2 - Standardize Retry Contract\s+Status: Done/s);
  assert.match(board, /### Card 3 - Add Backend Retry To Market OS\s+Status: Done/s);
  assert.match(board, /### Card 4 - Add Backend Retry To Avatar OS\s+Status: Done/s);
  assert.match(board, /### Card 5 - Add Backend Retry To Brand Strategist\s+Status: Done/s);
  assert.match(board, /Backend `retry_step` support is now implemented for all five Intelligence OS domains/);
});
