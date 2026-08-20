// Cockpit v3 Step 2 — Team promoted to a real top-level page
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 2). "Directory" tab is the
// same data, same component as the original Operations > Operational
// Control > Team & Roles tab (Stage 2 Phase 09) -- TeamRolesSection is
// shared, not duplicated. The old tab stays in place, hidden-before-delete,
// until this location has real usage behind it.
//
// Step 3 adds a "Channels" tab -- TeamWorkspaceSection, the genuinely
// greenfield collaboration surface this plan calls for -- alongside the
// directory, not replacing it.

import { useState } from "react";
import { TeamRolesSection } from "@/components/team/TeamRolesSection";
import { TeamWorkspaceSection } from "@/components/team/TeamWorkspaceSection";

type Tab = "channels" | "directory";

export function TeamPage() {
  const [tab, setTab] = useState<Tab>("channels");

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex gap-1">
        {(["channels", "directory"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-2 py-1 text-2xs uppercase tracking-cap ${tab === t ? "bg-teal/10 text-teal" : "text-paper-3 hover:text-paper"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "channels" ? <TeamWorkspaceSection /> : <TeamRolesSection />}
    </div>
  );
}
