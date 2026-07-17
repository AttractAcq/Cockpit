import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchAnalyticsRecords, fetchLifecycleDateContext, saveAnalyticsRecord } from "@/lib/api";
import { groupLifecycleRecordsByDate, resolveCanonicalPublishDate, resolveLifecycleContentType, type DateDirection, type LifecycleDateContext } from "@/lib/lifecycle-date";
import { useFocusedRecord } from "@/lib/use-focused-record";
import type { AnalyticsRecordRow, AnalyticsStatus } from "@/types/phase";
import { LifecycleDateSection, LifecycleDirectionToggle } from "@/components/shared/LifecycleDateSection";

const STATUS_STYLE: Record<AnalyticsStatus, string> = {
  awaiting_metrics: "border-warn/20 bg-warn/10 text-warn",
  metrics_partial: "border-warn/20 bg-warn/10 text-warn",
  complete: "border-teal/20 bg-teal/10 text-teal",
  failed: "border-neg/20 bg-neg/10 text-neg",
};

const METRIC_FIELDS: Array<{ key: string; label: string }> = [
  { key: "reach", label: "Reach" },
  { key: "impressions", label: "Impressions" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "saves", label: "Saves" },
  { key: "shares", label: "Shares" },
  { key: "profile_visits", label: "Profile visits" },
  { key: "leads", label: "Enquiries / leads" },
];

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function metricsSummary(metrics: Record<string, unknown>): string {
  const parts = METRIC_FIELDS.map(({ key, label }) => (typeof metrics[key] === "number" ? `${label} ${metrics[key]}` : null)).filter(Boolean);
  return parts.length ? parts.join(" · ") : "No metrics entered";
}

