// Stage 2 Phase 02 — Business Selector. Mirrors ClientsPage/ClientDirectory's
// list-then-detail pattern, thinned to what businesses actually has today:
// name, slug, an optional linked client. No department content yet -- later
// phases (Sales, Finance, Team, ...) add their own sections when they're real.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, Panel } from "@/components/primitives";
import { fetchBusinesses, createBusiness } from "@/lib/business";
import { fetchClients } from "@/lib/api";
import type { BusinessRow } from "@/types/business";
import type { Client } from "@/types/client";
import { useAuth } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { fmtRelative } from "@/lib/format";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

export function BusinessesPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", clientId: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [businessRows, clientRows] = await Promise.all([fetchBusinesses(), fetchClients()]);
      setBusinesses(businessRows);
      setClients(clientRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const clientName = (id: string | null) => (id ? clients.find((c) => c.id === id)?.name ?? id : null);

  async function submit() {
    if (!form.name.trim() || !form.slug.trim()) return;
    setBusy(true); setError(null);
    try {
      await createBusiness(form.name, form.slug, form.clientId || null);
      setForm({ name: "", slug: "", clientId: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">Loading…</div>;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-paper">Businesses</h1>
        <span className="text-2xs text-paper-3 font-mono">{businesses.length} total</span>
      </div>
      {error && <p className="text-2xs text-neg">{error}</p>}

      {role === "admin" && (
        <div className="flex flex-wrap items-end gap-2 rounded-[10px] border border-line bg-ink-200 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-paper-3">Name</span>
            <input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-paper-3">Slug</span>
            <input className={field} placeholder="lowercase-with-dashes" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-2xs text-paper-3">Linked client (optional)</span>
            <select className={field} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
              <option value="">None — standalone</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <Button size="sm" variant="primary" disabled={busy || !form.name.trim() || !form.slug.trim()} onClick={() => void submit()}>Create business</Button>
        </div>
      )}

      <Panel title="All Businesses" meta={`${businesses.length}`}>
        {businesses.length === 0 ? (
          <EmptyState icon="board" title="No businesses yet" body="Businesses will appear here once created." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line">
                {["Name", "Slug", "Linked Client", "Created"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-2xs uppercase tracking-cap text-paper-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {businesses.map((b) => (
                <tr
                  key={b.id}
                  onClick={() => navigate(ROUTES.business(b.id))}
                  className="border-b border-line last:border-b-0 hover:bg-ink-100 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2.5 text-paper font-medium">{b.name}</td>
                  <td className="px-3 py-2.5 text-paper-3 font-mono">{b.slug}</td>
                  <td className="px-3 py-2.5 text-paper-2">{clientName(b.client_id) ?? <span className="text-paper-3">standalone</span>}</td>
                  <td className="px-3 py-2.5 text-paper-3 font-mono">{fmtRelative(b.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
