// Stage 2 Phase 02 — Business Selector detail view. Deliberately thin: name,
// slug, an optional linked client, and a switcher to move between
// businesses -- this is the exit gate's actual "switching" interaction.
// No department content yet; later phases add their own sections here when
// they're real, not before.

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Panel } from "@/components/primitives";
import { fetchBusiness, fetchBusinesses } from "@/lib/business";
import { fetchClients } from "@/lib/api";
import type { BusinessRow } from "@/types/business";
import type { Client } from "@/types/client";
import { ROUTES } from "@/lib/constants";
import { fmtDateLong } from "@/lib/format";

export function BusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [business, setBusiness] = useState<BusinessRow | null>(null);
  const [allBusinesses, setAllBusinesses] = useState<BusinessRow[]>([]);
  const [linkedClient, setLinkedClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const [current, all, clients] = await Promise.all([fetchBusiness(id), fetchBusinesses(), fetchClients()]);
      if (!current) { setError("Business not found."); setBusiness(null); return; }
      setBusiness(current);
      setAllBusinesses(all);
      setLinkedClient(current.client_id ? clients.find((c) => c.id === current.client_id) ?? null : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">Loading…</div>;
  if (error || !business) return <div className="flex-1 flex items-center justify-center text-neg text-xs">{error ?? "Business not found."}</div>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-sm font-medium text-paper">{business.name}</h1>
          <span className="text-2xs text-paper-3 font-mono">{business.slug}</span>
        </div>
        {allBusinesses.length > 1 && (
          <label className="flex items-center gap-2 text-2xs text-paper-3">
            Switch business
            <select
              className="rounded border border-line bg-ink-200 px-2 py-1 text-xs text-paper outline-none focus:border-teal/50"
              value={business.id}
              onChange={(e) => navigate(ROUTES.business(e.target.value))}
            >
              {allBusinesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <Panel title="Business">
        <div className="grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-3">
          <div>
            <div className="text-2xs uppercase tracking-cap text-paper-3">Name</div>
            <div className="text-paper">{business.name}</div>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-cap text-paper-3">Slug</div>
            <div className="text-paper font-mono">{business.slug}</div>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-cap text-paper-3">Created</div>
            <div className="text-paper">{fmtDateLong(business.created_at)}</div>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <div className="text-2xs uppercase tracking-cap text-paper-3">Linked client</div>
            {linkedClient ? (
              <Link to={ROUTES.client(linkedClient.id)} className="text-teal hover:underline">{linkedClient.name}</Link>
            ) : (
              <span className="text-paper-3">Standalone — no linked client</span>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
