// Stage 2 Phase 10 — Communications Hub. The conversation list: every real
// Instagram DM identity, filterable by linked/unlinked. Mirrors Sales'
// list-then-detail pattern.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, Panel } from "@/components/primitives";
import { fetchCommsIdentities } from "@/lib/comms";
import { fetchSalesLeads } from "@/lib/sales";
import { fetchClients } from "@/lib/api";
import type { CommsIdentityRow } from "@/types/comms";
import type { SalesLeadRow } from "@/types/sales";
import type { Client } from "@/types/client";
import { ROUTES } from "@/lib/constants";
import { fmtRelative } from "@/lib/format";

type LinkFilter = "all" | "linked" | "unlinked";

export function CommsPage() {
  const navigate = useNavigate();
  const [identities, setIdentities] = useState<CommsIdentityRow[]>([]);
  const [leads, setLeads] = useState<SalesLeadRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LinkFilter>("all");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [i, l, c] = await Promise.all([fetchCommsIdentities(), fetchSalesLeads(), fetchClients()]);
      setIdentities(i); setLeads(l); setClients(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const leadName = (id: string) => leads.find((l) => l.id === id)?.name;
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name;

  const visible = useMemo(() => identities.filter((i) => {
    const linked = !!(i.matched_lead_id || i.matched_client_id);
    if (filter === "linked") return linked;
    if (filter === "unlinked") return !linked;
    return true;
  }), [identities, filter]);

  if (loading) return <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">Loading…</div>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-paper">Comms</h1>
        <span className="text-2xs text-paper-3 font-mono">{visible.length} of {identities.length}</span>
      </div>
      {error && <p className="text-2xs text-neg">{error}</p>}
      <p className="text-2xs text-paper-3">Instagram DMs — v1's one channel (Decision 3). Identity linking to a Sales lead or Delivery client is deliberately manual, not auto-matched.</p>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "unlinked", "linked"] as LinkFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-2 py-1 text-2xs uppercase tracking-cap ${filter === f ? "bg-teal/10 text-teal" : "text-paper-3 hover:text-paper"}`}
          >
            {f}
          </button>
        ))}
      </div>

      <Panel title="Conversations" meta={`${visible.length}`}>
        {visible.length === 0 ? (
          <EmptyState icon="chat" title="No conversations yet" body="Real Instagram DMs will appear here once the webhook receives them." />
        ) : (
          <div className="space-y-1 p-2">
            {visible.map((i) => (
              <div
                key={i.id}
                onClick={() => navigate(ROUTES.commsIdentity(i.id))}
                className="rounded border border-line bg-ink p-2 text-2xs cursor-pointer hover:bg-ink-100 transition-colors"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono uppercase text-info">{i.platform}</span>
                  <span className="text-paper font-medium">{i.display_name ?? i.external_user_id}</span>
                  {i.matched_lead_id && <span className="text-teal">→ Lead: {leadName(i.matched_lead_id) ?? i.matched_lead_id}</span>}
                  {i.matched_client_id && <span className="text-teal">→ Client: {clientName(i.matched_client_id) ?? i.matched_client_id}</span>}
                  {!i.matched_lead_id && !i.matched_client_id && <span className="text-warn">Unlinked</span>}
                  <span className="text-paper-3 font-mono ml-auto">{fmtRelative(i.last_seen_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
