// Cockpit v3 Step 2 — extracted from OperationsControlPanel.tsx's Workflows
// tab so it can be shared by both the original Operations location and the
// new top-level Automations page (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md
// Step 2) without duplicating the JSX or the data source. No behaviour
// change from the original tab.

import { useMemo, useState } from "react";
import { fetchWorkflows, UNDOCUMENTED_DEPLOYMENTS } from "@/lib/workflows";
import { PROFILE_COLOR } from "@/lib/workflow-profile-colors";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

export function WorkflowsSection() {
  const [filter, setFilter] = useState("all");
  const workflows = useMemo(() => fetchWorkflows(), []);
  const profiles = useMemo(() => ["all", ...Array.from(new Set(workflows.map((w) => w.profile))).sort()], [workflows]);
  const visible = filter === "all" ? workflows : workflows.filter((w) => w.profile === filter);

  return <div className="space-y-3">
    <p className="text-2xs text-paper-3">
      The governed edge-function registry itself ({workflows.length} functions) — the same source of truth <code>npm run check:edge-functions</code> enforces in CI. Nothing here is a separate, driftable list.
    </p>
    <div className="flex items-center gap-2">
      <span className="text-2xs text-paper-3 uppercase tracking-cap">Profile</span>
      <select className={field} value={filter} onChange={(e) => setFilter(e.target.value)}>
        {profiles.map((p) => <option key={p} value={p}>{p === "all" ? "All profiles" : p}</option>)}
      </select>
      <span className="text-2xs text-paper-3 font-mono ml-auto">{visible.length} shown</span>
    </div>
    <div className="max-h-96 overflow-y-auto space-y-1">
      {visible.map((w) => (
        <div key={w.name} className="rounded border border-line bg-ink p-2 text-2xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-paper font-medium">{w.name}</span>
            <span className={`font-mono uppercase ${PROFILE_COLOR[w.profile] ?? "text-paper-3"}`}>{w.profile}</span>
            <span className="text-paper-3">· {w.page}</span>
          </div>
          <p className="mt-1 text-paper-2">{w.purpose}</p>
        </div>
      ))}
    </div>

    <div className="rounded border border-warn/40 bg-warn/5 p-3">
      <h4 className="mb-1 text-xs font-medium text-warn">⚠ Deployed but not in this registry ({UNDOCUMENTED_DEPLOYMENTS.length})</h4>
      <p className="mb-2 text-2xs text-paper-3">
        Found by diffing what's actually deployed on the production project against this repo's registry (Stage 2 Phase 03 audit, 2026-08-20). This app cannot detect this list live — it needs Management API access the frontend never holds — so treat it as a dated finding, not a live feed.
      </p>
      <div className="space-y-1">
        {UNDOCUMENTED_DEPLOYMENTS.map((d) => (
          <div key={d.slug} className="rounded border border-line bg-ink p-2 text-2xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-paper font-medium">{d.slug}</span>
              <span className={`font-mono uppercase ${d.category === "unmerged_branch" ? "text-neg" : "text-paper-3"}`}>
                {d.category === "unmerged_branch" ? "unmerged branch" : "retired, still deployed"}
              </span>
            </div>
            <p className="mt-1 text-paper-2">{d.note}</p>
          </div>
        ))}
      </div>
    </div>
  </div>;
}
