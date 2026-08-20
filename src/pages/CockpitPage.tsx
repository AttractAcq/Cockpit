import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, Panel } from "@/components/primitives";
import { Button } from "@/components/primitives";
import { fetchClients, fetchActivityLog, fetchStage3StatusMap } from "@/lib/api";
import type { Client, ActivityLogEntry } from "@/types/client";
import { ROUTES } from "@/lib/constants";
import { TIER_LABELS as TL } from "@/types/client";
import { fmtRelative } from "@/lib/format";
import { currentExecutionMonth, type Stage3Status } from "@/lib/stage3";
import { ContractorManagerModal } from "@/components/ContractorManagerModal";
import { resolveOperationDestination } from "@/lib/operation-destination";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  computePublishSuccessRate, summariseExceptions, summariseQueueAge, summariseApprovalDelays,
  type PublishAttemptLike, type ExceptionLike, type WorkItemLike,
} from "@/lib/observability";
import { fetchCommandCenterNotes, addCommandCenterNote, resolveCommandCenterNote } from "@/lib/command-center";
import type { CommandCenterNoteRow, CommandCenterNoteCategory } from "@/types/operations";

function StageBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    not_run:  "text-paper-3",
    not_started: "text-paper-3",
    running:  "text-warn",
    in_progress: "text-warn",
    partial: "text-warn",
    needs_review: "text-warn",
    complete: "text-teal",
    error: "text-neg",
    failed: "text-neg",
  };
  const labels: Record<string, string> = {
    not_run: "—",
    not_started: "Not started",
    running:  "Running",
    in_progress: "In progress",
    partial: "Partial",
    needs_review: "Needs review",
    complete: "Done",
    error: "Error",
    failed: "Failed",
  };
  return (
    <span className={`text-2xs font-mono uppercase ${styles[status] ?? "text-paper-3"}`}>
      {labels[status] ?? status}
    </span>
  );
}

const NOTE_CATEGORY_LABEL: Record<CommandCenterNoteCategory, string> = { bottleneck: "Bottleneck", priority: "Priority" };

