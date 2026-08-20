// Cockpit v3 Step 2 — Team promoted to a real top-level page
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 2). Same data, same
// component as the original Operations > Operational Control > Team & Roles
// tab (Stage 2 Phase 09) -- TeamRolesSection is shared, not duplicated. The
// old tab stays in place, hidden-before-delete, until this location has
// real usage behind it.

import { TeamRolesSection } from "@/components/team/TeamRolesSection";

export function TeamPage() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <TeamRolesSection />
    </div>
  );
}
