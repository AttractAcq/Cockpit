// Stage 2 Phase 10 — Communications Hub, rehomed under "Conversations" naming
// (Cockpit v3 Step 3). One conversation's timeline, a reply composer (real
// Meta send via send-instagram-message), the manual link-to-Sales-lead-or-
// Delivery-client control -- the exit gate's actual "attribute correctly"
// interaction -- and, once linked, a CRM panel (stage/source/value/assignee
// and the linked lead's own conversation log, or the linked client's
// status/package) so staff see the full picture without leaving this page.

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Panel } from "@/components/primitives";
import { fetchCommsIdentities, fetchCommsMessages, linkCommsIdentity, sendInstagramMessage } from "@/lib/comms";
import { fetchSalesLeads, fetchSalesConversations } from "@/lib/sales";
import { fetchClients } from "@/lib/api";
import { fetchStaffUsers, type StaffUserRow } from "@/lib/operations-admin";
import type { CommsIdentityRow, CommsMessageRow } from "@/types/comms";
import { SALES_STAGE_LABEL } from "@/types/sales";
import type { SalesLeadRow, SalesConversationRow } from "@/types/sales";
import { TIER_LABELS } from "@/types/client";
import type { Client } from "@/types/client";
import { ROUTES } from "@/lib/constants";
import { fmtDateLong, fmtRelative, fmtCents } from "@/lib/format";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

