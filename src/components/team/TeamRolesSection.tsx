// Cockpit v3 Step 2 — extracted from OperationsControlPanel.tsx's Team &
// Roles tab, same reasoning as automations/WorkflowsSection.tsx: shared by
// the original Operations location and the new top-level Team page, no
// behaviour change. Made self-contained (fetches its own `clients` instead
// of receiving them as a prop) so it works identically from either parent,
// matching the Workflows/Triggers precedent of taking no props at all.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchClients } from "@/lib/api";
import { fetchTeamMembers, assignTeamMember, removeTeamMember, fetchStaffUsers, type StaffUserRow } from "@/lib/operations-admin";
import { fetchWorkflows } from "@/lib/workflows";
import { ALL_ROLES, ROLE_LABEL, type TeamMemberRow } from "@/types/operations";
import type { Client } from "@/types/client";

const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";
type Notice = { kind: "success" | "error"; text: string } | null;
function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: string }).message);
  return error instanceof Error ? error.message : String(error);
}

export function TeamRolesSection() {
  const [clients, setClients] = useState<Client[]>([]);
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [staff, setStaff] = useState<StaffUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [form, setForm] = useState({ userId: "", clientId: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, m, s] = await Promise.all([fetchClients(), fetchTeamMembers(), fetchStaffUsers()]);
      setClients(c); setMembers(m); setStaff(s);
    }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function assign() {
    if (!form.userId || !form.clientId) return;
    setBusy(true); setNotice(null);
    try { await assignTeamMember(form.userId, form.clientId); setNotice({ kind: "success", text: "Team member assigned." }); await load(); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); setNotice(null);
    try { await removeTeamMember(id); await load(); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  const userLabel = (id: string) => { const u = staff.find((s) => s.id === id); return u ? `${u.full_name ?? u.email ?? id} (${ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role})` : id; };

  // Stage 2 Phase 09 — Team. Every current human role (from the real users
  // table, staff.length below) and every current live automation (Phase
  // 03's already-real, CI-governed edge-function registry) in one
  // directory -- zero new schema, zero new RPCs. "Agent roles" excludes
  // retired functions deliberately: the exit gate is every *current* role,
  // and a retired function isn't one. Capacity is honestly stated as not
  // tracked yet rather than fabricated -- Phase 00's own audit already
  // found capacity/performance data isn't real, and the phase card itself
  // defers capacity-based auto-allocation to Executive AI (Cockpit v3 Step 5).
  const agentRoles = useMemo(() => fetchWorkflows().filter((w) => w.profile !== "retired"), []);

  if (loading) return <p className="text-2xs text-paper-3">Loading…</p>;
  return <div className="space-y-3">
    <p className="text-2xs text-paper-3">All 9 Stage O roles ({ALL_ROLES.map((r) => ROLE_LABEL[r]).join(", ")}) now resolve real client-scoped visibility via this assignment table, not just Admin/Account Manager. Fine-grained per-role write permissions are not split yet — see Stage_O_Status.md. Visible users are whatever RLS permits (Admin sees all; others see only themselves).</p>
    {notice && <p className={`text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    <div className="flex flex-wrap items-end gap-2 rounded border border-line bg-ink-200 p-3">
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Staff user</span><select className={field} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">Select…</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email ?? u.id} — {ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role}</option>)}</select></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Client</span><select className={field} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Select…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <Button size="sm" variant="primary" disabled={busy || !form.userId || !form.clientId} onClick={() => void assign()}>Assign</Button>
    </div>
    {members.length === 0 ? <p className="text-2xs text-paper-3">No team assignments yet.</p> : <div className="space-y-1">
      {members.map((m) => <div key={m.id} className="flex items-center justify-between rounded border border-line bg-ink p-2 text-2xs"><span className="text-paper">{userLabel(m.user_id)} → {clientName(m.client_id)}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(m.id)}>Remove</Button></div>)}
    </div>}

    <div className="space-y-2 border-t border-line pt-3">
      <h4 className="text-xs font-medium text-paper">Team Directory — humans and agents</h4>
      <p className="text-2xs text-paper-3">Every current human role visible to you (from the real users table above) and every current live automation (Phase 03's governed edge-function registry, {agentRoles.length} active) in one directory — nothing invented. Capacity is not tracked yet; see Stage_O_Status.md.</p>
      <div className="space-y-1">
        {staff.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-2 rounded border border-line bg-ink p-2 text-2xs">
          <span className="font-mono uppercase text-teal">Human</span>
          <span className="text-paper">{s.full_name ?? s.email ?? s.id}</span>
          <span className="text-paper-3">{ROLE_LABEL[s.role as keyof typeof ROLE_LABEL] ?? s.role}</span>
        </div>)}
        {agentRoles.map((w) => <div key={w.name} className="flex flex-wrap items-center gap-2 rounded border border-line bg-ink p-2 text-2xs">
          <span className="font-mono uppercase text-info">Agent</span>
          <span className="text-paper">{w.name}</span>
          <span className="text-paper-3">{w.purpose}</span>
        </div>)}
      </div>
    </div>
  </div>;
}