export function CockpitPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stage3Statuses, setStage3Statuses] = useState<Record<string, Stage3Status>>({});
  const [contractorsOpen, setContractorsOpen] = useState(false);
  const [publishAttempts, setPublishAttempts] = useState<PublishAttemptLike[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionLike[]>([]);
  const [workItems, setWorkItems] = useState<WorkItemLike[]>([]);
  const [notes, setNotes] = useState<CommandCenterNoteRow[]>([]);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteForm, setNoteForm] = useState<{ category: CommandCenterNoteCategory; body: string }>({ category: "bottleneck", body: "" });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    // Clients is essential; everything else is an enhancement. allSettled
    // keeps the dashboard rendering if a secondary query drops under load.
    const [clientsResult, activityResult, stage3Result, publishResult, exceptionResult, workItemResult, notesResult] = await Promise.allSettled([
      fetchClients(), fetchActivityLog({ limit: 8 }), fetchStage3StatusMap(currentExecutionMonth()),
      supabase.from("client_publish_attempts").select("result, completed_at, started_at").order("started_at", { ascending: false }).limit(500),
      supabase.from("client_exception_queue").select("status, severity, created_at").limit(500),
      supabase.from("client_work_items").select("status, due_at, priority").limit(500),
      fetchCommandCenterNotes(),
    ]);
    if (clientsResult.status === "fulfilled") setClients(clientsResult.value);
    else setError(clientsResult.reason instanceof Error ? clientsResult.reason.message : String(clientsResult.reason));
    setActivity(activityResult.status === "fulfilled" ? activityResult.value : []);
    setStage3Statuses(stage3Result.status === "fulfilled" ? stage3Result.value : {});
    setPublishAttempts(publishResult.status === "fulfilled" ? ((publishResult.value.data ?? []) as PublishAttemptLike[]) : []);
    setExceptions(exceptionResult.status === "fulfilled" ? ((exceptionResult.value.data ?? []) as ExceptionLike[]) : []);
    setWorkItems(workItemResult.status === "fulfilled" ? ((workItemResult.value.data ?? []) as WorkItemLike[]) : []);
    setNotes(notesResult.status === "fulfilled" ? notesResult.value : []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => void load(); window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);

  async function submitNote() {
    if (!noteForm.body.trim()) return;
    setNoteBusy(true); setNoteError(null);
    try {
      await addCommandCenterNote(noteForm.category, noteForm.body);
      setNoteForm({ category: noteForm.category, body: "" });
      await load();
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setNoteBusy(false);
    }
  }

  async function resolveNote(noteId: string) {
    setNoteBusy(true); setNoteError(null);
    try { await resolveCommandCenterNote(noteId); await load(); }
    catch (e) { setNoteError(e instanceof Error ? e.message : String(e)); }
    finally { setNoteBusy(false); }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-neg text-xs">
        {error}
      </div>
    );
  }

  const activeClients  = clients.filter((c) => c.status === "active");
  const stage1Missing  = clients.filter((c) => c.stage1_status === "not_run").length;
  const stage2Missing  = clients.filter((c) => c.stage2_status === "not_run").length;
  const stage3Missing  = clients.filter((c) => (stage3Statuses[c.id] ?? "not_started") === "not_started").length;

  // Operational health — the same pure aggregation functions Operations >
  // Operational Control > Metrics uses, computed live from the same real
  // tables. Never a separately-maintained counter.
  const publishRate = computePublishSuccessRate(publishAttempts);
  const exceptionSummary = summariseExceptions(exceptions);
  const exceptionAge = summariseQueueAge(exceptions, ["resolved"]);
  const approvalDelays = summariseApprovalDelays(workItems);
  const openNotes = notes.filter((n) => !n.resolved_at);
  const resolvedNotes = notes.filter((n) => n.resolved_at);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
      <div className="shrink-0 flex justify-end"><Button variant="ghost" size="sm" onClick={() => setContractorsOpen(true)}>Manage Contractors</Button></div>
      {/* System Readiness Band */}
      <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          { label: "Total Clients",    value: clients.length,                              sub: `${activeClients.length} active` },
          { label: "Stage 1 Not Run",  value: stage1Missing,                               sub: "need context input" },
          { label: "Stage 2 Not Run",  value: stage2Missing,                               sub: "need monthly pack" },
          { label: "Stage 3 Not Run",  value: stage3Missing,                               sub: "no masters/calendar" },
          { label: "Internal Clients", value: clients.filter((c) => c.is_internal_client).length, sub: "AA-managed" },
        ].map((tile) => (
          <div
            key={tile.label}
            className="bg-ink-200 border border-line rounded-[10px] p-3.5 flex flex-col gap-1"
          >
            <span className="text-2xs uppercase tracking-cap text-paper-3">{tile.label}</span>
            <span className="text-2xl font-mono text-paper">{tile.value}</span>
            <span className="text-2xs text-paper-3">{tile.sub}</span>
          </div>
        ))}
      </div>

      {/* Operational Health — same live-computed metrics as Operations > Operational Control > Metrics */}
      <div className="grid shrink-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Publish Success", value: publishRate.successRate != null ? `${publishRate.successRate}%` : "—", sub: `${publishRate.terminalAttempts} decided` },
          { label: "Open Exceptions", value: exceptionSummary.openCount, sub: `${exceptionSummary.highSeverityOpenCount} high severity` },
          { label: "Oldest Exception", value: exceptionAge.oldestAgeHours != null ? `${exceptionAge.oldestAgeHours}h` : "—", sub: `avg ${exceptionAge.averageAgeHours ?? "—"}h` },
          { label: "Overdue Work Items", value: approvalDelays.overdueCount, sub: `${approvalDelays.dueSoonCount} due within 24h` },
        ].map((tile) => (
          <div
            key={tile.label}
            className="bg-ink-200 border border-line rounded-[10px] p-3.5 flex flex-col gap-1"
          >
            <span className="text-2xs uppercase tracking-cap text-paper-3">{tile.label}</span>
            <span className="text-2xl font-mono text-paper">{tile.value}</span>
            <span className="text-2xs text-paper-3">{tile.sub}</span>
          </div>
        ))}
      </div>

      {/* Clients + Activity */}
      <div className="grid min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Client list */}
        <Panel title="Clients" meta={`${clients.length} total`}>
          {clients.length === 0 ? (
            <EmptyState
              icon="users"
              title="No clients yet"
              body="Create your first client to get started."
              action={
                <Button variant="primary" size="sm" onClick={() => navigate(ROUTES.clients)}>
                  Go to Clients
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-xs">
              <thead>
                <tr className="border-b border-line">
                  {["Name", "Tier", "Stage 1", "Stage 2", "Phase 3"].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-2xs uppercase tracking-cap text-paper-3 font-medium"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(ROUTES.client(c.id))}
                    className="border-b border-line last:border-b-0 hover:bg-ink-100 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5 text-paper font-medium">
                      {c.name}
                      {c.is_internal_client && (
                        <span className="ml-2 text-2xs text-teal font-mono bg-teal/10 rounded px-1">
                          internal
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-paper-2 text-2xs">{TL[c.package_tier]}</td>
                    <td className="px-3 py-2.5"><StageBadge status={c.stage1_status} /></td>
                    <td className="px-3 py-2.5"><StageBadge status={c.stage2_status} /></td>
                    <td className="px-3 py-2.5"><button className="rounded px-1 py-0.5 hover:bg-teal/10 focus:outline-none focus:ring-1 focus:ring-teal/50" onClick={(event) => { event.stopPropagation(); navigate(ROUTES.clientSection(c.id, "calendar")); }} title="Open Phase 3 calendar"><StageBadge status={stage3Statuses[c.id] ?? "not_started"} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Panel>

        {/* Recent activity */}
        <Panel title="Recent Activity" meta="last 8">
          {activity.length === 0 ? (
            <EmptyState
              icon="clock"
              title="No activity yet"
              body="System events will appear here."
            />
          ) : (
            <ul>
              {activity.map((entry) => {
                const destination = resolveOperationDestination(entry);
                const content = <>
                  <span className="text-xs text-paper leading-snug">
                    {entry.plain_english_message}
                  </span>
                  <span className="text-2xs text-paper-3 font-mono">
                    {fmtRelative(entry.created_at)}
                    {entry.clients?.name ? ` · ${entry.clients.name}` : ""}
                    {destination ? ` · ${destination.label}` : ""}
                  </span>
                </>;
                return (
                  <li key={entry.id} className="border-b border-line last:border-b-0">
                    {destination ? (
                      <Link
                        to={{ pathname: destination.pathname, search: destination.search }}
                        className="flex flex-col gap-0.5 px-3 py-2.5 transition-colors hover:bg-ink-100 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-teal/50"
                      >
                        {content}
                      </Link>
                    ) : (
                      <div className="flex flex-col gap-0.5 px-3 py-2.5">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* Bottlenecks & Priorities — manually-authored, deliberately not AI-inferred (Stage 2 Phase 01) */}
      <Panel title="Bottlenecks & Priorities" meta={`${openNotes.length} open`}>
        <div className="flex flex-col gap-3 p-3">
          {noteError && <p className="text-2xs text-neg">{noteError}</p>}
          {role === "admin" && (
            <div className="flex flex-wrap items-end gap-2 rounded border border-line bg-ink-200 p-3">
              <label className="flex flex-col gap-1">
                <span className="text-2xs text-paper-3">Category</span>
                <select
                  className="rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50"
                  value={noteForm.category}
                  onChange={(e) => setNoteForm({ ...noteForm, category: e.target.value as CommandCenterNoteCategory })}
                >
                  <option value="bottleneck">Bottleneck</option>
                  <option value="priority">Priority</option>
                </select>
              </label>
              <label className="flex flex-1 min-w-[240px] flex-col gap-1">
                <span className="text-2xs text-paper-3">Note</span>
                <input
                  className="rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50"
                  placeholder="e.g. demand isn't the constraint, conversion is"
                  value={noteForm.body}
                  onChange={(e) => setNoteForm({ ...noteForm, body: e.target.value })}
                />
              </label>
              <Button size="sm" variant="primary" disabled={noteBusy || !noteForm.body.trim()} onClick={() => void submitNote()}>Add</Button>
            </div>
          )}
          {openNotes.length === 0 ? (
            <EmptyState icon="clock" title="No open bottlenecks or priorities" body="Leadership notes will appear here." />
          ) : (
            <div className="space-y-1">
              {openNotes.map((note) => (
                <div key={note.id} className="flex items-start justify-between gap-3 rounded border border-line bg-ink p-2 text-2xs">
                  <div className="flex flex-col gap-0.5">
                    <span className={`font-mono uppercase ${note.category === "bottleneck" ? "text-warn" : "text-teal"}`}>{NOTE_CATEGORY_LABEL[note.category]}</span>
                    <span className="text-paper">{note.body}</span>
                    <span className="text-paper-3">{fmtRelative(note.created_at)}</span>
                  </div>
                  {role === "admin" && (
                    <Button size="sm" variant="ghost" disabled={noteBusy} onClick={() => void resolveNote(note.id)}>Resolve</Button>
                  )}
                </div>
              ))}
            </div>
          )}
          {resolvedNotes.length > 0 && (
            <details className="text-2xs text-paper-3">
              <summary className="cursor-pointer">{resolvedNotes.length} resolved</summary>
              <div className="mt-2 space-y-1">
                {resolvedNotes.map((note) => (
                  <div key={note.id} className="rounded border border-line bg-ink p-2 opacity-60">
                    <span className="font-mono uppercase">{NOTE_CATEGORY_LABEL[note.category]}</span>{" "}
                    <span>{note.body}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </Panel>
      {contractorsOpen && <ContractorManagerModal onClose={() => setContractorsOpen(false)} />}
    </div>
    </div>
  );
}
