// Programme Stage O — Multi-Client Scale and Operational Control. Cross-
// client admin surface: real-data observability metrics, team/role
// assignment, work allocation, cost/margin tracking, and onboarding.
// Replaces nothing — sits alongside OperationsPage's existing, unchanged
// Activity Log as a second tab.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchClients } from "@/lib/api";
import {
  fetchTeamMembers, assignTeamMember, removeTeamMember, fetchStaffUsers,
  fetchWorkItems, createWorkItem, updateWorkItemStatus,
  fetchMarginSummary, recordCostEntry, setClientRevenueEstimate,
  fetchOnboardingTemplates, createOnboardingTemplate, onboardClient,
  type StaffUserRow,
} from "@/lib/operations-admin";
import { supabase } from "@/lib/supabase";
import { computePublishSuccessRate, summariseExceptions, summariseQueueAge, summariseApprovalDelays, type PublishAttemptLike, type ExceptionLike } from "@/lib/observability";
import { ALL_ROLES, ROLE_LABEL, COST_CATEGORIES, COST_CATEGORY_LABEL } from "@/types/operations";
import { AUTOMATION_AREAS } from "@/types/automation";
import type { Client } from "@/types/client";
import type { TeamMemberRow, ClientWorkItemRow, WorkItemStatus, ClientMarginSummaryRow, ClientOnboardingTemplateRow, CostCategory } from "@/types/operations";

type Notice = { kind: "success" | "error"; text: string } | null;
function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: string }).message);
  return error instanceof Error ? error.message : String(error);
}
const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";
const TABS = ["metrics", "team", "work", "cost", "onboarding"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { metrics: "Metrics", team: "Team & Roles", work: "Work Items", cost: "Cost & Margin", onboarding: "Onboarding" };

function MetricsSection({ clients }: { clients: Client[] }) {
  const [attempts, setAttempts] = useState<PublishAttemptLike[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionLike[]>([]);
  const [workItems, setWorkItems] = useState<ClientWorkItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: attemptRows, error: attemptErr }, { data: exceptionRows, error: exceptionErr }, items] = await Promise.all([
        supabase.from("client_publish_attempts").select("result, completed_at, started_at").order("started_at", { ascending: false }).limit(500),
        supabase.from("client_exception_queue").select("status, severity, created_at").limit(500),
        fetchWorkItems(),
      ]);
      if (attemptErr) throw attemptErr;
      if (exceptionErr) throw exceptionErr;
      setAttempts((attemptRows ?? []) as PublishAttemptLike[]);
      setExceptions((exceptionRows ?? []) as ExceptionLike[]);
      setWorkItems(items);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const publishRate = useMemo(() => computePublishSuccessRate(attempts), [attempts]);
  const exceptionSummary = useMemo(() => summariseExceptions(exceptions), [exceptions]);
  const exceptionAge = useMemo(() => summariseQueueAge(exceptions, ["resolved"]), [exceptions]);
  const approvalDelays = useMemo(() => summariseApprovalDelays(workItems), [workItems]);
  const contentOutput = useMemo(() => workItems.filter((item) => item.status === "done").length, [workItems]);

  if (loading) return <p className="text-2xs text-paper-3">Loading metrics…</p>;
  return <div className="space-y-3">
    {notice && <p className="text-2xs text-neg">{notice.text}</p>}
    <p className="text-2xs text-paper-3">Computed live from real tables (client_publish_attempts, client_exception_queue, client_work_items) — nothing here is a separately-maintained counter. Provider health and analytics freshness are not tracked yet; see Stage_O_Status.md.</p>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div className="rounded border border-line bg-ink-200 p-3"><div className="font-mono text-lg text-paper">{publishRate.successRate ?? "—"}{publishRate.successRate != null ? "%" : ""}</div><div className="text-2xs text-paper-3">Publishing success ({publishRate.terminalAttempts} decided)</div></div>
      <div className="rounded border border-line bg-ink-200 p-3"><div className="font-mono text-lg text-paper">{exceptionSummary.openCount}</div><div className="text-2xs text-paper-3">Open exceptions ({exceptionSummary.highSeverityOpenCount} high severity)</div></div>
      <div className="rounded border border-line bg-ink-200 p-3"><div className="font-mono text-lg text-paper">{exceptionAge.oldestAgeHours ?? "—"}{exceptionAge.oldestAgeHours != null ? "h" : ""}</div><div className="text-2xs text-paper-3">Oldest open exception (avg {exceptionAge.averageAgeHours ?? "—"}h)</div></div>
      <div className="rounded border border-line bg-ink-200 p-3"><div className="font-mono text-lg text-paper">{approvalDelays.overdueCount}</div><div className="text-2xs text-paper-3">Overdue work items ({approvalDelays.dueSoonCount} due within 24h)</div></div>
      <div className="rounded border border-line bg-ink-200 p-3"><div className="font-mono text-lg text-paper">{contentOutput}</div><div className="text-2xs text-paper-3">Work items completed</div></div>
      <div className="rounded border border-line bg-ink-200 p-3"><div className="font-mono text-lg text-paper">{clients.length}</div><div className="text-2xs text-paper-3">Clients</div></div>
      <div className="rounded border border-line bg-ink-200 p-3"><div className="font-mono text-lg text-paper">{publishRate.published}</div><div className="text-2xs text-paper-3">Published (last 500 attempts)</div></div>
      <div className="rounded border border-line bg-ink-200 p-3"><div className="font-mono text-lg text-paper">{publishRate.permanentFailures}</div><div className="text-2xs text-paper-3">Permanent publish failures</div></div>
    </div>
    <Button size="sm" variant="ghost" onClick={() => void load()}>Reload</Button>
  </div>;
}

