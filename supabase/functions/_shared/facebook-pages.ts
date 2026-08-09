// Programme Stage 1B-B — Facebook Page discovery, ownership verification and
// capability checking. Dependency-injected (same convention as
// instagram-publish.ts's PublishDeps) so every pure decision here is
// unit-testable without a real network call or real Meta credentials.
//
// Grounded in Meta's own Graph API documentation, fetched live during Stage
// 1B-A (see docs/programme/phase-1b/1B-A-facebook-capability-matrix.md):
//   GET /me/accounts                    -> Pages a token can manage, with per-Page `tasks`.
//   GET /{page-id}?fields=access_token  -> derive a Page-scoped token from the user/system-user token.
// Reuses meta-errors.ts's classifyMetaError -- confirmed in Stage 1B-A to
// already be provider-generic (classifies by raw Graph error code/subcode/
// HTTP status, not by Instagram-specific concepts), so no forked taxonomy
// was needed here.
// Deliberately dependency-free (same convention as meta-errors.ts): no
// Supabase-client import here, so this module (and its tests) never touch
// the jsr: import Node's ESM loader cannot resolve. Auth and credential
// resolution, which genuinely need the Supabase client, live in
// facebook-destination-auth.ts instead.
import { classifyMetaError, MetaPublishError, type MetaErrorClassification } from "./meta-errors.ts";

const GRAPH_VERSION = "v21.0"; // Same version as instagram-publish.ts / meta-ads.ts. Expires 2027-01-21 (verified live, Stage 1B-A).

/** The permissions every Facebook Page destination needs before it can be used for publishing (Stage 1B-A capability matrix §"Permissions required"). */
export const REQUIRED_FACEBOOK_PAGE_SCOPES = ["pages_manage_posts", "pages_read_engagement", "pages_show_list"] as const;
export type RequiredFacebookPageScope = (typeof REQUIRED_FACEBOOK_PAGE_SCOPES)[number];

/** The Page-level task capability Meta's newer permission model requires for publishing (Stage 1B-A security model doc). */
export const REQUIRED_PAGE_TASK = "CREATE_CONTENT";

export interface FacebookPageSummary {
  id: string;
  name: string;
  category: string | null;
  /** Meta's per-Page task list for the calling user/system-user (e.g. ["CREATE_CONTENT", "MODERATE"]). */
  tasks: string[];
}

export interface DiscoverPagesDeps {
  fetchManagedPages(token: string): Promise<FacebookPageSummary[]>;
}

/** Real Meta Graph implementation of DiscoverPagesDeps. */
export const liveDiscoverPagesDeps: DiscoverPagesDeps = {
  async fetchManagedPages(token: string): Promise<FacebookPageSummary[]> {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,category,tasks&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new MetaPublishError(classifyMetaError(res.status, data, "meta_publish_failed"));
    const items = Array.isArray((data as { data?: unknown[] }).data) ? (data as { data: unknown[] }).data : [];
    return items.map((item) => {
      const p = item as Record<string, unknown>;
      return {
        id: String(p.id ?? ""),
        name: typeof p.name === "string" ? p.name : "",
        category: typeof p.category === "string" ? p.category : null,
        tasks: Array.isArray(p.tasks) ? p.tasks.filter((t): t is string => typeof t === "string") : [],
      };
    });
  },
};

/** Discover every Page the given Meta token can manage. Never writes anything -- read-only. */
export async function discoverManagedPages(deps: DiscoverPagesDeps, token: string): Promise<FacebookPageSummary[]> {
  return deps.fetchManagedPages(token);
}

// ── Ownership: a Page can only be connected if it is genuinely present in a ─
// fresh discovery call for that client's own token -- never trust a raw
// page_id typed into a form. This is the "Cross-client Page rejection" and
// "correct Page discovery" requirement's pure decision, testable without a
// network call.

export interface PageOwnershipResult {
  owned: boolean;
  page: FacebookPageSummary | null;
  reason: string | null;
}