export function CommsConversationPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [identity, setIdentity] = useState<CommsIdentityRow | null>(null);
  const [messages, setMessages] = useState<CommsMessageRow[]>([]);
  const [leads, setLeads] = useState<SalesLeadRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [staff, setStaff] = useState<StaffUserRow[]>([]);
  const [leadConversations, setLeadConversations] = useState<SalesConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [linkTarget, setLinkTarget] = useState("");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const [identities, msgs, l, c, s] = await Promise.all([
        fetchCommsIdentities(), fetchCommsMessages(id), fetchSalesLeads(), fetchClients(), fetchStaffUsers(),
      ]);
      const current = identities.find((i) => i.id === id) ?? null;
      if (!current) { setError("Conversation not found."); setIdentity(null); return; }
      setIdentity(current);
      setMessages(msgs);
      setLeads(l); setClients(c); setStaff(s);
      setLinkTarget(current.matched_lead_id ? `lead:${current.matched_lead_id}` : current.matched_client_id ? `client:${current.matched_client_id}` : "");
      // The linked lead's own Sales conversation log, shown alongside the
      // message timeline so a staff member sees the full CRM picture --
      // Sales stage, source, value -- without leaving Conversations.
      setLeadConversations(current.matched_lead_id ? await fetchSalesConversations(current.matched_lead_id) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function send() {
    if (!identity || !reply.trim()) return;
    setBusy(true); setError(null);
    try {
      await sendInstagramMessage(identity.id, reply);
      setReply("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyLink(value: string) {
    if (!identity) return;
    setBusy(true); setError(null);
    try {
      const [kind, targetId] = value.split(":");
      await linkCommsIdentity(identity.id, kind === "lead" ? targetId : null, kind === "client" ? targetId : null);
      setLinkTarget(value);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const staffLabel = (uid: string | null) => (uid ? staff.find((s) => s.id === uid)?.full_name ?? uid : "—");

  if (loading) return <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">Loading…</div>;
  if (error || !identity) return <div className="flex-1 flex items-center justify-center text-neg text-xs">{error ?? "Conversation not found."}</div>;

  const linkedLead = identity.matched_lead_id ? leads.find((l) => l.id === identity.matched_lead_id) ?? null : null;
  const linkedClient = identity.matched_client_id ? clients.find((c) => c.id === identity.matched_client_id) ?? null : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div>
        <button className="text-2xs text-paper-3 hover:text-paper" onClick={() => navigate(ROUTES.comms)}>← Back to Conversations</button>
        <h1 className="text-sm font-medium text-paper">{identity.display_name ?? identity.external_user_id}</h1>
        <span className="text-2xs text-paper-3 font-mono uppercase">{identity.platform} · first seen {fmtDateLong(identity.first_seen_at)}</span>
      </div>
      {error && <p className="text-2xs text-neg">{error}</p>}

      <Panel title="Link to">
        <div className="flex flex-wrap items-end gap-2 p-3">
          <select className={field} value={linkTarget} disabled={busy} onChange={(e) => void applyLink(e.target.value)}>
            <option value="">Unlinked</option>
            <optgroup label="Sales leads">
              {leads.map((l) => <option key={l.id} value={`lead:${l.id}`}>{l.name}</option>)}
            </optgroup>
            <optgroup label="Delivery clients">
              {clients.map((c) => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}
            </optgroup>
          </select>
          {identity.matched_at && <span className="text-2xs text-paper-3">Linked {fmtRelative(identity.matched_at)} by {staffLabel(identity.matched_by)}</span>}
        </div>
      </Panel>

      {linkedLead && (
        <Panel title="CRM" meta="Sales lead">
          <div className="grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-4">
            <div>
              <div className="text-2xs uppercase tracking-cap text-paper-3">Stage</div>
              <div className="text-paper">{SALES_STAGE_LABEL[linkedLead.stage]}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-cap text-paper-3">Source</div>
              <div className="text-paper-2">{linkedLead.source ?? "—"}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-cap text-paper-3">Est. value</div>
              <div className="text-paper-2 font-mono tabular-nums">{fmtCents(linkedLead.estimated_value_cents)}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-cap text-paper-3">Assignee</div>
              <div className="text-paper-2">{staffLabel(linkedLead.assignee_id)}</div>
            </div>
          </div>
          {leadConversations.length > 0 && (
            <div className="border-t border-line p-3">
              <div className="mb-1 text-2xs uppercase tracking-cap text-paper-3">Previous Sales interactions</div>
              <div className="space-y-1">
                {leadConversations.map((c) => (
                  <div key={c.id} className="text-2xs text-paper-2">
                    <span className="text-paper-3 font-mono uppercase">{c.channel}</span> · {c.summary} <span className="text-paper-3">({fmtRelative(c.occurred_at)})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border-t border-line p-3">
            <button className="text-2xs text-teal hover:underline" onClick={() => navigate(ROUTES.salesLead(linkedLead.id))}>View full lead →</button>
          </div>
        </Panel>
      )}

      {linkedClient && (
        <Panel title="CRM" meta="Delivery client">
          <div className="grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-4">
            <div>
              <div className="text-2xs uppercase tracking-cap text-paper-3">Status</div>
              <div className="text-paper capitalize">{linkedClient.status}</div>
            </div>
            <div>
              <div className="text-2xs uppercase tracking-cap text-paper-3">Package</div>
              <div className="text-paper-2">{TIER_LABELS[linkedClient.package_tier]}</div>
            </div>
          </div>
          <div className="border-t border-line p-3">
            <button className="text-2xs text-teal hover:underline" onClick={() => navigate(ROUTES.clientSection(linkedClient.id, "overview"))}>View client →</button>
          </div>
        </Panel>
      )}

      <Panel title="Timeline" meta={`${messages.length}`}>
        {messages.length === 0 ? (
          <p className="p-4 text-2xs text-paper-3">No messages yet.</p>
        ) : (
          <div className="space-y-1 p-2">
            {messages.map((m) => (
              <div key={m.id} className={`rounded border p-2 text-2xs ${m.direction === "outbound" ? "border-teal/30 bg-teal/5 ml-8" : "border-line bg-ink mr-8"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-mono uppercase ${m.direction === "outbound" ? "text-teal" : "text-info"}`}>{m.direction}</span>
                  {m.direction === "outbound" && <span className="text-paper-3">{staffLabel(m.sent_by)}</span>}
                  <span className="text-paper-3 font-mono ml-auto">{fmtRelative(m.occurred_at)}</span>
                </div>
                <p className="mt-1 text-paper-2">{m.body}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-line p-3">
          <input className={`${field} flex-1 min-w-[220px]`} placeholder="Reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
          <Button size="sm" variant="primary" disabled={busy || !reply.trim()} onClick={() => void send()}>Send</Button>
        </div>
      </Panel>
    </div>
  );
}