function TeamRolesSection({ clients }: { clients: Client[] }) {
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [staff, setStaff] = useState<StaffUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [form, setForm] = useState({ userId: "", clientId: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { const [m, s] = await Promise.all([fetchTeamMembers(), fetchStaffUsers()]); setMembers(m); setStaff(s); }
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

  return <div className="space-y-3">
    <p className="text-2xs text-paper-3">All 9 Stage O roles ({ALL_ROLES.map((r) => ROLE_LABEL[r]).join(", ")}) now resolve real client-scoped visibility via this assignment table, not just Admin/Account Manager. Fine-grained per-role write permissions are not split yet — see Stage_O_Status.md. Visible users are whatever RLS permits (Admin sees all; others see only themselves).</p>
    {notice && <p className={`text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    <div className="flex flex-wrap items-end gap-2 rounded border border-line bg-ink-200 p-3">
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Staff user</span><select className={field} value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">Select…</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email ?? u.id} — {ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] ?? u.role}</option>)}</select></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Client</span><select className={field} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Select…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <Button size="sm" variant="primary" disabled={busy || !form.userId || !form.clientId} onClick={() => void assign()}>Assign</Button>
    </div>
    {loading ? <p className="text-2xs text-paper-3">Loading…</p> : members.length === 0 ? <p className="text-2xs text-paper-3">No team assignments yet.</p> : <div className="space-y-1">
      {members.map((m) => <div key={m.id} className="flex items-center justify-between rounded border border-line bg-ink p-2 text-2xs"><span className="text-paper">{userLabel(m.user_id)} → {clientName(m.client_id)}</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove(m.id)}>Remove</Button></div>)}
    </div>}
  </div>;
}

function WorkItemsSection({ clients }: { clients: Client[] }) {
  const [items, setItems] = useState<ClientWorkItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [form, setForm] = useState({ clientId: "", title: "", priority: "normal", dueAt: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await fetchWorkItems()); } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!form.clientId || !form.title.trim()) return;
    setBusy("create"); setNotice(null);
    try {
      await createWorkItem({ clientId: form.clientId, title: form.title, priority: form.priority as ClientWorkItemRow["priority"], dueAt: form.dueAt || null });
      setForm({ clientId: form.clientId, title: "", priority: "normal", dueAt: "" }); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }
  async function move(item: ClientWorkItemRow, status: WorkItemStatus) {
    setBusy(item.id); setNotice(null);
    try {
      const reason = status === "blocked" ? window.prompt("Why is this blocked?") ?? "" : undefined;
      if (status === "blocked" && !reason) { setBusy(null); return; }
      await updateWorkItemStatus(item.id, status, reason); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  return <div className="space-y-3">
    {notice && <p className="text-2xs text-neg">{notice.text}</p>}
    <div className="flex flex-wrap items-end gap-2 rounded border border-line bg-ink-200 p-3">
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Client</span><select className={field} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Select…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Title</span><input className={field} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Priority</span><select className={field} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Due</span><input type="datetime-local" className={field} value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></label>
      <Button size="sm" variant="primary" disabled={busy === "create" || !form.clientId || !form.title.trim()} onClick={() => void create()}>Create</Button>
    </div>
    {loading ? <p className="text-2xs text-paper-3">Loading…</p> : items.length === 0 ? <p className="text-2xs text-paper-3">No work items yet.</p> : <div className="space-y-1">
      {items.map((item) => <div key={item.id} className="rounded border border-line bg-ink p-2 text-2xs">
        <div className="flex flex-wrap items-center gap-2"><span className="text-paper">{item.title}</span><span className="text-paper-3">{clientName(item.client_id)} · {item.priority} · {item.status}{item.due_at ? ` · due ${new Date(item.due_at).toLocaleString()}` : ""}</span></div>
        {item.blocked_reason && <p className="mt-1 text-warn">Blocked: {item.blocked_reason}</p>}
        {item.status !== "done" && <div className="mt-1 flex flex-wrap gap-1">
          {item.status !== "in_progress" && <Button size="sm" variant="ghost" disabled={busy === item.id} onClick={() => void move(item, "in_progress")}>Start</Button>}
          {item.status !== "review" && <Button size="sm" variant="ghost" disabled={busy === item.id} onClick={() => void move(item, "review")}>To review</Button>}
          {item.status !== "blocked" && <Button size="sm" variant="ghost" disabled={busy === item.id} onClick={() => void move(item, "blocked")}>Block</Button>}
          <Button size="sm" variant="primary" disabled={busy === item.id} onClick={() => void move(item, "done")}>Done</Button>
        </div>}
      </div>)}
    </div>}
  </div>;
}

function CostMarginSection({ clients }: { clients: Client[] }) {
  const [summary, setSummary] = useState<ClientMarginSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [entryForm, setEntryForm] = useState({ clientId: "", category: "model_spend" as CostCategory, amount: "", notes: "" });
  const [revenueForm, setRevenueForm] = useState({ clientId: "", amount: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setSummary(await fetchMarginSummary()); } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function record() {
    if (!entryForm.clientId || !entryForm.amount) return;
    setBusy(true); setNotice(null);
    try {
      await recordCostEntry({ clientId: entryForm.clientId, costCategory: entryForm.category, amount: Number(entryForm.amount), notes: entryForm.notes || null });
      setEntryForm({ ...entryForm, amount: "", notes: "" }); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }
  async function saveRevenue() {
    if (!revenueForm.clientId) return;
    setBusy(true); setNotice(null);
    try {
      await setClientRevenueEstimate(revenueForm.clientId, revenueForm.amount ? Number(revenueForm.amount) : null);
      setNotice({ kind: "success", text: "Revenue estimate saved." }); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  return <div className="space-y-3">
    {notice && <p className={`text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded border border-line bg-ink-200 p-3">
        <h4 className="mb-2 text-xs font-medium text-paper">Record a cost entry</h4>
        <div className="flex flex-wrap items-end gap-2">
          <select className={field} value={entryForm.clientId} onChange={(e) => setEntryForm({ ...entryForm, clientId: e.target.value })}><option value="">Client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className={field} value={entryForm.category} onChange={(e) => setEntryForm({ ...entryForm, category: e.target.value as CostCategory })}>{COST_CATEGORIES.map((c) => <option key={c} value={c}>{COST_CATEGORY_LABEL[c]}</option>)}</select>
          <input type="number" min="0" step="0.01" className={field} placeholder="Amount (EUR)" value={entryForm.amount} onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })} />
          <Button size="sm" variant="primary" disabled={busy || !entryForm.clientId || !entryForm.amount} onClick={() => void record()}>Record</Button>
        </div>
      </div>
      <div className="rounded border border-line bg-ink-200 p-3">
        <h4 className="mb-2 text-xs font-medium text-paper">Set monthly revenue estimate</h4>
        <p className="mb-2 text-2xs text-paper-3">Optional. No margin figure is shown until this is set — never fabricated.</p>
        <div className="flex flex-wrap items-end gap-2">
          <select className={field} value={revenueForm.clientId} onChange={(e) => setRevenueForm({ ...revenueForm, clientId: e.target.value })}><option value="">Client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <input type="number" min="0" step="0.01" className={field} placeholder="EUR / month" value={revenueForm.amount} onChange={(e) => setRevenueForm({ ...revenueForm, amount: e.target.value })} />
          <Button size="sm" variant="primary" disabled={busy || !revenueForm.clientId} onClick={() => void saveRevenue()}>Save</Button>
        </div>
      </div>
    </div>
    {loading ? <p className="text-2xs text-paper-3">Loading…</p> : <div className="space-y-1">
      {summary.filter((row) => row.total_cost > 0 || row.monthly_revenue_estimate != null).map((row) => <div key={row.client_id} className="rounded border border-line bg-ink p-2 text-2xs">
        <div className="flex flex-wrap items-center gap-2"><span className="text-paper">{row.client_name}</span><span className="text-paper-3">Total cost: €{row.total_cost.toFixed(2)}{row.estimated_margin != null && ` · Estimated margin: €${row.estimated_margin.toFixed(2)}`}</span></div>
        {row.cost_by_category && <p className="mt-1 text-paper-3">{Object.entries(row.cost_by_category).map(([cat, amt]) => `${COST_CATEGORY_LABEL[cat as CostCategory] ?? cat}: €${Number(amt).toFixed(2)}`).join(" · ")}</p>}
      </div>)}
      {summary.every((row) => row.total_cost === 0 && row.monthly_revenue_estimate == null) && <p className="text-2xs text-paper-3">No cost entries or revenue estimates recorded yet.</p>}
    </div>}
  </div>;
}

function OnboardingSection({ clients, onOnboarded }: { clients: Client[]; onOnboarded: () => void }) {
  const [templates, setTemplates] = useState<ClientOnboardingTemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [form, setForm] = useState({ name: "", slug: "", templateId: "", geography: "" });
  const [newTemplate, setNewTemplate] = useState({ name: "", retryCap: "5", priority: "normal" });

  const load = useCallback(async () => {
    setLoading(true);
    try { setTemplates(await fetchOnboardingTemplates()); } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onboard() {
    if (!form.name.trim() || !form.slug.trim()) return;
    setBusy(true); setNotice(null);
    try {
      await onboardClient({ name: form.name, slug: form.slug, templateId: form.templateId || null, geography: form.geography || null });
      setNotice({ kind: "success", text: `Client "${form.name}" onboarded.` });
      setForm({ name: "", slug: "", templateId: "", geography: "" });
      onOnboarded();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  async function createTemplate() {
    if (!newTemplate.name.trim()) return;
    setBusy(true); setNotice(null);
    try {
      await createOnboardingTemplate({
        name: newTemplate.name,
        defaultAutomationPolicies: AUTOMATION_AREAS.map((area) => ({ area, automation_level: "automatic" })),
        defaultCapacityPolicy: { retry_cap: Number(newTemplate.retryCap) || 5, client_priority: newTemplate.priority },
        defaultContentRequirements: [],
      });
      setNewTemplate({ name: "", retryCap: "5", priority: "normal" }); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  return <div className="space-y-3">
    <p className="text-2xs text-paper-3">Industry starter packs, proof schemas, and brand-configuration templates are not built yet — see Stage_O_Status.md. A template today applies a default automation policy (all 14 Stage N areas) and capacity policy in one call.</p>
    {notice && <p className={`text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    <div className="rounded border border-line bg-ink-200 p-3">
      <h4 className="mb-2 text-xs font-medium text-paper">Onboard a client</h4>
      <div className="flex flex-wrap items-end gap-2">
        <input className={field} placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className={field} placeholder="Slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
        <input className={field} placeholder="Geography (optional)" value={form.geography} onChange={(e) => setForm({ ...form, geography: e.target.value })} />
        <select className={field} value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}><option value="">No template</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <Button size="sm" variant="primary" disabled={busy || !form.name.trim() || !form.slug.trim()} onClick={() => void onboard()}>Onboard</Button>
      </div>
    </div>
    <div className="rounded border border-line bg-ink-200 p-3">
      <h4 className="mb-2 text-xs font-medium text-paper">Create a starter template</h4>
      <div className="flex flex-wrap items-end gap-2">
        <input className={field} placeholder="Template name" value={newTemplate.name} onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })} />
        <input type="number" min="1" max="20" className={field} placeholder="Retry cap" value={newTemplate.retryCap} onChange={(e) => setNewTemplate({ ...newTemplate, retryCap: e.target.value })} />
        <select className={field} value={newTemplate.priority} onChange={(e) => setNewTemplate({ ...newTemplate, priority: e.target.value })}><option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option></select>
        <Button size="sm" variant="secondary" disabled={busy || !newTemplate.name.trim()} onClick={() => void createTemplate()}>Create template</Button>
      </div>
    </div>
    {loading ? <p className="text-2xs text-paper-3">Loading templates…</p> : <div className="space-y-1">
      {templates.map((t) => <div key={t.id} className="rounded border border-line bg-ink p-2 text-2xs"><span className="text-paper">{t.name}</span><span className="ml-2 text-paper-3">{t.default_automation_policies.length} automation areas set</span></div>)}
    </div>}
    <p className="text-2xs text-paper-3">{clients.length} client{clients.length === 1 ? "" : "s"} onboarded to date.</p>
  </div>;
}

export function OperationsControlPanel() {
  const [tab, setTab] = useState<Tab>("metrics");
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setClients(await fetchClients()); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="p-4 text-2xs text-paper-3">Loading…</p>;
  return <div className="flex flex-col gap-3 p-4">
    <div className="flex flex-wrap gap-2 border-b border-line pb-2">
      {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded px-2 py-1 text-2xs ${tab === t ? "bg-teal/10 text-teal" : "text-paper-3 hover:text-paper"}`}>{TAB_LABEL[t]}</button>)}
    </div>
    {tab === "metrics" && <MetricsSection clients={clients} />}
    {tab === "team" && <TeamRolesSection clients={clients} />}
    {tab === "work" && <WorkItemsSection clients={clients} />}
    {tab === "cost" && <CostMarginSection clients={clients} />}
    {tab === "onboarding" && <OnboardingSection clients={clients} onOnboarded={() => void load()} />}
  </div>;
}
