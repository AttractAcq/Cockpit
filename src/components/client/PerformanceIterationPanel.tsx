import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/primitives";
import { createIterationCandidate, fetchAnalyticsForClient, fetchIterationCandidates, fetchPerformanceAnalysisRuns, runDeterministicPerformanceAnalysis, updateIterationCandidateStatus } from "@/lib/api";
import { ITERATION_CANDIDATE_TYPES, iterationEvidenceFromScore } from "@/lib/iteration-intake";
import type { AnalyticsSummary, ClientIterationCandidate, ClientPerformanceInsight } from "@/types/phase";
import { ContextUpdateProposalsSection } from "./ContextUpdateProposalsSection";

const inputClass = "rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper outline-none focus:border-teal/50";
const STATUSES = ["needs_review","approved","dismissed","converted"] as const;

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as {message?:unknown}).message);
  return String(error);
}

function metricSummary(summary: AnalyticsSummary): string {
  const metrics = summary.metric_snapshots[0]?.metrics ?? {};
  const values = Object.entries(metrics).slice(0,5).map(([key,value]) => `${key.replaceAll("_"," ")} ${value}`);
  return values.join(" · ") || "No metric snapshot";
}

function businessSummary(summary: AnalyticsSummary): string {
  const row = summary.business_signals[0];
  if (!row) return "No business signals recorded yet.";
  return `${row.inbound_dms ?? 0} DMs · ${row.appointments ?? 0} appointments · ${row.show_ups ?? 0} show-ups · ${row.cash_collected ?? 0} cash`;
}

