// Cockpit v3 Step 5 — Master AI's business-context panel
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md Step 5, step 2: "build the
// business-context panel from already-real data"). Every section here reads
// data that already exists elsewhere in the app (Overview's Command Center
// notes, Opportunity OS, the Automations registry, real cron triggers) --
// zero new schema, zero new RPC. "Goals" and "Decisions" from the plan's own
// illustrative diagram are deliberately not sections here: neither concept
// is tracked anywhere in this schema, and inventing one would be exactly the
// fabricated-data mistake this codebase's discipline forbids (the same
// judgment call Team's Directory made for "capacity").

import { useEffect, useState } from "react";
import { fetchCommandCenterNotes } from "@/lib/command-center";
import { fetchOpportunityFindings } from "@/lib/opportunity";
import { fetchWorkflows, fetchScheduledTriggers } from "@/lib/workflows";
import type { CommandCenterNoteRow } from "@/types/operations";
import type { OpportunityFindingRow } from "@/types/opportunity";
import type { ScheduledTrigger } from "@/lib/workflows";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BusinessContextPanel({ clientId }: { clientId: string }) {
  const [notes, setNotes] = useState<CommandCenterNoteRow[]>([]);
  const [findings, setFindings] = useState<OpportunityFindingRow[]>([]);
  const [triggers, setTriggers] = useState<ScheduledTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      const [n, f, t] = await Promise.all([
        fetchCommandCenterNotes(), fetchOpportunityFindings(clientId), fetchScheduledTriggers(),
      ]);
      if (!active) return;
      setNotes(n);
      setFindings(f);
      setTriggers(t);
      setLoading(false);
    })().catch((e) => { if (active) { setError(errorText(e)); setLoading(false); } });
    return () => { active = false; };
  }, [clientId]);

  const activeAgentCount = fetchWorkflows().filter((w) => w.profile !== "retired").length;
  const openNotes = notes.filter((n) => !n.resolved_at);
  const pendingFindings = findings.filter((f) => f.status === "pending_review");
  const activeTriggers = triggers.filter((t) => t.active);

  if (loading) return <p className="p-3 text-2xs text-paper-3">Loading…</p>;
  if (error) return <p className="p-3 text-2xs text-neg">{error}</p>;

  return (
    <div className="flex flex-col gap-3">
      <Section title="Priorities & Bottlenecks" empty="No open priorities or bottlenecks." count={openNotes.length}>
        {openNotes.map((n) => (
          <div key={n.id} className="rounded border border-line bg-ink p-2 text-2xs">
            <span className="font-mono uppercase text-paper-3">{n.category}</span>
            <p className="mt-0.5 text-paper-2">{n.body}</p>
          </div>
        ))}
      </Section>

      <Section title="Opportunities" empty="No opportunities awaiting review." count={pendingFindings.length}>
        {pendingFindings.map((f) => (
          <div key={f.id} className="rounded border border-line bg-ink p-2 text-2xs">
            <span className="font-mono uppercase text-teal">{f.finding_type}</span>
            <p className="mt-0.5 text-paper-2">{f.title}</p>
          </div>
        ))}
      </Section>

      <Section title="Active Workflows" empty="No scheduled triggers." count={activeTriggers.length}>
        {activeTriggers.map((t) => (
          <div key={t.jobname} className="rounded border border-line bg-ink p-2 text-2xs">
            <span className="text-paper">{t.jobname}</span>
            <span className="ml-2 font-mono text-paper-3">{t.schedule}</span>
          </div>
        ))}
      </Section>

      <div className="rounded border border-line bg-ink-200 p-2 text-2xs text-paper-3">
        {activeAgentCount} active agents in the registry — see Team for the full directory.
      </div>
    </div>
  );
}

function Section({ title, empty, count, children }: { title: string; empty: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-2xs uppercase tracking-cap text-paper-3">{title}</h3>
        <span className="font-mono text-2xs text-paper-3">{count}</span>
      </div>
      {count === 0 ? <p className="text-2xs text-paper-3">{empty}</p> : <div className="space-y-1">{children}</div>}
    </div>
  );
}
