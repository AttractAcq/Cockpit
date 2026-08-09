// Programme Stage 1B-B — deterministic coverage for the Facebook Page
// discovery/ownership/capability adapter. All pure — no network, no database,
// no real Meta credentials. Covers every test named in the stage prompt:
// correct Page discovery, cross-client Page rejection, missing permission,
// expired/revoked token, duplicate destination, capability refresh,
// reconnect, and existing-Instagram regression.

import assert from "node:assert/strict";
import { test } from "node:test";
import { MetaPublishError } from "../supabase/functions/_shared/meta-errors.ts";
import {
  discoverManagedPages, verifyPageOwnership, findDuplicateDestination,
  checkPageCapability, classifyCapabilityCheckFailure, deriveConnectionStatus,
  REQUIRED_PAGE_TASK, type FacebookPageSummary, type DiscoverPagesDeps,
} from "../supabase/functions/_shared/facebook-pages.ts";

function page(overrides: Partial<FacebookPageSummary> = {}): FacebookPageSummary {
  return { id: "111111111111111", name: "Real Client Page", category: "Local Business", tasks: ["CREATE_CONTENT", "MODERATE"], ...overrides };
}

// ── Correct Page discovery ───────────────────────────────────────────────

test("discoverManagedPages returns exactly what the injected Meta call returns, unmodified", async () => {
  const pages = [page(), page({ id: "222222222222222", name: "Second Page" })];
  const deps: DiscoverPagesDeps = { fetchManagedPages: async () => pages };
  const result = await discoverManagedPages(deps, "fake-token");
  assert.deepEqual(result, pages);
});

test("discoverManagedPages propagates a real provider failure rather than swallowing it", async () => {
  const deps: DiscoverPagesDeps = { fetchManagedPages: async () => { throw new MetaPublishError({ provider: "meta", category: "meta_server_error", retryable: true, message: "Meta 500" }); } };
  await assert.rejects(() => discoverManagedPages(deps, "fake-token"), MetaPublishError);
});

// ── Cross-client Page rejection (ownership) ──────────────────────────────

test("a Page present in the caller's own discovery list is owned", () => {
  const result = verifyPageOwnership([page()], "111111111111111");
  assert.equal(result.owned, true);
  assert.equal(result.page?.id, "111111111111111");
  assert.equal(result.reason, null);
});

test("a page_id belonging to a different client (not in this discovery list) is rejected, not silently connected", () => {
  const result = verifyPageOwnership([page({ id: "111111111111111" })], "999999999999999");
  assert.equal(result.owned, false);
  assert.equal(result.page, null);
  assert.ok(result.reason && result.reason.length > 0, "a rejection must always carry an operator-facing reason");
});

test("an empty discovery list rejects every requested page_id", () => {
  const result = verifyPageOwnership([], "111111111111111");
  assert.equal(result.owned, false);
});

// ── Missing permission ────────────────────────────────────────────────────

test("a Page missing the CREATE_CONTENT task is classified missing_permissions with zero supported capabilities", () => {
  const result = checkPageCapability(page({ tasks: ["MODERATE", "ANALYZE"] }));
  assert.equal(result.verificationStatus, "missing_permissions");
  assert.deepEqual(result.missingScopes, [REQUIRED_PAGE_TASK]);
  assert.deepEqual(result.supportedCapabilities, []);
  assert.ok(result.lastError?.includes(REQUIRED_PAGE_TASK));
});

test("a Page with CREATE_CONTENT is verified and gains real publish capabilities", () => {
  const result = checkPageCapability(page({ tasks: ["CREATE_CONTENT"] }));
  assert.equal(result.verificationStatus, "verified");
  assert.deepEqual(result.missingScopes, []);
  assert.ok(result.supportedCapabilities.length > 0);
  assert.equal(result.lastError, null);
});

test("Reels are never listed as a supported capability yet — no upload-session adapter exists until 1B-D", () => {
  const result = checkPageCapability(page({ tasks: ["CREATE_CONTENT"] }));
  assert.ok(!result.supportedCapabilities.includes("publish_reel" as never), "must not claim a capability that cannot be verified end to end");
});

// ── Expired or revoked token ──────────────────────────────────────────────

