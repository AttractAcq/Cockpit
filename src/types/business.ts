// Stage 2 Phase 02 — Business Selector. The additive Business Object.
// Deliberately thin: no Sales/Finance/Team ownership columns yet (Stage 2
// build plan, Principle 01 — designed against Business Instance #2's real
// friction in later phases, not guessed at here).

export interface BusinessRow {
  id: string;
  name: string;
  slug: string;
  client_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
