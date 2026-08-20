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
  fetchProjects, createProject, updateProjectStatus,
  fetchDeliverables, createDeliverable, updateDeliverableStatus,
  fetchFinancePeriods, openFinancePeriod, reconcileFinancePeriod, importCostEntries,
  type StaffUserRow,
} from "@/lib/operations-admin";
import { parseCostEntriesCsv } from "@/lib/finance-csv";
import { supabase } from "@/lib/supabase";
import { computePublishSuccessRate, summariseExceptions, summariseQueueAge, summariseApprovalDelays, type PublishAttemptLike, type ExceptionLike } from "@/lib/observability";
import { fetchWorkflows, fetchScheduledTriggers, UNDOCUMENTED_DEPLOYMENTS, type ScheduledTrigger } from "@/lib/workflows";
import { ALL_ROLES, ROLE_LABEL, COST_CATEGORIES, COST_CATEGORY_LABEL } from "@/types/operations";
import { AUTOMATION_AREAS } from "@/types/automation";
import type { Client } from "@/types/client";
import type {
  TeamMemberRow, ClientWorkItemRow, WorkItemStatus, ClientMarginSummaryRow, ClientOnboardingTemplateRow, CostCategory,
  ClientProjectRow, ProjectStatus, ClientDeliverableRow, DeliverableStatus, ClientFinancePeriodRow, FinancePeriodStatus,
} from "@/types/operations";
import { IntelligenceOperationsPanel } from "./IntelligenceOperationsPanel";

