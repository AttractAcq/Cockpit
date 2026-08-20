// Cockpit v3 Step 2 — extracted from OperationsControlPanel.tsx's Triggers
// tab, same reasoning as WorkflowsSection.tsx: shared by the original
// Operations location and the new top-level Automations page, no behaviour
// change, no duplicated data source.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchScheduledTriggers, UNDOCUMENTED_DEPLOYMENTS, type ScheduledTrigger } from "@/lib/workflows";

type Notice = { kind: "success" | "error"; text: string } | null;
function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: string }).message);
  return error instanceof Error ? error.message : String(error);
}

export function TriggersSection() {
  const [triggers, setTriggers] = useState<ScheduledTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setTriggers(await fetchScheduledTriggers()); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const unmergedTargets = new Set(UNDOCUMENTED_DEPLOYMENTS.filter((d) => d.category === "unmerged_branch").map((d) => d.slug));

  if (loading) return <p className="text-2xs text-paper-3">Loading…</p>;
  return <div className="space-y-3">
    {notice && <p className="text-2xs text-neg">{notice.text}</p>}
    <p className="text-2xs text-paper-3">pg_cron's real, live job list — the ground truth for what's actually scheduled, not an aspirational or documented-only list.</p>
    <div className="space-y-1">
      {triggers.map((t) => (
        <div key={t.jobname} className="rounded border border-line bg-ink p-2 text-2xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-paper font-medium">{t.jobname}</span>
            <span className="font-mono text-paper-3">{t.schedule}</span>
            <span className={t.active ? "text-teal" : "text-paper-3"}>{t.active ? "active" : "paused"}</span>
            {t.target_function && unmergedTargets.has(t.target_function) && (
              <span className="font-mono uppercase text-neg">⚠ target not in main</span>
            )}
          </div>
          <p className="mt-1 text-paper-2">→ {t.target_function ?? "(could not parse target from command)"}</p>
        </div>
      ))}
    </div>
    <Button size="sm" variant="ghost" onClick={() => void load()}>Reload</Button>
  </div>;
}
