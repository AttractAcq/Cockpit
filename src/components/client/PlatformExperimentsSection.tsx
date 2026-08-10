import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { assignDistributionRecordToExperiment, completePlatformExperiment, createPlatformExperiment, fetchDistributionRecordsForExperimentAssignment, fetchPlatformExperiments, fetchPlatformPerformanceScores, linkPlatformExperimentToIterationCandidate } from "@/lib/api";
import { comparePlatformPerformance } from "@/lib/platform-experiments";
import type { ClientIterationCandidate, ClientPlatformExperiment, PlatformExperimentCommercialObjective, PlatformExperimentPlatform } from "@/types/phase";

const inputClass = "rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper outline-none focus:border-teal/50";
const OBJECTIVES: PlatformExperimentCommercialObjective[] = ["awareness", "consideration", "decision", "retention"];

function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String((error as { message?: unknown }).message);
  return String(error);
}

/** The general "so far" comparison across all real organic content, independent of any specific experiment. */
function PlatformComparisonCard({ clientId }: { clientId: string }) {
  const [comparison, setComparison] = useState<ReturnType<typeof comparePlatformPerformance> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPlatformPerformanceScores(clientId).then((scores) => { if (!cancelled) setComparison(comparePlatformPerformance(scores)); }).catch((value) => { if (!cancelled) setError(errorText(value)); });
    return () => { cancelled = true; };
  }, [clientId]);
  if (error) return <div role="alert" className="rounded border border-neg/20 bg-neg/5 p-3 text-xs text-neg">{error}</div>;
  if (!comparison) return null;
  return <section className="rounded-[10px] border border-line bg-ink-200 p-4">
    <h3 className="text-sm font-medium text-paper">Facebook vs Instagram — overall signal so far</h3>
    {!comparison.comparable
      ? <p className="mt-2 text-xs text-paper-3">Not enough scored content on both platforms yet to compare. This section only ever shows a comparison once both platforms have at least one real scored sample — it never fabricates one.</p>
      : <>
        <p className="mt-2 text-xs text-paper">{comparison.narrative}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{comparison.groups.map((group) => <div key={group.platform} className="rounded border border-line bg-ink p-3">
          <div className="text-xs font-medium capitalize text-paper">{group.platform}</div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center text-2xs"><span>Overall<br /><b>{group.averageOverallScore}</b></span><span>Attention<br /><b>{group.averageAttentionScore}</b></span><span>Engagement<br /><b>{group.averageEngagementScore}</b></span><span>Conversion<br /><b>{group.averageConversionScore}</b></span></div>
          <div className="mt-2 text-2xs text-paper-3">{group.sampleSize} scored sample{group.sampleSize === 1 ? "" : "s"} ({group.matureSampleSize} mature)</div>
        </div>)}</div>
      </>}
  </section>;
}