type Notice = { kind: "success" | "error"; text: string } | null;
function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: string }).message);
  return error instanceof Error ? error.message : String(error);
}
const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";
const TABS = ["metrics", "intelligence", "workflows", "triggers", "team", "work", "projects", "cost", "onboarding"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { metrics: "Metrics", intelligence: "Intelligence", workflows: "Workflows", triggers: "Triggers", team: "Team & Roles", work: "Work Items", projects: "Projects", cost: "Cost & Margin", onboarding: "Onboarding" };

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

const PROFILE_COLOR: Record<string, string> = {
  ui_authority: "text-teal", ui_operational: "text-teal", ui_held: "text-warn",
  operator_internal: "text-info", function_internal: "text-paper-3",
  cron_jwt_disabled: "text-warn", cron_jwt_verified: "text-warn", retired: "text-neg",
};

function WorkflowsSection() {
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

function TriggersSection() {
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

const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = { planning: "text-paper-3", active: "text-teal", on_hold: "text-warn", completed: "text-pos", archived: "text-paper-3" };
const PROJECT_NEXT_STATUS: Record<ProjectStatus, ProjectStatus | null> = { planning: "active", active: "completed", on_hold: "active", completed: null, archived: null };
const DELIVERABLE_STATUS_COLOR: Record<DeliverableStatus, string> = { draft: "text-paper-3", in_review: "text-info", delivered: "text-teal", approved: "text-pos", rejected: "text-neg" };
const DELIVERABLE_NEXT_STATUS: Record<DeliverableStatus, DeliverableStatus | null> = { draft: "in_review", in_review: "delivered", delivered: "approved", approved: null, rejected: null };

function ProjectsSection({ clients }: { clients: Client[] }) {
  const [projects, setProjects] = useState<ClientProjectRow[]>([]);
  const [staff, setStaff] = useState<StaffUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [form, setForm] = useState({ clientId: "", name: "", description: "", ownerId: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const [p, s] = await Promise.all([fetchProjects(), fetchStaffUsers()]); setProjects(p); setStaff(s); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!form.clientId || !form.name.trim()) return;
    setBusy("create"); setNotice(null);
    try {
      const id = await createProject({ clientId: form.clientId, name: form.name, description: form.description || null, ownerId: form.ownerId || null });
      setForm({ clientId: form.clientId, name: "", description: "", ownerId: "" });
      await load();
      setSelectedId(id);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }
  async function advance(project: ClientProjectRow) {
    const next = PROJECT_NEXT_STATUS[project.status];
    if (!next) return;
    setBusy(project.id); setNotice(null);
    try { await updateProjectStatus(project.id, next); await load(); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  return <div className="space-y-3">
    {notice && <p className="text-2xs text-neg">{notice.text}</p>}
    <p className="text-2xs text-paper-3">Groups client_work_items under a named engagement -- the piece missing above individual tasks. Tasks and Deliverables for the selected project are below.</p>
    <div className="flex flex-wrap items-end gap-2 rounded border border-line bg-ink-200 p-3">
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Client</span><select className={field} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Select…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Name</span><input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Owner (optional)</span><select className={field} value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.email ?? s.id}</option>)}</select></label>
      <Button size="sm" variant="primary" disabled={busy === "create" || !form.clientId || !form.name.trim()} onClick={() => void create()}>Create project</Button>
    </div>
    {loading ? <p className="text-2xs text-paper-3">Loading…</p> : projects.length === 0 ? <p className="text-2xs text-paper-3">No projects yet.</p> : <div className="space-y-1">
      {projects.map((p) => <div key={p.id} className={`rounded border p-2 text-2xs cursor-pointer ${selectedId === p.id ? "border-teal/50 bg-ink" : "border-line bg-ink hover:bg-ink-100"}`} onClick={() => setSelectedId(p.id === selectedId ? null : p.id)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-paper font-medium">{p.name}</span>
          <span className="text-paper-3">{clientName(p.client_id)}</span>
          <span className={`font-mono uppercase ${PROJECT_STATUS_COLOR[p.status]}`}>{p.status}</span>
          {PROJECT_NEXT_STATUS[p.status] && (
            <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={(e) => { e.stopPropagation(); void advance(p); }}>Move to {PROJECT_NEXT_STATUS[p.status]}</Button>
          )}
        </div>
      </div>)}
    </div>}
    {selected && <ProjectDetail project={selected} staff={staff} onChanged={() => void load()} />}
  </div>;
}

function ProjectDetail({ project, staff, onChanged }: { project: ClientProjectRow; staff: StaffUserRow[]; onChanged: () => void }) {
  const [tasks, setTasks] = useState<ClientWorkItemRow[]>([]);
  const [deliverables, setDeliverables] = useState<ClientDeliverableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [taskForm, setTaskForm] = useState({ title: "", assigneeId: "" });
  const [deliverableForm, setDeliverableForm] = useState({ name: "", ownerId: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, deliv] = await Promise.all([fetchWorkItems(project.client_id), fetchDeliverables(project.id)]);
      setTasks(items.filter((i) => i.project_id === project.id));
      setDeliverables(deliv);
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, [project.id, project.client_id]);
  useEffect(() => { void load(); }, [load]);

  async function addTask() {
    if (!taskForm.title.trim()) return;
    setBusy("task"); setNotice(null);
    try {
      await createWorkItem({ clientId: project.client_id, title: taskForm.title, assigneeId: taskForm.assigneeId || null, projectId: project.id });
      setTaskForm({ title: "", assigneeId: "" }); await load(); onChanged();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }
  async function moveTask(item: ClientWorkItemRow, status: WorkItemStatus) {
    setBusy(item.id); setNotice(null);
    try {
      const reason = status === "blocked" ? window.prompt("Why is this blocked?") ?? "" : undefined;
      if (status === "blocked" && !reason) { setBusy(null); return; }
      await updateWorkItemStatus(item.id, status, reason); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }
  async function addDeliverable() {
    if (!deliverableForm.name.trim()) return;
    setBusy("deliverable"); setNotice(null);
    try {
      await createDeliverable({ projectId: project.id, name: deliverableForm.name, ownerId: deliverableForm.ownerId || null });
      setDeliverableForm({ name: "", ownerId: "" }); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }
  async function advanceDeliverable(d: ClientDeliverableRow) {
    const next = DELIVERABLE_NEXT_STATUS[d.status];
    if (!next) return;
    setBusy(d.id); setNotice(null);
    try {
      const link = next === "delivered" && !d.link ? window.prompt("Link to the delivered output (optional)") : undefined;
      await updateDeliverableStatus(d.id, next, link ?? null); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }

  const staffLabel = (id: string | null) => (id ? staff.find((s) => s.id === id)?.full_name ?? id : "Unassigned");
  const tasksDone = tasks.filter((t) => t.status === "done").length;
  const deliverablesApproved = deliverables.filter((d) => d.status === "approved").length;

  if (loading) return <p className="text-2xs text-paper-3">Loading project…</p>;
  return <div className="space-y-3 rounded border border-teal/30 bg-ink-200 p-3">
    {notice && <p className="text-2xs text-neg">{notice.text}</p>}
    <p className="text-2xs text-paper-3 font-mono">{tasksDone}/{tasks.length} tasks done · {deliverablesApproved}/{deliverables.length} deliverables approved</p>

    <div>
      <h4 className="mb-1 text-xs font-medium text-paper">Tasks</h4>
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <input className={field} placeholder="Task title" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} />
        <select className={field} value={taskForm.assigneeId} onChange={(e) => setTaskForm({ ...taskForm, assigneeId: e.target.value })}><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.email ?? s.id}</option>)}</select>
        <Button size="sm" variant="secondary" disabled={busy === "task" || !taskForm.title.trim()} onClick={() => void addTask()}>Add task</Button>
      </div>
      {tasks.length === 0 ? <p className="text-2xs text-paper-3">No tasks yet.</p> : <div className="space-y-1">
        {tasks.map((t) => <div key={t.id} className="rounded border border-line bg-ink p-2 text-2xs">
          <div className="flex flex-wrap items-center gap-2"><span className="text-paper">{t.title}</span><span className="text-paper-3">{staffLabel(t.assignee_id)} · {t.status}</span></div>
          {t.status !== "done" && <div className="mt-1 flex flex-wrap gap-1">
            {t.status !== "in_progress" && <Button size="sm" variant="ghost" disabled={busy === t.id} onClick={() => void moveTask(t, "in_progress")}>Start</Button>}
            <Button size="sm" variant="primary" disabled={busy === t.id} onClick={() => void moveTask(t, "done")}>Done</Button>
          </div>}
        </div>)}
      </div>}
    </div>

    <div>
      <h4 className="mb-1 text-xs font-medium text-paper">Deliverables</h4>
      <div className="flex flex-wrap items-end gap-2 mb-2">
        <input className={field} placeholder="Deliverable name" value={deliverableForm.name} onChange={(e) => setDeliverableForm({ ...deliverableForm, name: e.target.value })} />
        <select className={field} value={deliverableForm.ownerId} onChange={(e) => setDeliverableForm({ ...deliverableForm, ownerId: e.target.value })}><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.email ?? s.id}</option>)}</select>
        <Button size="sm" variant="secondary" disabled={busy === "deliverable" || !deliverableForm.name.trim()} onClick={() => void addDeliverable()}>Add deliverable</Button>
      </div>
      {deliverables.length === 0 ? <p className="text-2xs text-paper-3">No deliverables yet.</p> : <div className="space-y-1">
        {deliverables.map((d) => <div key={d.id} className="rounded border border-line bg-ink p-2 text-2xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-paper">{d.name}</span>
            <span className="text-paper-3">{staffLabel(d.owner_id)}</span>
            <span className={`font-mono uppercase ${DELIVERABLE_STATUS_COLOR[d.status]}`}>{d.status}</span>
            {d.link && <a href={d.link} target="_blank" rel="noreferrer" className="text-teal hover:underline">link</a>}
          </div>
          {DELIVERABLE_NEXT_STATUS[d.status] && (
            <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => void advanceDeliverable(d)}>Move to {DELIVERABLE_NEXT_STATUS[d.status]}</Button>
          )}
        </div>)}
      </div>}
    </div>
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
    <CsvImportSection clients={clients} onImported={() => void load()} />
    <FinancePeriodsSection clients={clients} />
  </div>;
}

