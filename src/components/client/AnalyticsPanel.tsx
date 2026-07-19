import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { createIterationCandidate, fetchAnalyticsForClient, fetchInsightsCollectionRuns, runDeterministicPerformanceAnalysis, updatePerformanceInsightStatus, upsertBusinessSignalSnapshot, upsertManualMetricSnapshot } from "@/lib/api";
import { metricFieldsForFormat, sanitizeBusinessSignals, sanitizeMetricPayload } from "@/lib/analytics-manual";
import { ITERATION_CANDIDATE_TYPES, iterationEvidenceFromScore } from "@/lib/iteration-intake";
import { useFocusedRecord } from "@/lib/use-focused-record";
import { ROUTES } from "@/lib/constants";
import type { AnalyticsRecordRow, AnalyticsSummary, InsightsCollectionRun, MetricSnapshotLabel } from "@/types/phase";

const LABELS: Record<string, string> = {
  impressions: "Impressions", reach: "Reach", likes: "Likes", comments: "Comments", shares: "Shares", saves: "Saves",
  profile_visits: "Profile visits", follows: "Follows", website_clicks: "Website clicks", replies: "Replies",
  taps_forward: "Taps forward", taps_back: "Taps back", exits: "Exits", completion_rate: "Completion rate (%)",
  views: "Views", navigation: "Navigation", total_interactions: "Total interactions",
  inbound_dms: "Inbound DMs", qualified_dms: "Qualified DMs", conversations: "Conversations",
  qualified_conversations: "Qualified conversations", appointments: "Appointments", qualified_appointments: "Qualified appointments",
  show_ups: "Show-ups", cash_collected: "Cash collected",
};
const SIGNAL_KEYS = ["profile_visits", "follows", "inbound_dms", "qualified_dms", "conversations", "qualified_conversations", "appointments", "qualified_appointments", "show_ups", "cash_collected"] as const;
const STATUS_STYLE: Record<string, string> = {
  no_metrics: "border-warn/20 bg-warn/10 text-warn", partial_metrics: "border-warn/20 bg-warn/10 text-warn",
  metrics_entered: "border-teal/20 bg-teal/10 text-teal", business_signals_entered: "border-teal/20 bg-teal/10 text-teal",
};
const inputClass = "rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper outline-none focus:border-teal/50";

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details].filter(Boolean).join(" · ");
  }
  return String(error);
}
function localInputValue(date = new Date()): string { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function headline(summary: AnalyticsSummary): string {
  const metrics = summary.metric_snapshots[0]?.metrics ?? {};
  const parts = ["reach", "impressions", "likes", "replies", "shares", "saves"].filter((key) => metrics[key as keyof typeof metrics] != null).slice(0, 4).map((key) => `${LABELS[key]} ${metrics[key as keyof typeof metrics]}`);
  return parts.join(" · ") || "Published, awaiting metrics.";
}

function AnalyticsDetail({ summary, onClose, onSaved }: { summary: AnalyticsSummary; onClose: () => void; onSaved: () => void }) {
  const record = summary.record;
  const metricKeys = metricFieldsForFormat(record.asset_format);
  const [metricValues, setMetricValues] = useState<Record<string, string>>({});
  const [signalValues, setSignalValues] = useState<Record<string, string>>({});
  const [snapshotAt, setSnapshotAt] = useState(localInputValue());
  const [signalAt, setSignalAt] = useState(localInputValue());
  const [snapshotLabel, setSnapshotLabel] = useState<MetricSnapshotLabel>("manual");
  const [notes, setNotes] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [operatorNotes, setOperatorNotes] = useState("");
  const [candidateType, setCandidateType] = useState<(typeof ITERATION_CANDIDATE_TYPES)[number]>("content_angle");
  const [candidateRecommendation, setCandidateRecommendation] = useState("");
  const [candidateRationale, setCandidateRationale] = useState("");
  const [candidateConfidence, setCandidateConfidence] = useState<"low"|"medium"|"high">("low");
  const [candidatePriority, setCandidatePriority] = useState<"low"|"medium"|"high">("medium");
  const [candidateInsightId, setCandidateInsightId] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function saveMetrics() {
    if (!record.distribution_record_id) return setNotice("A published distribution record is required.");
    try {
      const metrics = sanitizeMetricPayload(metricValues, metricKeys);
      setBusy(true); setNotice(null);
      await upsertManualMetricSnapshot({ distributionRecordId: record.distribution_record_id, snapshotAt: new Date(snapshotAt).toISOString(), snapshotLabel, metrics, notes: notes.trim() || null, evidenceUrl: evidenceUrl.trim() || null });
      window.dispatchEvent(new Event("aa:reload")); onSaved(); setMetricValues({}); setNotes(""); setEvidenceUrl("");
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  }
  async function saveSignals() {
    if (!record.distribution_record_id) return setNotice("A published distribution record is required.");
    try {
      const values = sanitizeBusinessSignals(signalValues);
      setBusy(true); setNotice(null);
      await upsertBusinessSignalSnapshot({
        distributionRecordId: record.distribution_record_id, signalAt: new Date(signalAt).toISOString(),
        profileVisits: values.profile_visits, follows: values.follows, inboundDms: values.inbound_dms, qualifiedDms: values.qualified_dms,
        conversations: values.conversations, qualifiedConversations: values.qualified_conversations, appointments: values.appointments,
        qualifiedAppointments: values.qualified_appointments, showUps: values.show_ups, cashCollected: values.cash_collected,
        operatorNotes: operatorNotes.trim() || null,
      });
      window.dispatchEvent(new Event("aa:reload")); onSaved(); setSignalValues({}); setOperatorNotes("");
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  }
  async function setInsightStatus(id: string, status: "accepted" | "dismissed") {
    try { setBusy(true); setNotice(null); await updatePerformanceInsightStatus(id, status); onSaved(); }
    catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  }
  async function saveCandidate(insightId?:string) {
    if (!record.distribution_record_id || !summary.performance_score) return setNotice("A persisted performance score is required.");
    if (!candidateRecommendation.trim() || !candidateRationale.trim()) return setNotice("Recommendation and rationale are required.");
    try {
      setBusy(true); setNotice(null);
      await createIterationCandidate({clientId:record.client_id,sourceRef:record.source_ref,distributionRecordId:record.distribution_record_id,performanceScoreId:summary.performance_score.id,performanceInsightId:insightId??null,candidateType,recommendation:candidateRecommendation.trim(),rationale:candidateRationale.trim(),evidence:iterationEvidenceFromScore(summary.performance_score,summary.metric_snapshots[0]?.metrics??{}),confidence:candidateConfidence,priority:candidatePriority,createdFrom:insightId?"performance_insight":"performance_score"});
      setCandidateRecommendation(""); setCandidateRationale(""); setCandidateInsightId(""); onSaved();
    } catch (error) { setNotice(errorText(error)); } finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 sm:items-center" onClick={onClose}>
    <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-start gap-3 border-b border-line px-5 py-4"><div className="min-w-0 flex-1"><div className="font-mono text-2xs text-teal">{record.source_ref}</div><h2 className="mt-1 text-base font-medium text-paper">{record.title ?? "Published item analytics"}</h2><div className="mt-1 text-2xs text-paper-3">{record.asset_format ?? "content"} · {record.platform ?? "instagram"} · published {new Date(record.published_at).toLocaleString()}</div><div className="mt-1 flex gap-3 text-2xs">{record.published_url && <a className="text-teal hover:underline" href={record.published_url} target="_blank" rel="noreferrer">Published evidence ↗</a>}<a className="text-teal hover:underline" href={`${ROUTES.clientSection(record.client_id, "archive")}?source_ref=${encodeURIComponent(record.source_ref)}`}>Lifecycle Archive</a></div></div><button onClick={onClose} className="text-paper-3 hover:text-paper">✕</button></header>
      {notice && <div role="alert" className="border-b border-neg/20 bg-neg/5 px-5 py-2 text-xs text-neg">{notice}</div>}
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <section><h3 className="text-xs font-medium text-paper">Platform metric snapshots</h3>
          {!summary.metric_snapshots.length ? <p className="mt-2 text-xs text-paper-3">Published, awaiting metrics.</p> : <div className="mt-2 space-y-2">{summary.metric_snapshots.map((row) => <div key={row.id} className="rounded border border-line bg-ink p-3 text-2xs"><div className="text-paper">{new Date(row.snapshot_at).toLocaleString()} · {row.snapshot_label.replaceAll("_", " ")} · {row.collection_method === "api" ? "Collected automatically from Instagram." : "Metrics entered manually."}</div><div className="mt-1 text-paper-3">{Object.entries(row.metrics).map(([key, value]) => `${LABELS[key] ?? key}: ${value}`).join(" · ") || "No populated metrics"}</div>{row.notes && <div className="mt-1 text-paper-2">{row.notes}</div>}{row.evidence_url && <a className="mt-1 block text-teal hover:underline" href={row.evidence_url} target="_blank" rel="noreferrer">Metric evidence ↗</a>}</div>)}</div>}
        </section>
        <section className="mt-5"><h3 className="text-xs font-medium text-paper">Automatic collection status</h3><div className="mt-2 rounded border border-line bg-ink p-3 text-2xs text-paper-3"><div>{summary.automatic_status.replaceAll("_", " ")}</div><div className="mt-1">Latest automatic snapshot: {summary.latest_automatic_snapshot_at ? new Date(summary.latest_automatic_snapshot_at).toLocaleString() : "none"}</div>{summary.insights_attempts[0] && <div className="mt-1">Latest attempt: {summary.insights_attempts[0].status}{summary.insights_attempts[0].error_category ? ` · ${summary.insights_attempts[0].error_category}` : ""}{summary.insights_attempts[0].reason ? ` · ${summary.insights_attempts[0].reason}` : ""}</div>}</div></section>
        <section className="mt-5"><h3 className="text-xs font-medium text-paper">Performance Intelligence</h3>{!summary.performance_score ? <div className="mt-2 rounded border border-dashed border-line p-4 text-xs text-paper-3">Published, awaiting enough metrics. Run deterministic analysis when ready.</div> : <div className="mt-2 rounded border border-line bg-ink p-4"><div className="flex flex-wrap gap-2 text-2xs"><span className="rounded border border-teal/20 bg-teal/10 px-2 py-1 text-teal">Overall {summary.performance_score.overall_score}</span><span className="rounded border border-line px-2 py-1 text-paper-3">{summary.performance_score.sample_quality}</span><span className="rounded border border-line px-2 py-1 text-paper-3">{summary.performance_score.score_status.replaceAll("_", " ")}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-2xs text-paper-3 sm:grid-cols-4"><div>Attention {summary.performance_score.attention_score}</div><div>Engagement {summary.performance_score.engagement_score}</div><div>Trust {summary.performance_score.trust_score}</div><div>Conversion {summary.performance_score.conversion_signal_score}</div></div><ul className="mt-3 space-y-1 text-2xs text-paper-3">{summary.performance_score.score_reasons.map((reason) => <li key={reason}>• {reason}</li>)}</ul></div>}{summary.performance_score?.sample_quality === "early" && <p className="mt-2 text-2xs text-warn">Too early to score confidently.</p>}{summary.performance_score?.sample_quality === "insufficient" && <p className="mt-2 text-2xs text-warn">Insufficient data for comparison.</p>}<p className="mt-2 text-2xs text-paper-3">Signal detected, not a conclusion.</p><div className="mt-3 space-y-2">{(summary.performance_insights ?? []).map((insight) => <article key={insight.id} className="rounded border border-line bg-ink p-3 text-2xs"><div className="flex flex-wrap gap-2"><span className="text-paper">{insight.title}</span><span className="text-paper-3">{insight.insight_type.replaceAll("_", " ")} · {insight.confidence} confidence · {insight.status}</span></div><p className="mt-1 text-paper-3">{insight.summary}</p>{insight.recommended_action && <p className="mt-1 text-teal">Recommended: {insight.recommended_action}</p>}<details className="mt-1 text-paper-3"><summary>Evidence</summary><pre className="mt-1 whitespace-pre-wrap">{JSON.stringify(insight.evidence, null, 2)}</pre></details>{insight.status === "open" && <div className="mt-2 flex gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => void setInsightStatus(insight.id,"accepted")}>Accept signal</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => void setInsightStatus(insight.id,"dismissed")}>Dismiss</Button></div>}</article>)}{summary.performance_score && !(summary.performance_insights ?? []).length && <p className="text-2xs text-paper-3">No structured performance signal yet.</p>}</div></section>
        <section className="mt-5 rounded border border-line p-4"><h3 className="text-xs font-medium text-paper">Iteration Intake</h3><p className="mt-1 text-2xs text-paper-3">Create candidates only after reviewing performance evidence. Approved candidates do not automatically change strategy.</p>{!summary.performance_score ? <p className="mt-3 text-xs text-paper-3">Run and review performance analysis before creating a score-linked candidate.</p> : <><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Candidate type</span><select className={inputClass} value={candidateType} onChange={(event)=>setCandidateType(event.target.value as typeof candidateType)}>{ITERATION_CANDIDATE_TYPES.map((value)=><option key={value} value={value}>{value.replaceAll("_"," ")}</option>)}</select></label><label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Confidence</span><select className={inputClass} value={candidateConfidence} onChange={(event)=>setCandidateConfidence(event.target.value as typeof candidateConfidence)}>{["low","medium","high"].map((value)=><option key={value}>{value}</option>)}</select></label><label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Priority</span><select className={inputClass} value={candidatePriority} onChange={(event)=>setCandidatePriority(event.target.value as typeof candidatePriority)}>{["low","medium","high"].map((value)=><option key={value}>{value}</option>)}</select></label></div>{(summary.performance_insights??[]).length > 0 && <label className="mt-3 flex flex-col gap-1"><span className="text-2xs text-paper-3">Source evidence</span><select className={inputClass} value={candidateInsightId} onChange={(event)=>setCandidateInsightId(event.target.value)}><option value="">Performance scorecard</option>{(summary.performance_insights??[]).map((insight)=><option key={insight.id} value={insight.id}>Performance insight: {insight.title}</option>)}</select></label>}<label className="mt-3 flex flex-col gap-1"><span className="text-2xs text-paper-3">Recommendation</span><textarea className={inputClass} value={candidateRecommendation} onChange={(event)=>setCandidateRecommendation(event.target.value)} /></label><label className="mt-3 flex flex-col gap-1"><span className="text-2xs text-paper-3">Rationale</span><textarea className={inputClass} value={candidateRationale} onChange={(event)=>setCandidateRationale(event.target.value)} /></label><Button size="sm" variant="primary" className="mt-3" disabled={busy} onClick={()=>void saveCandidate(candidateInsightId||undefined)}>Create iteration candidate</Button></>}
          <div className="mt-4 space-y-2">{!(summary.iteration_candidates??[]).length ? <p className="text-2xs text-paper-3">No iteration candidates yet.</p> : (summary.iteration_candidates??[]).map((candidate)=><article key={candidate.id} className="rounded border border-line bg-ink p-3 text-2xs"><div className="flex flex-wrap gap-2"><span className="text-paper">{candidate.candidate_type.replaceAll("_"," ")}</span><span className="text-paper-3">{candidate.status.replaceAll("_"," ")} · {candidate.priority} priority · {candidate.confidence} confidence</span></div><p className="mt-1 text-teal">{candidate.recommendation}</p><p className="mt-1 text-paper-3">{candidate.rationale}</p></article>)}</div><p className="mt-3 text-2xs text-paper-3">Converted means reviewed for future workflow; no files are changed in this gate.</p>
        </section>
        <section className="mt-5 rounded border border-line p-4"><h3 className="text-xs font-medium text-paper">Record manual platform metrics</h3><p className="mt-1 text-2xs text-paper-3">Blank values are omitted. Saving cannot change publication evidence.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{metricKeys.map((key) => <label key={key} className="flex flex-col gap-1"><span className="text-2xs text-paper-3">{LABELS[key] ?? key}</span><input type="number" min="0" max={key === "completion_rate" ? 100 : undefined} step="any" className={inputClass} value={metricValues[key] ?? ""} onChange={(event) => setMetricValues((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Snapshot time</span><input type="datetime-local" className={inputClass} value={snapshotAt} onChange={(event) => setSnapshotAt(event.target.value)} /></label><label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Snapshot label</span><select className={inputClass} value={snapshotLabel} onChange={(event) => setSnapshotLabel(event.target.value as MetricSnapshotLabel)}>{["manual","t_plus_1h","t_plus_6h","t_plus_24h","t_plus_48h","t_plus_7d"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label></div>
          <label className="mt-3 flex flex-col gap-1"><span className="text-2xs text-paper-3">Notes</span><textarea className={inputClass} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><label className="mt-3 flex flex-col gap-1"><span className="text-2xs text-paper-3">Evidence URL</span><input type="url" className={inputClass} value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} /></label><Button size="sm" variant="primary" className="mt-3" disabled={busy} onClick={() => void saveMetrics()}>Save metric snapshot</Button>
        </section>
        <section className="mt-5"><h3 className="text-xs font-medium text-paper">Business signal snapshots</h3>{!summary.business_signals.length ? <p className="mt-2 text-xs text-paper-3">No manual business signals recorded.</p> : <div className="mt-2 space-y-2">{summary.business_signals.map((row) => <div key={row.id} className="rounded border border-line bg-ink p-3 text-2xs"><div className="text-paper">{new Date(row.signal_at).toLocaleString()}</div><div className="mt-1 text-paper-3">{SIGNAL_KEYS.filter((key) => row[key] != null).map((key) => `${LABELS[key]}: ${row[key]}`).join(" · ")}</div>{row.operator_notes && <div className="mt-1 text-paper-2">{row.operator_notes}</div>}</div>)}</div>}</section>
        <section className="mt-5 rounded border border-line p-4"><h3 className="text-xs font-medium text-paper">Record manual business signals</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{SIGNAL_KEYS.map((key) => <label key={key} className="flex flex-col gap-1"><span className="text-2xs text-paper-3">{LABELS[key]}</span><input type="number" min="0" step={key === "cash_collected" ? "0.01" : "1"} className={inputClass} value={signalValues[key] ?? ""} onChange={(event) => setSignalValues((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div><label className="mt-3 flex flex-col gap-1"><span className="text-2xs text-paper-3">Signal time</span><input type="datetime-local" className={inputClass} value={signalAt} onChange={(event) => setSignalAt(event.target.value)} /></label><label className="mt-3 flex flex-col gap-1"><span className="text-2xs text-paper-3">Operator notes</span><textarea className={inputClass} value={operatorNotes} onChange={(event) => setOperatorNotes(event.target.value)} /></label><Button size="sm" variant="primary" className="mt-3" disabled={busy} onClick={() => void saveSignals()}>Save business signals</Button></section>
      </main>
    </div>
  </div>;
}

export function AnalyticsPanel({ clientId, executionMonth }: { clientId: string; executionMonth: string }) {
  const [summaries, setSummaries] = useState<AnalyticsSummary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<InsightsCollectionRun[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const load = useCallback(async () => { setLoading(true); setError(null); try { const [nextSummaries, nextRuns] = await Promise.all([fetchAnalyticsForClient(clientId, executionMonth), fetchInsightsCollectionRuns(5)]); setSummaries(nextSummaries); setRuns(nextRuns); } catch (value) { setError(errorText(value)); } finally { setLoading(false); } }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => void load(); window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);
  const records = useMemo(() => summaries.map((summary) => summary.record), [summaries]);
  useFocusedRecord<AnalyticsRecordRow>({ queryKeys: ["analytics_id", "distribution_id", "source_ref"], records, getMatchValue: useCallback((record, key) => key === "analytics_id" ? record.id : key === "distribution_id" ? record.distribution_record_id : record.source_ref, []), onFound: useCallback((record) => setOpenId(record.id), []) });
  const open = summaries.find((summary) => summary.record.id === openId) ?? null;
  async function runAnalysis() { try { setAnalyzing(true); setError(null); const result = await runDeterministicPerformanceAnalysis(clientId, executionMonth); await load(); if (!result.recordsScored) setError("Published, awaiting enough metrics."); } catch (value) { setError(errorText(value)); } finally { setAnalyzing(false); } }
  if (loading && !summaries.length) return <div className="p-6 text-xs text-paper-3">Loading analytics…</div>;
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3"><div className="flex items-center gap-3 text-xs"><span className="text-paper">{summaries.length} published item{summaries.length === 1 ? "" : "s"}</span><Button size="sm" variant="ghost" className="ml-auto" disabled={loading || analyzing} onClick={() => void runAnalysis()}>{analyzing ? "Analyzing…" : "Run performance analysis"}</Button><Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>{loading ? "Reloading…" : "Reload"}</Button></div><p className="mt-2 text-2xs text-paper-3">Manual entry remains available. Automatic Instagram Insights collection is read-only here and scheduled hourly. Performance analysis is deterministic and explainable.</p>{runs[0] && <div className="mt-2 text-2xs text-paper-3">Last collection run: {new Date(runs[0].started_at).toLocaleString()} · {runs[0].status.replaceAll("_", " ")} · {runs[0].failed_count} failures</div>}<div className="mt-1 text-2xs text-paper-3">Pending automatic snapshots: {summaries.filter((item) => item.automatic_status === "automatic_metrics_pending").length} · Story metrics expired/unavailable: {summaries.filter((item) => item.automatic_status === "story_metrics_expired").length} · Scored: {summaries.filter((item) => item.performance_score?.score_status === "scored").length}</div></div>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {!summaries.length ? <div className="rounded-[10px] border border-dashed border-line p-10 text-center text-sm text-paper">No published content yet.</div> : <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">{summaries.map((summary) => { const record = summary.record; const signals = summary.business_signals[0]; return <article key={record.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"><span className="w-28 shrink-0 font-mono text-2xs text-teal">{record.source_ref}</span><div className="min-w-[240px] flex-1"><div className="text-xs text-paper">{record.title ?? record.source_ref}</div><div className="mt-1 flex flex-wrap gap-x-3 text-2xs text-paper-3"><span>{record.asset_format ?? "content"}</span><span>{record.platform ?? "instagram"}</span><span>published {new Date(record.published_at).toLocaleString()}</span>{record.published_url && <a href={record.published_url} target="_blank" rel="noreferrer" className="text-teal hover:underline">post ↗</a>}</div><div className="mt-1 text-2xs text-paper-3">{headline(summary)}</div>{signals && <div className="mt-1 text-2xs text-paper-2">Business: {signals.inbound_dms ?? 0} DMs · {signals.appointments ?? 0} appointments · {signals.show_ups ?? 0} show-ups · {signals.cash_collected ?? 0} cash</div>}<div className="mt-1 text-2xs text-paper-3">Latest snapshot: {summary.latest_snapshot_at ? new Date(summary.latest_snapshot_at).toLocaleString() : "none"}</div><div className="mt-1 text-2xs text-paper-3">Automatic: {summary.automatic_status.replaceAll("_", " ")}</div>{summary.performance_score ? <div className="mt-1 text-2xs text-teal">Performance {summary.performance_score.overall_score}/100 · {summary.performance_score.sample_quality} · {(summary.performance_insights ?? []).length} signals</div> : <div className="mt-1 text-2xs text-paper-3">Published, awaiting enough metrics.</div>}</div><span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${STATUS_STYLE[summary.manual_status]}`}>{summary.manual_status.replaceAll("_", " ")}</span><Button size="sm" variant="ghost" onClick={() => setOpenId(record.id)}>View / record</Button></article>; })}</div>}
    {open && <AnalyticsDetail summary={open} onClose={() => setOpenId(null)} onSaved={() => void load()} />}
  </div>;
}
