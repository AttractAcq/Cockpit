// Cockpit v3 Step 1 — pure resolution logic for BusinessContext, kept out of
// business-context.tsx (and its JSX) so it's directly unit-testable: this
// repo's test suite runs on Node's native test runner with no JSX/component
// test infrastructure, matching the existing knowledge-search.ts /
// finance-csv.ts precedent of pure logic in .ts, thin wiring in .tsx/React.

import type { BusinessRow } from "@/types/business";

/** The linked client for the selected business -- the compatibility-layer
 * bridge docs/COCKPIT_V3_TRANSFORMATION_PLAN.md section 3 describes. Null
 * for "nothing selected" and for a standalone business with no linked client. */
export function resolveSelectedClientId(
  businesses: BusinessRow[],
  selectedBusinessId: string | null,
): string | null {
  if (!selectedBusinessId) return null;
  return businesses.find((b) => b.id === selectedBusinessId)?.client_id ?? null;
}

/** A stored/selected id that no longer resolves to a real, loaded business. */
export function isStaleSelection(businesses: BusinessRow[], selectedBusinessId: string | null): boolean {
  if (!selectedBusinessId) return false;
  return !businesses.some((b) => b.id === selectedBusinessId);
}

/** The business linked to a given client, if one exists -- the other direction
 * of the compatibility bridge: opening a client directly by URL (most clients
 * still have no linked business at all, since business_id is the newer
 * concept) should carry that business into the shared selection the same way
 * BusinessDetailPage already does when a business is opened directly. Null
 * when no business links to this client, which is still the common case. */
export function findBusinessForClient(businesses: BusinessRow[], clientId: string | null): BusinessRow | null {
  if (!clientId) return null;
  return businesses.find((b) => b.client_id === clientId) ?? null;
}