export function PlatformExperimentsSection({ clientId, candidates }: { clientId: string; candidates: ClientIterationCandidate[] }) {
  const [experiments, setExperiments] = useState<ClientPlatformExperiment[]>([]);
  const [records, setRecords] = useState<Awaited<ReturnType<typeof fetchDistributionRecordsForExperimentAssignment>>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [platformA, setPlatformA] = useState<PlatformExperimentPlatform>("instagram");
  const [platformB, setPlatformB] = useState<PlatformExperimentPlatform>("facebook");
  const [avatarLabel, setAvatarLabel] = useState("");
  const [segmentLabel, setSegmentLabel] = useState("");
  const [contentFormat, setContentFormat] = useState("");
  const [commercialObjective, setCommercialObjective] = useState<PlatformExperimentCommercialObjective | "">("");
  const [assignSelection, setAssignSelection] = useState<Record<string, string>>({});
  const [outcomeDrafts, setOutcomeDrafts] = useState<Record<string, { summary: string; confidence: "low" | "medium" | "high" }>>({});
  const [linkDrafts, setLinkDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextExperiments, nextRecords] = await Promise.all([fetchPlatformExperiments(clientId), fetchDistributionRecordsForExperimentAssignment(clientId)]);
      setExperiments(nextExperiments); setRecords(nextRecords);
    } catch (value) { setError(errorText(value)); } finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  const approvedCandidates = useMemo(() => candidates.filter((c) => c.status === "approved"), [candidates]);

  async function create() {
    if (!title.trim() || !hypothesis.trim()) return setError("Title and hypothesis are required.");
    if (platformA === platformB) return setError("The two platforms being compared must differ.");
    try {
      setBusy(true); setError(null);
      await createPlatformExperiment({ clientId, title: title.trim(), hypothesis: hypothesis.trim(), platformA, platformB, avatarLabel: avatarLabel.trim() || null, segmentLabel: segmentLabel.trim() || null, contentFormat: contentFormat.trim() || null, commercialObjective: commercialObjective || null });
      setTitle(""); setHypothesis(""); setAvatarLabel(""); setSegmentLabel(""); setContentFormat(""); setCommercialObjective("");
      await load();
    } catch (value) { setError(errorText(value)); } finally { setBusy(false); }
  }

  async function assign(experimentId: string) {
    const recordId = assignSelection[experimentId];
    if (!recordId) return setError("Select a published item to assign first.");
    try { setBusy(true); setError(null); await assignDistributionRecordToExperiment(experimentId, recordId); setAssignSelection((current) => ({ ...current, [experimentId]: "" })); await load(); }
    catch (value) { setError(errorText(value)); } finally { setBusy(false); }
  }

  async function complete(experimentId: string) {
    const draft = outcomeDrafts[experimentId];
    if (!draft?.summary.trim()) return setError("An outcome summary is required to complete an experiment.");
    try { setBusy(true); setError(null); await completePlatformExperiment(experimentId, draft.summary.trim(), draft.confidence ?? "low"); await load(); }
    catch (value) { setError(errorText(value)); } finally { setBusy(false); }
  }

  async function link(experimentId: string) {
    const candidateId = linkDrafts[experimentId];
    if (!candidateId) return setError("Select an approved iteration candidate to link.");
    try { setBusy(true); setError(null); await linkPlatformExperimentToIterationCandidate(experimentId, candidateId); await load(); }
    catch (value) { setError(errorText(value)); } finally { setBusy(false); }
  }

  return <div className="flex flex-col gap-4">
    <PlatformComparisonCard clientId={clientId} />
    <section className="rounded-[10px] border border-line bg-ink-200 p-4">
      <h3 className="text-sm font-medium text-paper">Platform Experiments</h3>
      <p className="mt-1 text-2xs text-paper-3">A controlled comparison of real, assigned content between two platforms. Completing an experiment records an observation — it never changes strategy or context files on its own; link it to an approved iteration candidate to carry it forward.</p>
      {error && <div role="alert" className="mt-2 rounded border border-neg/20 bg-neg/5 p-3 text-xs text-neg">{error}</div>}
      <div className="mt-4 rounded border border-line bg-ink p-3">
        <h4 className="text-xs font-medium text-paper">New experiment</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><input className={inputClass} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} /><input className={inputClass} placeholder="Hypothesis — what commercial question is this testing?" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} /></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-4">
          <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Platform A</span><select className={inputClass} value={platformA} onChange={(e) => setPlatformA(e.target.value as PlatformExperimentPlatform)}><option value="instagram">instagram</option><option value="facebook">facebook</option></select></label>
          <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Platform B</span><select className={inputClass} value={platformB} onChange={(e) => setPlatformB(e.target.value as PlatformExperimentPlatform)}><option value="facebook">facebook</option><option value="instagram">instagram</option></select></label>
          <label className="flex flex-col gap-1"><span className="text-2xs text-paper-3">Commercial objective</span><select className={inputClass} value={commercialObjective} onChange={(e) => setCommercialObjective(e.target.value as PlatformExperimentCommercialObjective | "")}><option value="">Not specified</option>{OBJECTIVES.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
          <input className={inputClass} placeholder="Content format" value={contentFormat} onChange={(e) => setContentFormat(e.target.value)} />
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2"><input className={inputClass} placeholder="Avatar (e.g. from 02_Avatar_And_Buyer_Psychology.md)" value={avatarLabel} onChange={(e) => setAvatarLabel(e.target.value)} /><input className={inputClass} placeholder="Segment" value={segmentLabel} onChange={(e) => setSegmentLabel(e.target.value)} /></div>
        <Button className="mt-3" size="sm" variant="primary" disabled={busy} onClick={() => void create()}>Create experiment</Button>
      </div>

      {loading && !experiments.length ? <p className="mt-4 text-xs text-paper-3">Loading…</p> : !experiments.length ? <p className="mt-4 text-xs text-paper-3">No platform experiments yet.</p> : <div className="mt-4 space-y-3">
        {experiments.map((experiment) => {
          const assignable = records.filter((r) => !r.platform_experiment_id && (r.platform === experiment.platform_a || r.platform === experiment.platform_b));
          const assigned = records.filter((r) => r.platform_experiment_id === experiment.id);
          return <article key={experiment.id} className="rounded border border-line bg-ink p-3 text-2xs">
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-paper">{experiment.title}</span><span className="text-paper-3">{experiment.status} · {experiment.platform_a} vs {experiment.platform_b}{experiment.commercial_objective ? ` · ${experiment.commercial_objective}` : ""}</span></div>
            <p className="mt-2 text-paper-3">{experiment.hypothesis}</p>
            {(experiment.avatar_label || experiment.segment_label) && <p className="mt-1 text-paper-3">{experiment.avatar_label ? `Avatar: ${experiment.avatar_label}` : ""}{experiment.avatar_label && experiment.segment_label ? " · " : ""}{experiment.segment_label ? `Segment: ${experiment.segment_label}` : ""}</p>}

            <div className="mt-2 text-paper-3">Assigned content ({assigned.length}): {assigned.length ? assigned.map((r) => `${r.source_ref} (${r.platform})`).join(", ") : "none yet"}</div>

            {experiment.status !== "completed" && experiment.status !== "abandoned" && <div className="mt-2 flex flex-wrap items-center gap-2">
              <select className={inputClass} value={assignSelection[experiment.id] ?? ""} onChange={(e) => setAssignSelection((current) => ({ ...current, [experiment.id]: e.target.value }))}>
                <option value="">Assign a published item…</option>{assignable.map((r) => <option key={r.id} value={r.id}>{r.source_ref} ({r.platform})</option>)}
              </select>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void assign(experiment.id)}>Assign</Button>
            </div>}

            {experiment.status === "completed" ? <div className="mt-3 rounded border border-line bg-ink-200 p-2">
              <div className="text-paper">Outcome ({experiment.outcome_confidence} confidence): {experiment.outcome_summary}</div>
              {experiment.iteration_candidate_id ? <div className="mt-1 text-teal">Linked to an approved iteration candidate.</div> : approvedCandidates.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2">
                <select className={inputClass} value={linkDrafts[experiment.id] ?? ""} onChange={(e) => setLinkDrafts((current) => ({ ...current, [experiment.id]: e.target.value }))}>
                  <option value="">Link to approved iteration candidate…</option>{approvedCandidates.map((c) => <option key={c.id} value={c.id}>{c.recommendation.slice(0, 60)}</option>)}
                </select>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void link(experiment.id)}>Link</Button>
              </div>}
            </div> : <div className="mt-3">
              <textarea className={inputClass + " w-full"} placeholder="Outcome summary (required to complete)" value={outcomeDrafts[experiment.id]?.summary ?? ""} onChange={(e) => setOutcomeDrafts((current) => ({ ...current, [experiment.id]: { summary: e.target.value, confidence: current[experiment.id]?.confidence ?? "low" } }))} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select className={inputClass} value={outcomeDrafts[experiment.id]?.confidence ?? "low"} onChange={(e) => setOutcomeDrafts((current) => ({ ...current, [experiment.id]: { summary: current[experiment.id]?.summary ?? "", confidence: e.target.value as "low" | "medium" | "high" } }))}>{["low", "medium", "high"].map((v) => <option key={v} value={v}>{v} confidence</option>)}</select>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => void complete(experiment.id)}>Complete experiment</Button>
              </div>
            </div>}
          </article>;
        })}
      </div>}
    </section>
  </div>;
}
