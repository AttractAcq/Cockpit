// Programme Stage N — Automation and Fulfilment Orchestration. Per-area
// automation policy (manual/assisted/automatic), capacity/cost controls,
// and the exception queue. No policy row for an area means "automatic" —
// exactly today's unrestricted behaviour for a client who never configures
// one. Only `publishing`'s automation level (and the capacity policy's
// retry_cap) are actually consulted by a real, live worker today
// (process-scheduled-publishing) — see docs/programme/status/Stage_N_Status.md.

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import {
  fetchAutomationPolicies, setAutomationPolicy, fetchCapacityPolicy, setCapacityPolicy,
  fetchExceptionQueue, resolveException,
} from "@/lib/automation";
import {
  AUTOMATION_AREAS, AUTOMATION_AREA_LABEL, EXCEPTION_TYPE_LABEL,
  type ClientAutomationPolicyRow, type ClientCapacityPolicyRow, type ClientExceptionQueueRow,
  type AutomationLevel, type ClientPriority, type ExceptionStatus,
} from "@/types/automation";

type Notice = { kind: "success" | "error"; text: string } | null;
function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: string }).message);
  return error instanceof Error ? error.message : String(error);
}

const LEVEL_COLOR: Record<AutomationLevel, string> = { manual: "text-paper-3", assisted: "text-warn", automatic: "text-teal" };
const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

