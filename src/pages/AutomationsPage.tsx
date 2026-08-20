// Cockpit v3 Step 2 — Automations promoted to a real top-level page
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 2). Same data, same
// components as the original Operations > Operational Control > Workflows/
// Triggers tabs (Stage 2 Phase 03) -- WorkflowsSection/TriggersSection are
// shared, not duplicated. The old tabs stay in place, hidden-before-delete,
// until this location has real usage behind it.

import { useState } from "react";
import { WorkflowsSection } from "@/components/automations/WorkflowsSection";
import { TriggersSection } from "@/components/automations/TriggersSection";

const TABS = ["workflows", "triggers"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { workflows: "Workflows", triggers: "Triggers" };

export function AutomationsPage() {
  const [tab, setTab] = useState<Tab>("workflows");

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap gap-2 border-b border-line pb-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded px-2 py-1 text-2xs ${tab === t ? "bg-teal/10 text-teal" : "text-paper-3 hover:text-paper"}`}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {tab === "workflows" && <WorkflowsSection />}
      {tab === "triggers" && <TriggersSection />}
    </div>
  );
}