export function verifyPageOwnership(discoveredPages: readonly FacebookPageSummary[], requestedPageId: string): PageOwnershipResult {
  const page = discoveredPages.find((p) => p.id === requestedPageId) ?? null;
  if (!page) {
    return { owned: false, page: null, reason: "This Page was not found among the Pages your connected Meta identity can manage. It may belong to a different client or Business Manager, or access may not have been granted." };
  }
  return { owned: true, page, reason: null };
}

// ── Duplicate detection ──────────────────────────────────────────────────

export function findDuplicateDestination(
  existingAccounts: readonly { platform: string; external_account_id: string; is_active: boolean }[],
  platform: string,
  externalAccountId: string,
): { platform: string; external_account_id: string; is_active: boolean } | null {
  return existingAccounts.find((a) => a.platform === platform && a.external_account_id === externalAccountId && a.is_active) ?? null;
}

// ── Capability / permission classification ───────────────────────────────

export interface CapabilityCheckResult {
  grantedScopes: string[];
  missingScopes: string[];
  supportedCapabilities: string[];
  verificationStatus: "verified" | "missing_permissions" | "token_invalid" | "error";
  lastError: string | null;
}

/** Capability codes this destination can support once every required scope + task is granted. Mirrors the Stage 1B-A capability matrix. */
const FACEBOOK_PAGE_CAPABILITIES = ["publish_photo", "publish_video", "publish_feed_text"] as const;
// Reels are deliberately excluded until the upload-session adapter exists (1B-D) -- listing it here
// would claim a capability this destination check cannot actually verify end to end.

/**
 * Classify a Page's real, discovered `tasks` against what Cockpit requires.
 * `tasks` is Meta's actual per-Page task list (from /me/accounts), not a
 * guess -- this function makes no network call itself, so it is exercised
 * with real and synthetic task lists alike in tests.
 */
export function checkPageCapability(page: FacebookPageSummary): CapabilityCheckResult {
  const hasRequiredTask = page.tasks.includes(REQUIRED_PAGE_TASK);
  if (!hasRequiredTask) {
    return {
      grantedScopes: page.tasks,
      missingScopes: [REQUIRED_PAGE_TASK],
      supportedCapabilities: [],
      verificationStatus: "missing_permissions",
      lastError: `The connected identity does not have the "${REQUIRED_PAGE_TASK}" task on this Page. Grant Page content-creation access in Meta Business Manager and reconnect.`,
    };
  }
  return {
    grantedScopes: page.tasks,
    missingScopes: [],
    supportedCapabilities: [...FACEBOOK_PAGE_CAPABILITIES],
    verificationStatus: "verified",
    lastError: null,
  };
}

/** Classify a thrown error from a discovery/verification call into a capability result. Token problems -> token_invalid; everything else -> error. */
export function classifyCapabilityCheckFailure(error: unknown): CapabilityCheckResult {
  const classification: MetaErrorClassification | null = error instanceof MetaPublishError ? error.classification : null;
  const message = error instanceof Error ? error.message : String(error);
  const isAuthFailure = classification?.category === "meta_authentication";
  return {
    grantedScopes: [],
    missingScopes: [],
    supportedCapabilities: [],
    verificationStatus: isAuthFailure ? "token_invalid" : "error",
    lastError: classification ? `[${classification.category}] ${message}` : message,
  };
}

// ── Connection status derivation ─────────────────────────────────────────
// The single mapping from a capability check outcome to the destination's
// stored connection_status -- used by both the initial connect flow and the
// later refresh/reconnect flow, so the two can never disagree.

export type ConnectionStatus = "connected" | "needs_reauth" | "disconnected" | "error";

export function deriveConnectionStatus(result: CapabilityCheckResult): ConnectionStatus {
  switch (result.verificationStatus) {
    case "verified": return "connected";
    case "token_invalid": return "needs_reauth";
    case "missing_permissions": return "error";
    case "error": return "error";
  }
}