function AutomationPolicySection({ clientId }: { clientId: string }) {
  const [policies, setPolicies] = useState<ClientAutomationPolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setPolicies(await fetchAutomationPolicies(clientId)); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  function levelFor(area: string): AutomationLevel {
    return policies.find((p) => p.area === area)?.automation_level ?? "automatic";
  }

  async function updateLevel(area: (typeof AUTOMATION_AREAS)[number], level: AutomationLevel) {
    setBusy(area); setNotice(null);
    try {
      await setAutomationPolicy({ clientId, area, automationLevel: level });
      await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }

  return <div className="rounded-[10px] border border-line bg-ink-200 p-4">
    <h3 className="mb-1 text-xs font-medium text-paper">Automation Policy</h3>
    <p className="mb-3 text-2xs text-paper-3">Manual: an operator starts each stage. Assisted: Cockpit proposes and prepares; the operator approves. Automatic: Cockpit executes within policy. No policy set for an area means Automatic — today's default behaviour. Only Publishing is actually consulted by a live worker today.</p>
    {notice && <p className={`mb-2 text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    {loading ? <p className="text-2xs text-paper-3">Loading…</p> : <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {AUTOMATION_AREAS.map((area) => <div key={area} className="flex items-center justify-between gap-2 rounded border border-line bg-ink px-3 py-2">
        <span className="text-2xs text-paper">{AUTOMATION_AREA_LABEL[area]}</span>
        <select className={`${field} ${LEVEL_COLOR[levelFor(area)]}`} disabled={busy === area} value={levelFor(area)} onChange={(e) => void updateLevel(area, e.target.value as AutomationLevel)}>
          <option value="manual">Manual</option>
          <option value="assisted">Assisted</option>
          <option value="automatic">Automatic</option>
        </select>
      </div>)}
    </div>}
  </div>;
}

function CapacityPolicySection({ clientId }: { clientId: string }) {
  const [policy, setPolicy] = useState<ClientCapacityPolicyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [form, setForm] = useState({
    monthlyGenerationBudgetUnits: "", perAssetBudgetUnits: "", providerCreditBudgetUnits: "",
    maxSimultaneousJobs: "", humanReviewCapacityPerDay: "", clientPriority: "normal" as ClientPriority,
    dueDatePriorityEnabled: true, retryCap: "5",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await fetchCapacityPolicy(clientId);
      setPolicy(row);
      if (row) {
        setForm({
          monthlyGenerationBudgetUnits: row.monthly_generation_budget_units?.toString() ?? "",
          perAssetBudgetUnits: row.per_asset_budget_units?.toString() ?? "",
          providerCreditBudgetUnits: row.provider_credit_budget_units?.toString() ?? "",
          maxSimultaneousJobs: row.max_simultaneous_jobs?.toString() ?? "",
          humanReviewCapacityPerDay: row.human_review_capacity_per_day?.toString() ?? "",
          clientPriority: row.client_priority, dueDatePriorityEnabled: row.due_date_priority_enabled,
          retryCap: row.retry_cap.toString(),
        });
      }
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    setBusy(true); setNotice(null);
    try {
      await setCapacityPolicy({
        clientId,
        monthlyGenerationBudgetUnits: form.monthlyGenerationBudgetUnits ? Number(form.monthlyGenerationBudgetUnits) : null,
        perAssetBudgetUnits: form.perAssetBudgetUnits ? Number(form.perAssetBudgetUnits) : null,
        providerCreditBudgetUnits: form.providerCreditBudgetUnits ? Number(form.providerCreditBudgetUnits) : null,
        maxSimultaneousJobs: form.maxSimultaneousJobs ? Number(form.maxSimultaneousJobs) : null,
        humanReviewCapacityPerDay: form.humanReviewCapacityPerDay ? Number(form.humanReviewCapacityPerDay) : null,
        clientPriority: form.clientPriority, dueDatePriorityEnabled: form.dueDatePriorityEnabled,
        retryCap: Number(form.retryCap) || 5,
      });
      setNotice({ kind: "success", text: "Capacity policy saved." });
      await load();
    } catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="text-2xs text-paper-3">Loading capacity policy…</div>;
  return <div className="rounded-[10px] border border-line bg-ink-200 p-4">
    <h3 className="mb-1 text-xs font-medium text-paper">Capacity &amp; Cost Controls</h3>
    <p className="mb-3 text-2xs text-paper-3">{!policy && "No policy set — every value below is currently unrestricted except the retry cap, which defaults to 5 (matching the scheduled-publishing worker's built-in limit)."} Retry cap is the only value enforced by a live worker today (Publishing).</p>
    {notice && <p className={`mb-2 text-2xs ${notice.kind === "error" ? "text-neg" : "text-teal"}`}>{notice.text}</p>}
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Monthly generation budget (units)</span><input type="number" min="0" className={field} value={form.monthlyGenerationBudgetUnits} onChange={(e) => setForm({ ...form, monthlyGenerationBudgetUnits: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Per-asset budget (units)</span><input type="number" min="0" className={field} value={form.perAssetBudgetUnits} onChange={(e) => setForm({ ...form, perAssetBudgetUnits: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Provider credit budget (units)</span><input type="number" min="0" className={field} value={form.providerCreditBudgetUnits} onChange={(e) => setForm({ ...form, providerCreditBudgetUnits: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Max simultaneous jobs</span><input type="number" min="1" className={field} value={form.maxSimultaneousJobs} onChange={(e) => setForm({ ...form, maxSimultaneousJobs: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Human review capacity / day</span><input type="number" min="0" className={field} value={form.humanReviewCapacityPerDay} onChange={(e) => setForm({ ...form, humanReviewCapacityPerDay: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Retry cap (enforced by Publishing)</span><input type="number" min="1" max="20" className={field} value={form.retryCap} onChange={(e) => setForm({ ...form, retryCap: e.target.value })} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Client priority</span><select className={field} value={form.clientPriority} onChange={(e) => setForm({ ...form, clientPriority: e.target.value as ClientPriority })}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label>
    </div>
    <label className="mt-3 flex items-center gap-2 text-2xs text-paper-2"><input type="checkbox" checked={form.dueDatePriorityEnabled} onChange={(e) => setForm({ ...form, dueDatePriorityEnabled: e.target.checked })} />Due-date priority enabled</label>
    <Button size="sm" variant="primary" className="mt-3" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save capacity policy"}</Button>
  </div>;
}

function ExceptionQueueSection({ clientId }: { clientId: string }) {
  const [exceptions, setExceptions] = useState<ClientExceptionQueueRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<ExceptionStatus | "all">("open");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setExceptions(await fetchExceptionQueue(clientId, statusFilter === "all" ? undefined : statusFilter)); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setLoading(false); }
  }, [clientId, statusFilter]);
  useEffect(() => { void load(); }, [load]);

  async function resolve(exception: ClientExceptionQueueRow, status: "acknowledged" | "resolved") {
    setBusy(exception.id); setNotice(null);
    try { await resolveException(exception.id, status, notes[exception.id] ?? null); await load(); }
    catch (e) { setNotice({ kind: "error", text: errorMessage(e) }); }
    finally { setBusy(null); }
  }

  return <div className="rounded-[10px] border border-line bg-ink-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-xs font-medium text-paper">Exception Queue</h3>
      <select className={field} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ExceptionStatus | "all")}>
        <option value="open">Open</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="all">All</option>
      </select>
    </div>
    <p className="mt-1 mb-3 text-2xs text-paper-3">One place for failed jobs, missing approvals/proof, provider errors, and other cross-system problems. Real, live data flows in from the scheduled-publishing worker's permanent failures today.</p>
    {notice && <p className="mb-2 text-2xs text-neg">{notice.text}</p>}
    {loading ? <p className="text-2xs text-paper-3">Loading…</p> : exceptions.length === 0 ? <p className="text-2xs text-paper-3">No exceptions.</p> : <div className="space-y-2">
      {exceptions.map((ex) => <div key={ex.id} className="rounded border border-line bg-ink p-3 text-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 ${ex.severity === "high" ? "bg-neg/10 text-neg" : ex.severity === "medium" ? "bg-warn/10 text-warn" : "bg-line text-paper-3"}`}>{ex.severity}</span>
          <span className="text-paper">{ex.title}</span>
          <span className="text-paper-3">{EXCEPTION_TYPE_LABEL[ex.exception_type]} · {ex.source_system} · {ex.status}</span>
        </div>
        <p className="mt-1 text-paper-3">{ex.summary}</p>
        {ex.resolution_notes && <p className="mt-1 text-paper-2">Resolution: {ex.resolution_notes}</p>}
        {ex.status !== "resolved" && <>
          <input className={`${field} mt-2 w-full`} placeholder="Resolution notes" value={notes[ex.id] ?? ""} onChange={(e) => setNotes((cur) => ({ ...cur, [ex.id]: e.target.value }))} />
          <div className="mt-2 flex gap-2">
            {ex.status === "open" && <Button size="sm" variant="ghost" disabled={busy === ex.id} onClick={() => void resolve(ex, "acknowledged")}>Acknowledge</Button>}
            <Button size="sm" variant="primary" disabled={busy === ex.id} onClick={() => void resolve(ex, "resolved")}>Resolve</Button>
          </div>
        </>}
      </div>)}
    </div>}
  </div>;
}

export function AutomationPanel({ clientId }: { clientId: string }) {
  return <div className="flex flex-col gap-4 p-4">
    <AutomationPolicySection clientId={clientId} />
    <CapacityPolicySection clientId={clientId} />
    <ExceptionQueueSection clientId={clientId} />
  </div>;
}