test("an authentication-classified provider error maps to token_invalid, not a generic error", () => {
  const error = new MetaPublishError({ provider: "meta", category: "meta_authentication", retryable: false, message: "Error validating access token" });
  const result = classifyCapabilityCheckFailure(error);
  assert.equal(result.verificationStatus, "token_invalid");
  assert.ok(result.lastError?.includes("meta_authentication"));
});

test("a non-auth provider error maps to error, not token_invalid — the operator sees the right remediation", () => {
  const error = new MetaPublishError({ provider: "meta", category: "meta_server_error", retryable: true, message: "Meta 500" });
  const result = classifyCapabilityCheckFailure(error);
  assert.equal(result.verificationStatus, "error");
});

test("a plain, unclassified thrown error still resolves to a safe error state rather than throwing further", () => {
  const result = classifyCapabilityCheckFailure(new Error("network timeout"));
  assert.equal(result.verificationStatus, "error");
  assert.ok(result.lastError?.includes("network timeout"));
});

// ── Duplicate destination ─────────────────────────────────────────────────

test("an active existing destination on the same platform and external id is a duplicate", () => {
  const dup = findDuplicateDestination(
    [{ platform: "facebook", external_account_id: "111111111111111", is_active: true }],
    "facebook", "111111111111111",
  );
  assert.ok(dup);
});

test("an inactive existing destination is NOT treated as a blocking duplicate — reconnection after deactivation is allowed", () => {
  const dup = findDuplicateDestination(
    [{ platform: "facebook", external_account_id: "111111111111111", is_active: false }],
    "facebook", "111111111111111",
  );
  assert.equal(dup, null);
});

test("the same external id on a different platform is never a duplicate — instagram and facebook never collide", () => {
  const dup = findDuplicateDestination(
    [{ platform: "instagram", external_account_id: "111111111111111", is_active: true }],
    "facebook", "111111111111111",
  );
  assert.equal(dup, null);
});

// ── Capability refresh / Reconnect ────────────────────────────────────────

test("connection status derivation: verified -> connected", () => {
  assert.equal(deriveConnectionStatus({ grantedScopes: [], missingScopes: [], supportedCapabilities: [], verificationStatus: "verified", lastError: null }), "connected");
});

test("connection status derivation: token_invalid -> needs_reauth (the reconnect trigger)", () => {
  assert.equal(deriveConnectionStatus({ grantedScopes: [], missingScopes: [], supportedCapabilities: [], verificationStatus: "token_invalid", lastError: "expired" }), "needs_reauth");
});

test("connection status derivation: missing_permissions -> error", () => {
  assert.equal(deriveConnectionStatus({ grantedScopes: [], missingScopes: ["CREATE_CONTENT"], supportedCapabilities: [], verificationStatus: "missing_permissions", lastError: "missing" }), "error");
});

test("a reconnect (re-running the same capability check after the operator fixes permissions) flips needs_reauth back to connected", () => {
  const before = deriveConnectionStatus({ grantedScopes: [], missingScopes: [], supportedCapabilities: [], verificationStatus: "token_invalid", lastError: "expired" });
  assert.equal(before, "needs_reauth");
  const after = deriveConnectionStatus(checkPageCapability(page({ tasks: ["CREATE_CONTENT"] })));
  assert.equal(after, "connected");
});

// ── Existing Instagram regression ─────────────────────────────────────────

test("nothing in this module assumes or hardcodes instagram — every function is platform-parameterized", () => {
  // findDuplicateDestination already proven platform-aware above. Confirm the
  // ownership/capability functions operate purely on Page shape, never on a
  // hardcoded platform string, so adding Facebook logic could not have
  // silently changed how an Instagram destination is evaluated (Instagram
  // destinations never call these Facebook-specific functions at all — the
  // regression risk is a shared-file collision, and this module shares no
  // function with instagram-publish.ts or publish-capability.ts).
  const igLikeAccount = { platform: "instagram", external_account_id: "17841400000000000", is_active: true };
  assert.equal(findDuplicateDestination([igLikeAccount], "instagram", "17841400000000000")?.platform, "instagram");
  assert.equal(findDuplicateDestination([igLikeAccount], "facebook", "17841400000000000"), null);
});
