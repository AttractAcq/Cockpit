// Cockpit v3 Step 1 — Business Context. The two behaviours that matter and
// aren't already covered by fetchBusinesses()'s own live-tested RPC layer:
// (a) resolving the shared selection down to its linked client, exactly the
// compatibility-layer bridge docs/COCKPIT_V3_TRANSFORMATION_PLAN.md section 3
// describes, and (b) detecting a stale/dangling stored selection so it gets
// dropped instead of silently scoping every page to a business that no
// longer exists. Pure functions, tested directly -- this repo has no React
// component-test infrastructure (no jsdom/testing-library anywhere), so the
// resolution logic is kept out of the hook/component for exactly this
// reason, matching knowledge-search.ts's and finance-csv.ts's precedent.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolveSelectedClientId, isStaleSelection, findBusinessForClient } from "../src/lib/business-context-resolve.ts";
import type { BusinessRow } from "../src/types/business.ts";

function business(overrides: Partial<BusinessRow> = {}): BusinessRow {
  return {
    id: "biz-1",
    name: "Attract Acquisition",
    slug: "attract-acquisition",
    client_id: "client-1",
    created_by: null,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

test("resolveSelectedClientId returns null when nothing is selected", () => {
  assert.equal(resolveSelectedClientId([business()], null), null);
});

test("resolveSelectedClientId resolves the selected business's linked client", () => {
  const businesses = [business({ id: "biz-1", client_id: "client-1" }), business({ id: "biz-2", client_id: "client-2" })];
  assert.equal(resolveSelectedClientId(businesses, "biz-2"), "client-2");
});

test("resolveSelectedClientId returns null for a standalone business with no linked client", () => {
  const businesses = [business({ id: "biz-1", client_id: null })];
  assert.equal(resolveSelectedClientId(businesses, "biz-1"), null);
});

test("resolveSelectedClientId returns null for a selected id that doesn't match any loaded business", () => {
  const businesses = [business({ id: "biz-1", client_id: "client-1" })];
  assert.equal(resolveSelectedClientId(businesses, "biz-does-not-exist"), null);
});

test("isStaleSelection is false when nothing is selected", () => {
  assert.equal(isStaleSelection([business()], null), false);
});

test("isStaleSelection is false when the selection matches a loaded business", () => {
  assert.equal(isStaleSelection([business({ id: "biz-1" })], "biz-1"), false);
});

test("isStaleSelection is true for a stored id that no longer resolves -- e.g. a deleted business, or a stale browser profile", () => {
  assert.equal(isStaleSelection([business({ id: "biz-1" })], "biz-deleted"), true);
});

test("isStaleSelection is true against an empty (not-yet-loaded or genuinely empty) business list", () => {
  assert.equal(isStaleSelection([], "biz-1"), true);
});

test("findBusinessForClient returns null when no client id is given", () => {
  assert.equal(findBusinessForClient([business()], null), null);
});

test("findBusinessForClient returns the business linked to the given client", () => {
  const businesses = [business({ id: "biz-1", client_id: "client-1" }), business({ id: "biz-2", client_id: "client-2" })];
  assert.deepEqual(findBusinessForClient(businesses, "client-2"), businesses[1]);
});

test("findBusinessForClient returns null for a client with no linked business -- still the common case", () => {
  const businesses = [business({ id: "biz-1", client_id: "client-1" })];
  assert.equal(findBusinessForClient(businesses, "client-does-not-have-a-business"), null);
});

test("ClientDetailPage carries a client's linked business into the shared selection the same way BusinessDetailPage does for a business opened directly", () => {
  const src = readFileSync(new URL("../src/pages/ClientDetailPage.tsx", import.meta.url), "utf-8");
  assert.match(src, /import\s*\{\s*useBusinessContext\s*\}\s*from\s*"@\/lib\/business-context"/);
  assert.match(src, /findBusinessForClient\(businesses,\s*id\)/);
  assert.match(src, /setSelectedBusinessId\(linked\.id\)/);
});

test("SalesLeadDetailPage carries a lead's business into the shared selection the same way, closing the last Step 1 gap", () => {
  const src = readFileSync(new URL("../src/pages/SalesLeadDetailPage.tsx", import.meta.url), "utf-8");
  assert.match(src, /import\s*\{\s*useBusinessContext\s*\}\s*from\s*"@\/lib\/business-context"/);
  assert.match(src, /setSelectedBusinessId\(current\.business_id\)/);
});
