// Stage 2 Phase 06 — Sales. Lead detail: stage advancement, assignment, and
// the manual conversation log -- the pipeline's one real signal source
// until Communications Hub integration (Phase 10) can auto-log real
// touchpoints instead.

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Panel } from "@/components/primitives";
import { fetchSalesLeads, fetchSalesConversations, updateSalesLeadStage, assignSalesLead, logSalesConversation } from "@/lib/sales";
import { fetchBusiness } from "@/lib/business";
import { useBusinessContext } from "@/lib/business-context";
import { fetchStaffUsers, type StaffUserRow } from "@/lib/operations-admin";
import type { SalesLeadRow, SalesConversationRow, SalesLeadStage } from "@/types/sales";
import type { BusinessRow } from "@/types/business";
import { ROUTES } from "@/lib/constants";
import { fmtDateLong, fmtRelative } from "@/lib/format";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

const STAGE_LABEL: Record<SalesLeadStage, string> = {
  lead: "Lead", conversation: "Conversation", opportunity: "Opportunity",
  follow_up: "Follow-Up", closed_won: "Closed Won", closed_lost: "Closed Lost",
};
const NEXT_STAGE: Record<SalesLeadStage, SalesLeadStage | null> = {
  lead: "conversation", conversation: "opportunity", opportunity: "follow_up",
  follow_up: "closed_won", closed_won: null, closed_lost: null,
};

export function SalesLeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { setSelectedBusinessId } = useBusinessContext();
  const [lead, setLead] = useState<SalesLeadRow | null>(null);
  const [business, setBusiness] = useState<BusinessRow | null>(null);
  const [conversations, setConversations] = useState<SalesConversationRow[]>([]);
  const [staff, setStaff] = useState<StaffUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [conversationSummary, setConversationSummary] = useState("");
  const [conversationChannel, setConversationChannel] = useState("manual");

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError(null);
    try {
      const [leads, convs, staffRows] = await Promise.all([fetchSalesLeads(), fetchSalesConversations(id), fetchStaffUsers()]);
      const current = leads.find((l) => l.id === id) ?? null;
      if (!current) { setError("Lead not found."); setLead(null); return; }
      setLead(current);
      setConversations(convs);
      setStaff(staffRows);
      setBusiness(await fetchBusiness(current.business_id));
      // Opening a lead directly by URL is a deliberate selection too -- carry
      // its business into the shared BusinessContext, same as BusinessDetailPage
      // and ClientDetailPage.
      setSelectedBusinessId(current.business_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id, setSelectedBusinessId]);
  useEffect(() => { void load(); }, [load]);

  async function advance() {
    if (!lead) return;
    const next = NEXT_STAGE[lead.stage];
    if (!next) return;
    setBusy(true); setError(null);
    try { await updateSalesLeadStage(lead.id, next); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function closeLost() {
    if (!lead || !lostReason.trim()) return;
    setBusy(true); setError(null);
    try { await updateSalesLeadStage(lead.id, "closed_lost", lostReason); setLostReason(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function reassign(assigneeId: string) {
    if (!lead) return;
    setBusy(true); setError(null);
    try { await assignSalesLead(lead.id, assigneeId || null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function logConversation() {
    if (!lead || !conversationSummary.trim()) return;
    setBusy(true); setError(null);
    try {
      await logSalesConversation(lead.id, conversationSummary, conversationChannel);
      setConversationSummary("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">Loading…</div>;
  if (error || !lead) return <div className="flex-1 flex items-center justify-center text-neg text-xs">{error ?? "Lead not found."}</div>;

  const isClosed = lead.stage === "closed_won" || lead.stage === "closed_lost";

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <button className="text-2xs text-paper-3 hover:text-paper" onClick={() => navigate(ROUTES.sales)}>← Back to Sales</button>
          <h1 className="text-sm font-medium text-paper">{lead.name}</h1>
          <span className="text-2xs text-paper-3">{business?.name ?? lead.business_id}</span>
        </div>
      </div>
      {error && <p className="text-2xs text-neg">{error}</p>}

      <Panel title="Lead">
        <div className="grid grid-cols-2 gap-4 p-4 text-xs sm:grid-cols-3">
          <div>
            <div className="text-2xs uppercase tracking-cap text-paper-3">Stage</div>
            <div className="text-paper">{STAGE_LABEL[lead.stage]}</div>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-cap text-paper-3">Contact</div>
            <div className="text-paper-2">{lead.contact_email ?? "—"} {lead.contact_phone ? `· ${lead.contact_phone}` : ""}</div>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-cap text-paper-3">Source</div>
            <div className="text-paper-2">{lead.source ?? "—"}</div>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-cap text-paper-3">Created</div>
            <div className="text-paper">{fmtDateLong(lead.created_at)}</div>
          </div>
          {isClosed && lead.lost_reason && (
            <div className="col-span-2 sm:col-span-3">
              <div className="text-2xs uppercase tracking-cap text-paper-3">Lost reason</div>
              <div className="text-neg">{lead.lost_reason}</div>
            </div>
          )}
          <div>
            <div className="text-2xs uppercase tracking-cap text-paper-3">Assignee</div>
            <select className={field} value={lead.assignee_id ?? ""} disabled={busy} onChange={(e) => void reassign(e.target.value)}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.email ?? s.id}</option>)}
            </select>
          </div>
        </div>
        {!isClosed && (
          <div className="flex flex-wrap items-end gap-2 border-t border-line p-4">
            {NEXT_STAGE[lead.stage] && (
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void advance()}>
                Move to {STAGE_LABEL[NEXT_STAGE[lead.stage]!]}
              </Button>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-2xs text-paper-3">Close as lost — reason</span>
              <input className={field} value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Required to close as lost" />
            </label>
            <Button size="sm" variant="ghost" disabled={busy || !lostReason.trim()} onClick={() => void closeLost()}>Close as lost</Button>
          </div>
        )}
      </Panel>

      <Panel title="Conversations" meta={`${conversations.length}`}>
        {!isClosed && (
          <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
            <label className="flex flex-col gap-1">
              <span className="text-2xs text-paper-3">Channel</span>
              <select className={field} value={conversationChannel} onChange={(e) => setConversationChannel(e.target.value)}>
                {["manual", "call", "email", "meeting"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="flex flex-1 min-w-[220px] flex-col gap-1">
              <span className="text-2xs text-paper-3">Summary</span>
              <input className={field} value={conversationSummary} onChange={(e) => setConversationSummary(e.target.value)} />
            </label>
            <Button size="sm" variant="primary" disabled={busy || !conversationSummary.trim()} onClick={() => void logConversation()}>Log</Button>
          </div>
        )}
        {conversations.length === 0 ? (
          <p className="p-4 text-2xs text-paper-3">No conversations logged yet.</p>
        ) : (
          <div className="space-y-1 p-2">
            {conversations.map((c) => (
              <div key={c.id} className="rounded border border-line bg-ink p-2 text-2xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono uppercase text-paper-3">{c.channel}</span>
                  <span className="text-paper-3 font-mono ml-auto">{fmtRelative(c.occurred_at)}</span>
                </div>
                <p className="mt-1 text-paper-2">{c.summary}</p>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