function AnalyticsEditModal({ record, onClose, onSaved }: {
  record: AnalyticsRecordRow;
  onClose: () => void;
  onSaved: (next: AnalyticsRecordRow) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(METRIC_FIELDS.map(({ key }) => [key, typeof record.metrics[key] === "number" ? String(record.metrics[key]) : ""])));
  const [notes, setNotes] = useState(record.notes ?? "");
  const [status, setStatus] = useState<AnalyticsStatus>(record.analytics_status);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);

  async function save() {
    // Metrics are only what the operator typed — nothing is inferred or invented.
    const metrics: Record<string, unknown> = { ...record.metrics };
    for (const { key } of METRIC_FIELDS) {
      const raw = values[key].trim();
      if (raw === "") { delete metrics[key]; continue; }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) { setNotice({ error: true, message: `${key} must be a number.` }); return; }
      metrics[key] = parsed;
    }
    if (status === "complete" && !window.confirm("Mark analytics complete? This advances the ref to the analysis/iteration stage. No iteration output is generated.")) return;
    setBusy(true); setNotice(null);
    try {
      const next = await saveAnalyticsRecord(record, { metrics, notes: notes.trim() || null, analyticsStatus: status });
      onSaved(next);
      window.dispatchEvent(new Event("aa:reload"));
      onClose();
    } catch (error) { setNotice({ error: true, message: errorText(error) }); }
    finally { setBusy(false); }
  }

  const field = "rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper outline-none focus:border-teal/50";
  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 sm:items-center" onClick={onClose}>
    <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="shrink-0 border-b border-line px-5 py-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-2xs text-teal">{record.source_ref}</span><span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${STATUS_STYLE[record.analytics_status]}`}>{record.analytics_status.replaceAll("_", " ")}</span></div><h2 className="mt-1 text-base font-medium text-paper">{record.title ?? "Analytics"}</h2><div className="mt-1 text-2xs text-paper-3">Published {new Date(record.published_at).toLocaleString()}{record.published_url ? " · " : ""}{record.published_url && <a href={record.published_url} target="_blank" rel="noreferrer" className="text-teal hover:underline">post ↗</a>}</div></div><button onClick={onClose} className="text-paper-3 hover:text-paper">✕</button></div></header>
      {notice && <div role={notice.error ? "alert" : "status"} className={`shrink-0 border-b px-5 py-2 text-xs ${notice.error ? "border-neg/20 bg-neg/5 text-neg" : "border-teal/20 bg-teal/5 text-teal"}`}>{notice.message}</div>}
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="text-2xs uppercase text-paper-3">Metrics — manual entry only (blank = not recorded)</div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">{METRIC_FIELDS.map(({ key, label }) => <label key={key} className="flex flex-col gap-1"><span className="text-2xs text-paper-3">{label}</span><input inputMode="numeric" className={field} value={values[key]} onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
        <label className="mt-4 flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Notes</span><textarea className={`${field} min-h-20`} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <label className="mt-4 flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Analytics status</span><select className={field} value={status} onChange={(event) => setStatus(event.target.value as AnalyticsStatus)}><option value="awaiting_metrics">awaiting metrics</option><option value="metrics_partial">metrics partial</option><option value="complete">complete</option><option value="failed">failed</option></select></label>
        <p className="mt-2 text-2xs text-paper-3">Editing metrics never changes publish status. Only setting status to complete advances the ref to analysis / iteration.</p>
      </main>
      <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3"><span className="text-2xs text-paper-3">Real, operator-entered metrics only.</span><Button size="sm" variant="primary" className="ml-auto" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save Analytics"}</Button></footer>
    </div>
  </div>;
}

/**
 * H4 Analytics: only genuinely published assets appear (an analytics row exists
 * only after a real publish success). Metrics are operator-entered; nothing is
 * invented, and no publish state is changed here.
 */
export function AnalyticsPanel({ clientId, executionMonth }: { clientId: string; executionMonth: string }) {
  const [records, setRecords] = useState<AnalyticsRecordRow[]>([]);
  const [open, setOpen] = useState<AnalyticsRecordRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateDirection, setDateDirection] = useState<DateDirection>("desc");
  const [lifecycleContext, setLifecycleContext] = useState<LifecycleDateContext>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [nextRecords, dateContext] = await Promise.all([fetchAnalyticsRecords(clientId, executionMonth), fetchLifecycleDateContext(clientId, executionMonth)]); setRecords(nextRecords); setLifecycleContext(dateContext); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => { void load(); }; window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);

  const completeCount = useMemo(() => records.filter((record) => record.analytics_status === "complete").length, [records]);
  const groupedByDate = useMemo(() => groupLifecycleRecordsByDate(records, { lifecycleStage: "analytics", context: lifecycleContext, direction: dateDirection }), [dateDirection, lifecycleContext, records]);
  useFocusedRecord({
    queryKeys: ["analytics_id", "distribution_id", "source_ref"],
    records,
    getMatchValue: useCallback((record: AnalyticsRecordRow, queryKey: string) => {
      if (queryKey === "analytics_id") return record.id;
      if (queryKey === "distribution_id") return record.distribution_record_id;
      return record.source_ref;
    }, []),
    onFound: useCallback((record: AnalyticsRecordRow) => setOpen(record), []),
  });
  function accept(next: AnalyticsRecordRow) { setRecords((current) => current.map((record) => record.id === next.id ? next : record)); setOpen((current) => current && current.id === next.id ? next : current); }

  if (loading && !records.length) return <div className="p-6 text-xs text-paper-3">Loading analytics…</div>;
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="text-paper">{records.length} published asset{records.length === 1 ? "" : "s"}</span>
        <span className="text-teal">{completeCount} complete</span>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={loading} onClick={() => void load()}>{loading ? "Reloading…" : "Reload"}</Button>
      </div>
      <p className="mt-2 text-2xs text-paper-3">Only assets with a successful publish appear here. Metrics are entered manually — nothing is auto-collected or invented in this build.</p>
      <div className="mt-3"><LifecycleDirectionToggle value={dateDirection} onChange={setDateDirection} /></div>
    </div>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {!records.length ? (
      <div className="rounded-[10px] border border-dashed border-line p-10 text-center">
        <div className="text-sm text-paper">No published assets yet. Assets appear here only after successful publishing.</div>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {groupedByDate.map((section) => <LifecycleDateSection key={section.key} group={section} statusSummary={`${section.records.filter((record) => record.analytics_status === "complete").length} complete`}>
        <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">
        {section.records.map((record) => {
          const lifecycleDate = resolveCanonicalPublishDate(record, "analytics", lifecycleContext).date;
          const contentType = resolveLifecycleContentType(record);
          return (
          <article key={record.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <span className="w-28 shrink-0 font-mono text-2xs text-teal">{record.source_ref}</span>
            <div className="min-w-[240px] flex-1">
              <div className="break-words text-xs text-paper">{record.title ?? record.source_ref}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-paper-3">
                <span>{contentType.label}</span>
                <span>{record.platform ?? "instagram"}</span>
                <span>content date {lifecycleDate ?? "date unavailable"}</span>
                <span>published {new Date(record.published_at).toLocaleString()}</span>
                <span>measured {new Date(record.updated_at).toLocaleString()}</span>
                {record.published_url && <a href={record.published_url} target="_blank" rel="noreferrer" className="text-teal hover:underline">post ↗</a>}
              </div>
              <div className="mt-1 text-2xs text-paper-3">{metricsSummary(record.metrics)}</div>
              {record.notes && <div className="mt-1 text-2xs text-paper-2">{record.notes}</div>}
            </div>
            <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${STATUS_STYLE[record.analytics_status]}`}>{record.analytics_status.replaceAll("_", " ")}</span>
            <Button size="sm" variant="ghost" onClick={() => setOpen(record)}>View / Edit</Button>
          </article>
          );
        })}
        </div>
        </LifecycleDateSection>)}
      </div>
    )}
    {open && <AnalyticsEditModal record={open} onClose={() => setOpen(null)} onSaved={accept} />}
  </div>;
}