function CsvImportSection({ clients, onImported }: { clients: Client[]; onImported: () => void }) {
  const [clientId, setClientId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);

  async function doImport() {
    if (!clientId || !csvText.trim()) return;
    const { rows, errors } = parseCostEntriesCsv(csvText);
    setParseErrors(errors);
    if (errors.length > 0 || rows.length === 0) return;
    setBusy(true); setNotice(null);
    try {
      const count = await importCostEntries(clientId, rows);
      setNotice({ kind: "success", text: `${count} cost entries imported.` });
      setCsvText("");
      onImported();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  return <div className="rounded border border-line bg-ink-200 p-3">
    <h4 className="mb-1 text-xs font-medium text-paper">Bulk import cost entries (CSV)</h4>
    <p className="mb-2 text-2xs text-paper-3">One row per line: cost_category,amount,occurred_at[,notes]. An optional header row is skipped. The whole batch is all-or-nothing — one bad row rejects the import, nothing partial is written.</p>
    {notice && <p className={`mb-2 text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    {parseErrors.length > 0 && <div className="mb-2 space-y-0.5">{parseErrors.map((e, i) => <p key={i} className="text-2xs text-neg">{e}</p>)}</div>}
    <div className="flex flex-wrap items-start gap-2">
      <select className={field} value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <textarea
        className={`${field} min-h-[80px] w-full max-w-md font-mono`}
        placeholder={"model_spend,42.50,2026-07-15,Anthropic usage\nstorage,3.20,2026-07-16"}
        value={csvText}
        onChange={(e) => { setCsvText(e.target.value); setParseErrors([]); }}
      />
      <Button size="sm" variant="primary" disabled={busy || !clientId || !csvText.trim()} onClick={() => void doImport()}>Import</Button>
    </div>
  </div>;
}

const FINANCE_STATUS_COLOR: Record<FinancePeriodStatus, string> = { open: "text-paper-3", reconciled: "text-pos" };

function FinancePeriodsSection({ clients }: { clients: Client[] }) {
  const [periods, setPeriods] = useState<ClientFinancePeriodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [form, setForm] = useState({ clientId: "", periodStart: "", periodEnd: "" });
  const [revenueDraft, setRevenueDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setPeriods(await fetchFinancePeriods()); } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function open() {
    if (!form.clientId || !form.periodStart || !form.periodEnd) return;
    setBusy("open"); setNotice(null);
    try {
      await openFinancePeriod({ clientId: form.clientId, periodStart: form.periodStart, periodEnd: form.periodEnd });
      setForm({ clientId: form.clientId, periodStart: "", periodEnd: "" }); await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }
  async function reconcile(period: ClientFinancePeriodRow) {
    const revenue = Number(revenueDraft[period.id]);
    if (!Number.isFinite(revenue) || revenue < 0) return;
    setBusy(period.id); setNotice(null);
    try { await reconcileFinancePeriod(period.id, revenue); await load(); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;

  return <div className="space-y-2">
    <h4 className="text-xs font-medium text-paper">Finance periods</h4>
    <p className="text-2xs text-paper-3">A real accounting period with a reconciliation step — distinct from the mutable revenue estimate above. Once reconciled, total_cost/margin are a permanent snapshot, unaffected by cost entries added afterward.</p>
    {notice && <p className={`text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    <div className="flex flex-wrap items-end gap-2 rounded border border-line bg-ink-200 p-3">
      <select className={field} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}><option value="">Client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Start</span><input type="date" className={field} value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">End</span><input type="date" className={field} value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} /></label>
      <Button size="sm" variant="secondary" disabled={busy === "open" || !form.clientId || !form.periodStart || !form.periodEnd} onClick={() => void open()}>Open period</Button>
    </div>
    {loading ? <p className="text-2xs text-paper-3">Loading…</p> : periods.length === 0 ? <p className="text-2xs text-paper-3">No finance periods yet.</p> : <div className="space-y-1">
      {periods.map((p) => <div key={p.id} className="rounded border border-line bg-ink p-2 text-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-paper">{clientName(p.client_id)}</span>
          <span className="text-paper-3 font-mono">{p.period_start} → {p.period_end}</span>
          <span className={`font-mono uppercase ${FINANCE_STATUS_COLOR[p.status]}`}>{p.status}</span>
        </div>
        {p.status === "reconciled" ? (
          <p className="mt-1 text-paper-2 font-mono tabular-nums">Revenue €{p.actual_revenue?.toFixed(2)} · Cost €{p.total_cost?.toFixed(2)} · Margin €{p.margin?.toFixed(2)}</p>
        ) : (
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <input type="number" min="0" step="0.01" className={field} placeholder="Actual revenue (EUR)" value={revenueDraft[p.id] ?? ""} onChange={(e) => setRevenueDraft({ ...revenueDraft, [p.id]: e.target.value })} />
            <Button size="sm" variant="primary" disabled={busy === p.id || !revenueDraft[p.id]} onClick={() => void reconcile(p)}>Reconcile</Button>
          </div>
        )}
      </div>)}
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
    {tab === "intelligence" && <IntelligenceOperationsPanel clients={clients} />}
    {tab === "workflows" && <WorkflowsSection />}
    {tab === "triggers" && <TriggersSection />}
    {tab === "team" && <TeamRolesSection clients={clients} />}
    {tab === "work" && <WorkItemsSection clients={clients} />}
    {tab === "projects" && <ProjectsSection clients={clients} />}
    {tab === "cost" && <CostMarginSection clients={clients} />}
    {tab === "onboarding" && <OnboardingSection clients={clients} onOnboarded={() => void load()} />}
  </div>;
}
