// Cockpit v3 Step 2 — Finance promoted to a real top-level page
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 2). Same RPCs, same tables,
// same component as the original Operations > Operational Control > Cost &
// Margin tab (Stage 2 Phase 08) -- CostMarginSection is shared, not
// duplicated. The old tab stays in place, hidden-before-delete, until this
// location has real usage behind it.

import { CostMarginSection } from "@/components/finance/CostMarginSection";

export function FinancePage() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="text-sm font-medium text-paper">Finance</h1>
      <CostMarginSection />
    </div>
  );
}