export function PerformanceIterationPanel({ clientId, executionMonth }: { clientId:string; executionMonth:string }) {
  const [searchParams] = useSearchParams();
  const [summaries,setSummaries] = useState<AnalyticsSummary[]>([]);
  const [candidates,setCandidates] = useState<ClientIterationCandidate[]>([]);
  const [lastRun,setLastRun] = useState<string | null>(null);
  const [selectedId,setSelectedId] = useState("");
  const [sourceMode,setSourceMode] = useState<"performance_score"|"performance_insight"|"manual">("performance_score");
  const [insightId,setInsightId] = useState("");
  const [manualSourceRef,setManualSourceRef] = useState("");
  const [candidateType,setCandidateType] = useState<(typeof ITERATION_CANDIDATE_TYPES)[number]>("content_angle");
  const [recommendation,setRecommendation] = useState("");
  const [rationale,setRationale] = useState("");
  const [confidence,setConfidence] = useState<"low"|"medium"|"high">("low");
  const [priority,setPriority] = useState<"low"|"medium"|"high">("medium");
  const [reviewNotes,setReviewNotes] = useState<Record<string,string>>({});
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextSummaries,nextCandidates,runs] = await Promise.all([fetchAnalyticsForClient(clientId,executionMonth),fetchIterationCandidates(clientId),fetchPerformanceAnalysisRuns(clientId,1)]);
      setSummaries(nextSummaries); setCandidates(nextCandidates); setLastRun(runs[0]?.finished_at ?? runs[0]?.started_at ?? null);
      setSelectedId((current) => current || nextSummaries.find((item)=>item.performance_score)?.record.distribution_record_id || nextSummaries[0]?.record.distribution_record_id || "");
    } catch (value) { setError(errorText(value)); } finally { setLoading(false); }
  },[clientId,executionMonth]);
  useEffect(()=>{ void load(); },[load]);
  useEffect(()=>{ const reload=()=>void load(); window.addEventListener("aa:reload",reload); return()=>window.removeEventListener("aa:reload",reload); },[load]);

  const selected = summaries.find((item)=>item.record.distribution_record_id===selectedId) ?? null;
  useEffect(()=>{
    const distributionId=searchParams.get("distribution_id"); const sourceRef=searchParams.get("source_ref");
    const focused=summaries.find((item)=>distributionId ? item.record.distribution_record_id===distributionId : sourceRef ? item.record.source_ref===sourceRef : false);
    if(focused?.record.distribution_record_id)setSelectedId(focused.record.distribution_record_id);
  },[searchParams,summaries]);
  const insights = useMemo(()=>summaries.flatMap((item)=>item.performance_insights??[]),[summaries]);
  const selectedInsight = insights.find((item)=>item.id===insightId) ?? null;
  const counts = useMemo(()=>Object.fromEntries(STATUSES.map((status)=>[status,candidates.filter((item)=>item.status===status).length])),[candidates]);

  async function analyze() {
    try { setBusy(true); setError(null); await runDeterministicPerformanceAnalysis(clientId,executionMonth); await load(); }
    catch (value) { setError(errorText(value)); } finally { setBusy(false); }
  }

  async function createCandidate() {
    if (!recommendation.trim() || !rationale.trim()) return setError("Recommendation and rationale are required.");
    if (sourceMode==="performance_score" && !selected?.performance_score) return setError("Select a record with a performance score.");
    if (sourceMode==="performance_insight" && !selectedInsight) return setError("Select a performance insight.");
    const insightSummary = selectedInsight ? summaries.find((item)=>(item.performance_insights??[]).some((insight)=>insight.id===selectedInsight.id)) ?? null : null;
    const sourceSummary = sourceMode==="performance_insight" ? insightSummary : selected;
    const evidence = sourceMode==="performance_score" && selected?.performance_score
      ? iterationEvidenceFromScore(selected.performance_score,selected.metric_snapshots[0]?.metrics??{})
      : sourceMode==="performance_insight" && selectedInsight
        ? { insight_type:selectedInsight.insight_type,title:selectedInsight.title,summary:selectedInsight.summary,evidence:selectedInsight.evidence,recommended_action:selectedInsight.recommended_action }
        : { observation:"Manual operator observation" };
    try {
      setBusy(true); setError(null);
      await createIterationCandidate({
        clientId,sourceRef:sourceMode==="manual" ? manualSourceRef.trim()||null : sourceSummary?.record.source_ref??null,
        distributionRecordId:sourceMode==="manual" ? null : sourceSummary?.record.distribution_record_id??null,
        performanceScoreId:sourceMode==="performance_score" ? selected?.performance_score?.id??null : null,
        performanceInsightId:sourceMode==="performance_insight" ? selectedInsight?.id??null : null,
        candidateType,recommendation:recommendation.trim(),rationale:rationale.trim(),evidence,confidence,priority,createdFrom:sourceMode,
      });
      setRecommendation(""); setRationale(""); setManualSourceRef(""); setInsightId(""); await load();
    } catch (value) { setError(errorText(value)); } finally { setBusy(false); }
  }

  async function review(candidate: ClientIterationCandidate,status:"approved"|"dismissed"|"converted") {
    try { setBusy(true); setError(null); await updateIterationCandidateStatus(candidate.id,status,reviewNotes[candidate.id]?.trim()||null); await load(); }
    catch (value) { setError(errorText(value)); } finally { setBusy(false); }
  }

  if (loading && !summaries.length) return <div className="p-6 text-xs text-paper-3">Loading Performance &amp; Iteration…</div>;
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
    <section className="rounded-[10px] border border-line bg-ink-200 p-4"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h2 className="text-sm font-medium text-paper">Performance &amp; Iteration</h2><p className="mt-1 text-xs text-paper-3">This tab converts performance evidence into reviewed iteration candidates.</p><p className="mt-1 text-2xs text-warn">Approved candidates do not automatically change strategy or context files. Context updates happen in a later reviewed gate.</p></div><Button size="sm" variant="ghost" disabled={busy} onClick={()=>void analyze()}>{busy?"Working…":"Run performance analysis"}</Button><Button size="sm" variant="ghost" disabled={loading} onClick={()=>void load()}>Reload</Button></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">{[
        ["Published",summaries.length],["Scored",summaries.filter((item)=>item.performance_score?.score_status==="scored").length],["Pending metrics",summaries.filter((item)=>!item.performance_score||item.performance_score.score_status==="pending_metrics").length],["Insufficient",summaries.filter((item)=>item.performance_score?.score_status==="insufficient_data").length],["Usable / scored",summaries.filter((item)=>item.performance_score?.sample_quality==="usable"||item.performance_score?.sample_quality==="mature").length],["Insights",insights.length],
      ].map(([label,value])=><div key={label} className="rounded border border-line bg-ink p-3"><div className="text-lg text-paper">{value}</div><div className="text-2xs text-paper-3">{label}</div></div>)}</div>
      <div className="mt-2 flex flex-wrap gap-3 text-2xs text-paper-3">{STATUSES.map((status)=><span key={status}>{status.replaceAll("_"," ")}: {counts[status]??0}</span>)}<span>Last analysis: {lastRun?new Date(lastRun).toLocaleString():"never"}</span></div>
    </section>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 p-3 text-xs text-neg">{error}</div>}

    <section><h3 className="text-sm font-medium text-paper">Performance Scorecards</h3><div className="mt-2 grid gap-3 xl:grid-cols-2">{summaries.map((summary)=>{const score=summary.performance_score;return <button key={summary.record.id} className={`rounded-[10px] border p-4 text-left ${selectedId===summary.record.distribution_record_id?"border-teal/50 bg-teal/5":"border-line bg-ink-200"}`} onClick={()=>setSelectedId(summary.record.distribution_record_id??"")}><div className="flex flex-wrap justify-between gap-2"><span className="font-mono text-2xs text-teal">{summary.record.source_ref}</span><span className="text-2xs text-paper-3">{summary.record.asset_format??"content"} · {summary.record.platform??"instagram"}</span></div><div className="mt-1 text-xs text-paper">{summary.record.title??summary.record.source_ref}</div>{score?<><div className="mt-3 grid grid-cols-5 gap-2 text-center text-2xs"><span>Overall<br/><b>{score.overall_score}</b></span><span>Attention<br/><b>{score.attention_score}</b></span><span>Engagement<br/><b>{score.engagement_score}</b></span><span>Trust<br/><b>{score.trust_score}</b></span><span>Conversion<br/><b>{score.conversion_signal_score}</b></span></div><div className="mt-2 text-2xs text-paper-3">{score.sample_quality} · {score.score_status.replaceAll("_"," ")}</div><ul className="mt-2 text-2xs text-paper-3">{score.score_reasons.map((reason)=><li key={reason}>• {reason}</li>)}</ul></>:<p className="mt-3 text-2xs text-paper-3">Published, awaiting enough metrics.</p>}<div className="mt-2 text-2xs text-paper-3">Latest metrics: {metricSummary(summary)}</div><div className="mt-1 text-2xs text-paper-3">Business: {businessSummary(summary)}</div></button>})}</div></section>

    <section><h3 className="text-sm font-medium text-paper">Performance Insights</h3>{!insights.length?<div className="mt-2 rounded border border-dashed border-line p-6 text-center text-xs text-paper-3">No performance insights have crossed the threshold yet.</div>:<div className="mt-2 space-y-2">{insights.map((insight)=><article key={insight.id} className="rounded border border-line bg-ink-200 p-4 text-xs"><div className="flex flex-wrap gap-2"><span className="text-paper">{insight.title}</span><span className="text-paper-3">{insight.insight_type.replaceAll("_"," ")} · {insight.confidence} confidence · {insight.severity} severity · {insight.status}</span></div><p className="mt-2 text-paper-3">{insight.summary}</p>{insight.recommended_action&&<p className="mt-1 text-teal">{insight.recommended_action}</p>}<details className="mt-2 text-2xs text-paper-3"><summary>Evidence</summary><pre className="mt-2 whitespace-pre-wrap">{JSON.stringify(insight.evidence,null,2)}</pre></details></article>)}</div>}</section>

    <section className="rounded-[10px] border border-line bg-ink-200 p-4"><h3 className="text-sm font-medium text-paper">Create Candidate</h3><p className="mt-1 text-2xs text-paper-3">Create candidates only after reviewing performance evidence.</p><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Created from</span><select className={inputClass} value={sourceMode} onChange={(event)=>setSourceMode(event.target.value as typeof sourceMode)}><option value="performance_score">Performance score</option><option value="performance_insight">Performance insight</option><option value="manual">Manual observation</option></select></label>{sourceMode==="performance_insight"?<label className="flex flex-col gap-1 sm:col-span-2"><span className="text-2xs text-paper-3">Insight</span><select className={inputClass} value={insightId} onChange={(event)=>setInsightId(event.target.value)}><option value="">Select insight</option>{insights.map((insight)=><option key={insight.id} value={insight.id}>{insight.title}</option>)}</select></label>:sourceMode==="manual"?<label className="flex flex-col gap-1 sm:col-span-2"><span className="text-2xs text-paper-3">Source ref (optional)</span><input className={inputClass} value={manualSourceRef} onChange={(event)=>setManualSourceRef(event.target.value)} /></label>:<label className="flex flex-col gap-1 sm:col-span-2"><span className="text-2xs text-paper-3">Performance record</span><select className={inputClass} value={selectedId} onChange={(event)=>setSelectedId(event.target.value)}>{summaries.filter((item)=>item.performance_score).map((item)=><option key={item.record.id} value={item.record.distribution_record_id??""}>{item.record.source_ref} — {item.record.title??"Untitled"}</option>)}</select></label>}</div><div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Candidate type</span><select className={inputClass} value={candidateType} onChange={(event)=>setCandidateType(event.target.value as typeof candidateType)}>{ITERATION_CANDIDATE_TYPES.map((value)=><option key={value}>{value}</option>)}</select></label><label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Confidence</span><select className={inputClass} value={confidence} onChange={(event)=>setConfidence(event.target.value as typeof confidence)}>{["low","medium","high"].map((value)=><option key={value}>{value}</option>)}</select></label><label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Priority</span><select className={inputClass} value={priority} onChange={(event)=>setPriority(event.target.value as typeof priority)}>{["low","medium","high"].map((value)=><option key={value}>{value}</option>)}</select></label></div><label className="mt-3 flex flex-col gap-1"><span className="text-2xs text-paper-3">Recommendation</span><textarea className={inputClass} value={recommendation} onChange={(event)=>setRecommendation(event.target.value)} /></label><label className="mt-3 flex flex-col gap-1"><span className="text-2xs text-paper-3">Rationale</span><textarea className={inputClass} value={rationale} onChange={(event)=>setRationale(event.target.value)} /></label><Button className="mt-3" size="sm" variant="primary" disabled={busy} onClick={()=>void createCandidate()}>Create iteration candidate</Button></section>

    <section><h3 className="text-sm font-medium text-paper">Iteration Candidates</h3>{!candidates.length?<div className="mt-2 rounded border border-dashed border-line p-6 text-center text-xs text-paper-3">No iteration candidates yet.</div>:<div className="mt-3 grid gap-4 xl:grid-cols-2">{STATUSES.map((status)=><div key={status}><h4 className="text-xs font-medium text-paper">{status.replaceAll("_"," ")} ({counts[status]??0})</h4><div className="mt-2 space-y-2">{candidates.filter((item)=>item.status===status).map((candidate)=><article key={candidate.id} className="rounded border border-line bg-ink-200 p-3 text-2xs"><div className="flex flex-wrap gap-2"><span className="font-mono text-teal">{candidate.source_ref??"client-level"}</span><span className="text-paper">{candidate.candidate_type.replaceAll("_"," ")}</span><span className="text-paper-3">{candidate.priority} priority · {candidate.confidence} confidence · from {candidate.created_from.replaceAll("_"," ")}</span></div><p className="mt-2 text-paper">{candidate.recommendation}</p><p className="mt-1 text-paper-3">{candidate.rationale}</p><details className="mt-2 text-paper-3"><summary>Evidence summary</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(candidate.evidence,null,2)}</pre></details>{candidate.reviewer_notes&&<p className="mt-2 text-paper-3">Reviewer notes: {candidate.reviewer_notes}</p>}<div className="mt-2 text-paper-3">Created {new Date(candidate.created_at).toLocaleString()}{candidate.reviewed_at?` · reviewed ${new Date(candidate.reviewed_at).toLocaleString()}`:""}</div>{(candidate.status==="needs_review"||candidate.status==="approved")&&<><label className="mt-3 flex flex-col gap-1"><span className="text-paper-3">Reviewer notes</span><input className={inputClass} value={reviewNotes[candidate.id]??""} onChange={(event)=>setReviewNotes((current)=>({...current,[candidate.id]:event.target.value}))} /></label><div className="mt-2 flex flex-wrap gap-2">{candidate.status==="needs_review"&&<Button size="sm" variant="primary" disabled={busy} onClick={()=>void review(candidate,"approved")}>Approve</Button>}{candidate.status==="approved"&&<Button size="sm" variant="primary" disabled={busy} onClick={()=>void review(candidate,"converted")}>Mark converted</Button>}<Button size="sm" variant="ghost" disabled={busy} onClick={()=>void review(candidate,"dismissed")}>Dismiss</Button></div></>}</article>)}{!counts[status]&&<p className="rounded border border-dashed border-line p-3 text-2xs text-paper-3">No {status.replaceAll("_"," ")} candidates.</p>}</div></div>)}</div>}<p className="mt-3 text-2xs text-paper-3">Converted only marks a candidate ready for a future workflow; it does not edit files in this gate.</p></section>
    <ContextUpdateProposalsSection clientId={clientId} candidates={candidates}/>
  </div>;
}
