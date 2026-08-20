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
