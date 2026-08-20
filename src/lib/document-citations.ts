// Cockpit v3 Step 3 — Documents. Pure aggregation over
// client_context_file_citations rows, kept separate from documents.ts (which
// does the actual Supabase fetch) so it's directly unit-testable without
// pulling in ./supabase -- this repo's test runner resolves relative
// imports the way Node's native TS support does, not a bundler, so a file
// under test can't transitively import an extensionless specifier like
// documents.ts's own "./supabase". Same reasoning as business-context-
// resolve.ts's split from business-context.tsx.

import type { ContextFileCitation } from "@/types/phase1-intelligence";

/** Citation count per context_file_id -- zero for a file with none, not omitted. */
export function citationCountsByFile(citations: ContextFileCitation[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of citations) counts[c.context_file_id] = (counts[c.context_file_id] ?? 0) + 1;
  return counts;
}
