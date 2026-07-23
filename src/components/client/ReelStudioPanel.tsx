import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/primitives";
import {
  checkShotStill,
  checkShotVideo,
  createVideoProject,
  createVideoShot,
  deleteVideoShot,
  fetchAdsMasterRowsForClient,
  fetchBrandPromptBlocks,
  fetchHiggsfieldMotions,
  fetchOrganicMasterRowsForClient,
  fetchVideoProjects,
  fetchVideoShots,
  fetchVideoShotsForProjects,
  generateShotStill,
  generateShotVideo,
  getVideoShotSignedUrls,
  handoffVideoProject,
  updateVideoProjectStatus,
  updateVideoShot,
} from "@/lib/api";
import type { AdsMasterRow, OrganicMasterRow } from "@/types/phase";
import type {
  AwarenessStage,
  BrandPromptBlockRow,
  HiggsfieldMotion,
  HumanPresence,
  RenderTier,
  ShotClass,
  VideoArchetype,
  VideoProjectRow,
  VideoProjectStatus,
  VideoShotRow,
} from "@/types/reel-studio";

const ARCHETYPES: VideoArchetype[] = ["A1", "A2", "A3", "A4", "A5"];
const AWARENESS_STAGES: AwarenessStage[] = ["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"];
const SHOT_CLASSES: ShotClass[] = ["metaphor", "atmosphere", "abstract"];
const HUMAN_PRESENCE: HumanPresence[] = ["none", "hands_only"];
const RENDER_TIERS: RenderTier[] = ["draft", "final"];

// 'handed_off' is not reachable through this generic whitelist -- it is only
// ever set by the dedicated handoff-video-project function (see the "Hand off
// to production" button below), which requires every shot to be a rendered
// clip and a real approved production brief before it will hand a project off.
const ALLOWED_TRANSITIONS: Record<VideoProjectStatus, VideoProjectStatus[]> = {
  storyboarding: ["generating"],
  generating: ["review"],
  review: ["approved", "generating"],
  approved: [],
  handed_off: [],
};

const TRANSITION_LABEL: Record<VideoProjectStatus, string> = {
  storyboarding: "Back to storyboarding",
  generating: "Move to generating",
  review: "Send to review",
  approved: "Approve",
  handed_off: "Hand off",
};

const PROJECT_STATUS_STYLE: Record<VideoProjectStatus, string> = {
  storyboarding: "border-line bg-ink text-paper-3",
  generating: "border-warn/20 bg-warn/10 text-warn",
  review: "border-teal/20 bg-teal/10 text-teal",
  approved: "border-teal/20 bg-teal/10 text-teal",
  handed_off: "border-line bg-ink text-paper-3",
};

const SHOT_STATUS_STYLE: Record<string, string> = {
  pending: "border-line bg-ink text-paper-3",
  still_submitted: "border-warn/20 bg-warn/10 text-warn",
  still_rendering: "border-warn/20 bg-warn/10 text-warn",
  still_complete: "border-teal/20 bg-teal/10 text-teal",
  submitted: "border-warn/20 bg-warn/10 text-warn",
  rendering: "border-warn/20 bg-warn/10 text-warn",
  complete: "border-teal/20 bg-teal/10 text-teal",
  failed: "border-neg/20 bg-neg/10 text-neg",
};

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string };
    if (value.message) return value.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function StatusBadge({ status }: { status: VideoProjectStatus }) {
  return <span className={`rounded border px-1.5 py-0.5 text-2xs font-mono ${PROJECT_STATUS_STYLE[status]}`}>{status.replaceAll("_", " ")}</span>;
}

function ShotStatusBadge({ status }: { status: string }) {
  return <span className={`rounded border px-1.5 py-0.5 text-2xs font-mono ${SHOT_STATUS_STYLE[status] ?? "border-line text-paper-3"}`}>{status.replaceAll("_", " ")}</span>;
}

function sourceRefFor(project: VideoProjectRow, organicRows: OrganicMasterRow[], adsRows: AdsMasterRow[]): string {
  if (project.organic_master_id) return organicRows.find((row) => row.id === project.organic_master_id)?.ref ?? project.organic_master_id;
  if (project.ads_master_id) return adsRows.find((row) => row.id === project.ads_master_id)?.ref ?? project.ads_master_id;
  return "—";
}

function BrandBlockReference({ block }: { block: BrandPromptBlockRow | null }) {
  if (!block) return null;
  const fields: Array<[string, string | null]> = [
    ["Grade", block.grade_block],
    ["Lens", block.lens_block],
    ["Mood", block.mood_block],
    ["Motion", block.motion_block],
    ["Negative", block.negative_block],
  ];
  return <div className="rounded-[10px] border border-line bg-ink p-3">
    <div className="mb-2 flex items-center gap-2 text-2xs font-mono uppercase tracking-wide text-paper-3">Brand DNA reference · {block.name} v{block.version}</div>
    <div className="space-y-2">{fields.filter(([, value]) => value).map(([label, value]) => <div key={label}><span className="text-2xs font-mono text-paper-3">{label}: </span><span className="text-2xs leading-4 text-paper-2">{value}</span></div>)}</div>
  </div>;
}

function MotionPicker({ motions, value, onChange, loading }: { motions: HiggsfieldMotion[]; value: string | null; onChange: (id: string | null) => void; loading: boolean }) {
  const [query, setQuery] = useState("");
  const selected = motions.find((motion) => motion.id === value) ?? null;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return motions;
    return motions.filter((motion) => motion.name.toLowerCase().includes(q) || motion.description.toLowerCase().includes(q));
  }, [motions, query]);
  return <div>
    <label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Motion</label>
    {selected
      ? <div className="flex items-center gap-2 rounded border border-line bg-ink-200 px-2 py-1.5"><span className="flex-1 text-xs text-paper">{selected.name}</span><Button size="sm" variant="ghost" onClick={() => onChange(null)}>Change</Button></div>
      : <div className="space-y-1.5">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={loading ? "Loading motion catalog…" : "Search motions…"} disabled={loading} className="w-full rounded border border-line bg-ink-200 px-2 py-1.5 text-xs text-paper outline-none focus:border-teal/50" />
        <div className="max-h-40 overflow-y-auto rounded border border-line bg-ink-200">{filtered.slice(0, 40).map((motion) => <button key={motion.id} type="button" className="block w-full border-b border-line px-2 py-1.5 text-left text-xs text-paper last:border-b-0 hover:bg-ink" onClick={() => onChange(motion.id)}><span className="block">{motion.name}</span>{motion.description && <span className="block text-2xs text-paper-3">{motion.description}</span>}</button>)}{!loading && filtered.length === 0 && <div className="px-2 py-1.5 text-2xs text-paper-3">No motions match.</div>}</div>
      </div>}
  </div>;
}

function ShotFormModal({ videoProjectId, brandBlock, motions, motionsLoading, initialShot, onClose, onSaved }: {
  videoProjectId: string;
  brandBlock: BrandPromptBlockRow | null;
  motions: HiggsfieldMotion[];
  motionsLoading: boolean;
  initialShot: VideoShotRow | null;
  onClose: () => void;
  onSaved: (shot: VideoShotRow) => void;
}) {
  const [shotNumber, setShotNumber] = useState(initialShot?.shot_number ?? 1);
  const [beatDescription, setBeatDescription] = useState(initialShot?.beat_description ?? "");
  const [compiledPrompt, setCompiledPrompt] = useState(initialShot?.compiled_prompt ?? "");
  const [shotClass, setShotClass] = useState<ShotClass | "">(initialShot?.shot_class ?? "");
  const [humanPresence, setHumanPresence] = useState<HumanPresence>(initialShot?.human_presence ?? "none");
  const [renderTier, setRenderTier] = useState<RenderTier>(initialShot?.render_tier ?? "draft");
  const [motionType, setMotionType] = useState<string | null>(initialShot?.motion_type ?? null);
  const [motionStrength, setMotionStrength] = useState(initialShot?.motion_strength ?? 0.5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!shotClass) { setError("Shot class is required."); return; }
    if (!beatDescription.trim() || !compiledPrompt.trim()) { setError("Beat description and compiled prompt are required."); return; }
    setBusy(true); setError(null);
    try {
      const shot = initialShot
        ? await updateVideoShot(initialShot.id, {
          shotNumber, beatDescription, compiledPrompt, shotClass, humanPresence,
          motionType, motionStrength: motionType ? motionStrength : null, renderTier,
        })
        : await createVideoShot({
          videoProjectId, shotNumber, beatDescription, compiledPrompt, shotClass,
          humanPresence, motionType, motionStrength: motionType ? motionStrength : null, renderTier,
        });
      onSaved(shot);
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
    <div className="flex h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:h-[85vh] sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4"><h2 className="text-sm font-medium text-paper">{initialShot ? `Edit Shot ${initialShot.shot_number}` : "Add Shot"}</h2><button className="text-paper-3 hover:text-paper" onClick={onClose}>✕</button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Shot number</label><input type="number" min={1} value={shotNumber} onChange={(event) => setShotNumber(Number(event.target.value))} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper outline-none focus:border-teal/50" /></div>
            <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Beat description</label><textarea value={beatDescription} onChange={(event) => setBeatDescription(event.target.value)} className="min-h-20 w-full resize-y rounded border border-line bg-ink px-2 py-1.5 text-xs leading-5 text-paper outline-none focus:border-teal/50" /></div>
            <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Compiled prompt</label><textarea value={compiledPrompt} onChange={(event) => setCompiledPrompt(event.target.value)} className="min-h-28 w-full resize-y rounded border border-line bg-ink px-2 py-1.5 text-xs leading-5 text-paper outline-none focus:border-teal/50" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Shot class</label><select value={shotClass} onChange={(event) => setShotClass(event.target.value as ShotClass)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper"><option value="">Choose…</option>{SHOT_CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
              <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Human presence</label><select value={humanPresence} onChange={(event) => setHumanPresence(event.target.value as HumanPresence)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper">{HUMAN_PRESENCE.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
              <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Render tier</label><select value={renderTier} onChange={(event) => setRenderTier(event.target.value as RenderTier)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper">{RENDER_TIERS.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
            </div>
            <MotionPicker motions={motions} value={motionType} onChange={setMotionType} loading={motionsLoading} />
            {motionType && <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Motion strength ({motionStrength.toFixed(2)})</label><input type="range" min={0} max={1} step={0.05} value={motionStrength} onChange={(event) => setMotionStrength(Number(event.target.value))} className="w-full accent-teal" /></div>}
          </div>
          <div className="space-y-3"><BrandBlockReference block={brandBlock} /></div>
        </div>
        {error && <div role="alert" className="mt-3 rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3"><Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save shot"}</Button></div>
    </div>
  </div>;
}

function ShotRow({ shot, onChanged, onEdit, onDelete }: { shot: VideoShotRow; onChanged: (shot: VideoShotRow) => void; onEdit: () => void; onDelete: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<{ stillUrl: string | null; clipUrl: string | null }>({ stillUrl: null, clipUrl: null });

  useEffect(() => {
    let active = true;
    void getVideoShotSignedUrls(shot).then((value) => { if (active) setUrls(value); }).catch(() => { if (active) setUrls({ stillUrl: null, clipUrl: null }); });
    return () => { active = false; };
  }, [shot.still_image_url, shot.clip_url]);

  async function run(action: string, fn: () => Promise<VideoShotRow>) {
    setBusy(action); setError(null);
    try { onChanged(await fn()); }
    catch (value) { setError(errorText(value)); }
    finally { setBusy(null); }
  }

  const isPending = shot.status === "pending";
  return <div className="border-b border-line px-4 py-3.5 last:border-b-0">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="text-2xs font-mono text-teal">Shot {shot.shot_number}</span><ShotStatusBadge status={shot.status} /><span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">{shot.shot_class}</span><span className="text-2xs font-mono text-paper-3">{shot.human_presence}</span><span className="text-2xs font-mono text-paper-3">{shot.render_tier}</span></div>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-paper">{shot.beat_description}</p>
        {shot.error && <p className="mt-1 text-2xs text-neg">{shot.error}</p>}
        {urls.stillUrl && <a href={urls.stillUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-2xs text-teal underline">View still</a>}
        {urls.clipUrl && <a href={urls.clipUrl} target="_blank" rel="noreferrer" className="ml-3 inline-block text-2xs text-teal underline">View clip</a>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {isPending && <><Button size="sm" variant="ghost" onClick={onEdit}>Edit</Button><Button size="sm" variant="danger" onClick={onDelete}>Delete</Button></>}
        {shot.status === "pending" && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run("still", () => generateShotStill(shot.id))}>{busy === "still" ? "Submitting…" : "Generate still"}</Button>}
        {(shot.status === "still_submitted" || shot.status === "still_rendering") && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run("check-still", () => checkShotStill(shot.id))}>{busy === "check-still" ? "Checking…" : "Check still"}</Button>}
        {shot.status === "still_complete" && (shot.motion_type
          ? <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run("video", () => generateShotVideo(shot.id))}>{busy === "video" ? "Submitting…" : "Generate video"}</Button>
          : <span className="text-2xs text-warn">Edit shot to set a motion before generating video.</span>)}
        {(shot.status === "submitted" || shot.status === "rendering") && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run("check-video", () => checkShotVideo(shot.id))}>{busy === "check-video" ? "Checking…" : "Check video"}</Button>}
      </div>
    </div>
    {error && <div role="alert" className="mt-2 rounded border border-neg/20 bg-neg/5 px-2 py-1.5 text-2xs text-neg">{error}</div>}
  </div>;
}

function ProjectDetail({ project, organicRows, adsRows, brandBlocks, motions, motionsLoading, onBack, onProjectChanged }: {
  project: VideoProjectRow;
  organicRows: OrganicMasterRow[];
  adsRows: AdsMasterRow[];
  brandBlocks: BrandPromptBlockRow[];
  motions: HiggsfieldMotion[];
  motionsLoading: boolean;
  onBack: () => void;
  onProjectChanged: (project: VideoProjectRow) => void;
}) {
  const [shots, setShots] = useState<VideoShotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [shotModal, setShotModal] = useState<{ shot: VideoShotRow | null } | null>(null);
  const [handoffInfo, setHandoffInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setShots(await fetchVideoShots(project.id)); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [project.id]);
  useEffect(() => { void load(); }, [load]);

  async function transition(newStatus: VideoProjectStatus) {
    if (!window.confirm(`${TRANSITION_LABEL[newStatus]}?`)) return;
    setStatusBusy(true); setError(null);
    try { onProjectChanged(await updateVideoProjectStatus(project.id, newStatus)); }
    catch (value) { setError(errorText(value)); }
    finally { setStatusBusy(false); }
  }

  async function handoff() {
    if (!window.confirm("Hand off this project's rendered clips to production? This attaches them to the linked, approved production brief for human review.")) return;
    setStatusBusy(true); setError(null); setHandoffInfo(null);
    try {
      const result = await handoffVideoProject(project.id);
      onProjectChanged(result.project);
      setHandoffInfo(`Handed off ${result.assetCount} clip${result.assetCount === 1 ? "" : "s"} to production brief ${result.briefSourceRef} (needs review).`);
    } catch (value) { setError(errorText(value)); }
    finally { setStatusBusy(false); }
  }

  async function deleteShot(shot: VideoShotRow) {
    if (!window.confirm(`Delete shot ${shot.shot_number}?`)) return;
    setError(null);
    try { await deleteVideoShot(shot.id); setShots((current) => current.filter((row) => row.id !== shot.id)); }
    catch (value) { setError(errorText(value)); }
  }

  const brandBlock = brandBlocks.find((block) => block.id === project.brand_prompt_block_id) ?? null;
  const complete = shots.filter((shot) => shot.status === "complete").length;

  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <div className="shrink-0 rounded-[10px] border border-line bg-ink-200 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <Button size="sm" variant="ghost" onClick={onBack}>← All projects</Button>
          <div className="mt-2 flex flex-wrap items-center gap-2"><h2 className="text-sm font-medium text-paper">{project.title}</h2><StatusBadge status={project.status} /></div>
          <p className="mt-1 text-2xs font-mono text-paper-3">Source: {sourceRefFor(project, organicRows, adsRows)} · {project.archetype} · {project.awareness_stage.replaceAll("_", " ")} · {project.target_duration_sec}s · {complete}/{shots.length} shots complete</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {ALLOWED_TRANSITIONS[project.status].map((next) => <Button key={next} size="sm" variant="secondary" disabled={statusBusy} onClick={() => void transition(next)}>{TRANSITION_LABEL[next]}</Button>)}
          {project.status === "approved" && <Button size="sm" variant="primary" disabled={statusBusy} onClick={() => void handoff()}>{statusBusy ? "Handing off…" : "Hand off to production"}</Button>}
        </div>
      </div>
    </div>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {handoffInfo && <div role="status" className="rounded border border-teal/20 bg-teal/5 px-3 py-2 text-xs text-teal">{handoffInfo}</div>}
    <div className="shrink-0"><Button size="sm" variant="primary" onClick={() => setShotModal({ shot: null })}>Add shot</Button></div>
    {loading ? <div className="p-6 text-xs text-paper-3">Loading shots…</div>
      : shots.length === 0 ? <div className="rounded-[10px] border border-dashed border-line p-10 text-center text-xs text-paper-3">No shots yet. Add the first one.</div>
      : <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">{shots.map((shot) => <ShotRow key={shot.id} shot={shot} onChanged={(next) => setShots((current) => current.map((row) => row.id === next.id ? next : row))} onEdit={() => setShotModal({ shot })} onDelete={() => void deleteShot(shot)} />)}</div>}
    {shotModal && <ShotFormModal videoProjectId={project.id} brandBlock={brandBlock} motions={motions} motionsLoading={motionsLoading} initialShot={shotModal.shot} onClose={() => setShotModal(null)} onSaved={(shot) => { setShots((current) => shotModal.shot ? current.map((row) => row.id === shot.id ? shot : row) : [...current, shot].sort((a, b) => a.shot_number - b.shot_number)); setShotModal(null); }} />}
  </div>;
}

function NewProjectModal({ clientId, organicRows, adsRows, brandBlocks, prefill, onClose, onCreated }: {
  clientId: string;
  organicRows: OrganicMasterRow[];
  adsRows: AdsMasterRow[];
  brandBlocks: BrandPromptBlockRow[];
  prefill: { table: "organic_master" | "ads_master"; rowId: string } | null;
  onClose: () => void;
  onCreated: (project: VideoProjectRow) => void;
}) {
  const [sourceTable, setSourceTable] = useState<"organic_master" | "ads_master">(prefill?.table ?? "organic_master");
  const [sourceRowId, setSourceRowId] = useState(prefill?.rowId ?? "");
  const [title, setTitle] = useState("");
  const [archetype, setArchetype] = useState<VideoArchetype>("A1");
  const [awarenessStage, setAwarenessStage] = useState<AwarenessStage>("unaware");
  const [targetDurationSec, setTargetDurationSec] = useState(28);
  const [brandPromptBlockId, setBrandPromptBlockId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = sourceTable === "organic_master" ? organicRows : adsRows;
  const brandDnaBlocks = brandBlocks.filter((block) => block.block_type === "brand_dna");

  async function save() {
    if (!sourceRowId) { setError("Choose a source content row."); return; }
    if (!title.trim()) { setError("Title is required."); return; }
    setBusy(true); setError(null);
    try {
      const project = await createVideoProject({
        clientId, sourceTable, sourceRowId, title: title.trim(), archetype, awarenessStage,
        targetDurationSec, brandPromptBlockId: brandPromptBlockId || undefined,
      });
      onCreated(project);
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={onClose}>
    <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="flex shrink-0 items-center justify-between border-b border-line px-5 py-4"><h2 className="text-sm font-medium text-paper">New Reel Studio Project</h2><button className="text-paper-3 hover:text-paper" onClick={onClose}>✕</button></header>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
        <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Source</label><div className="flex gap-2"><select value={sourceTable} onChange={(event) => { setSourceTable(event.target.value as "organic_master" | "ads_master"); setSourceRowId(""); }} className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper"><option value="organic_master">Organic</option><option value="ads_master">Ads</option></select><select value={sourceRowId} onChange={(event) => setSourceRowId(event.target.value)} className="min-w-0 flex-1 rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper"><option value="">Choose content row…</option>{options.map((row) => <option key={row.id} value={row.id}>{row.ref}</option>)}</select></div></div>
        <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Title</label><input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper outline-none focus:border-teal/50" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Archetype</label><select value={archetype} onChange={(event) => setArchetype(event.target.value as VideoArchetype)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper">{ARCHETYPES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Awareness stage</label><select value={awarenessStage} onChange={(event) => setAwarenessStage(event.target.value as AwarenessStage)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper">{AWARENESS_STAGES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
        </div>
        <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Target duration (22–34s)</label><input type="number" min={22} max={34} value={targetDurationSec} onChange={(event) => setTargetDurationSec(Number(event.target.value))} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper outline-none focus:border-teal/50" /></div>
        <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Brand prompt block</label><select value={brandPromptBlockId} onChange={(event) => setBrandPromptBlockId(event.target.value)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper"><option value="">Default (active Brand DNA)</option>{brandDnaBlocks.map((block) => <option key={block.id} value={block.id}>{block.name} v{block.version}{block.is_active ? " (active)" : ""}</option>)}</select></div>
        {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3"><Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" disabled={busy} onClick={() => void save()}>{busy ? "Creating…" : "Create project"}</Button></div>
    </div>
  </div>;
}

export function ReelStudioPanel({ clientId }: { clientId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<VideoProjectRow[]>([]);
  const [shotsByProject, setShotsByProject] = useState<VideoShotRow[]>([]);
  const [organicRows, setOrganicRows] = useState<OrganicMasterRow[]>([]);
  const [adsRows, setAdsRows] = useState<AdsMasterRow[]>([]);
  const [brandBlocks, setBrandBlocks] = useState<BrandPromptBlockRow[]>([]);
  const [motions, setMotions] = useState<HiggsfieldMotion[]>([]);
  const [motionsLoading, setMotionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [projectRows, organic, ads, blocks] = await Promise.all([
        fetchVideoProjects(clientId), fetchOrganicMasterRowsForClient(clientId), fetchAdsMasterRowsForClient(clientId), fetchBrandPromptBlocks(),
      ]);
      setProjects(projectRows); setOrganicRows(organic); setAdsRows(ads); setBrandBlocks(blocks);
      setShotsByProject(await fetchVideoShotsForProjects(projectRows.map((row) => row.id)));
    } catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    void fetchHiggsfieldMotions().then((value) => { setMotionsLoading(false); setMotions(value); }).catch(() => setMotionsLoading(false));
    setMotionsLoading(true);
  }, []);

  const prefillTable = searchParams.get("reel_source_table");
  const prefillRowId = searchParams.get("reel_source_row_id");
  useEffect(() => {
    if ((prefillTable === "organic_master" || prefillTable === "ads_master") && prefillRowId) {
      setNewProjectOpen(true);
    }
  }, [prefillTable, prefillRowId]);

  function clearPrefill() {
    const next = new URLSearchParams(searchParams);
    next.delete("reel_source_table"); next.delete("reel_source_row_id"); next.delete("reel_source_ref");
    setSearchParams(next, { replace: true });
  }

  const openProject = projects.find((project) => project.id === openProjectId) ?? null;

  if (loading && projects.length === 0) return <div className="p-6 text-xs text-paper-3">Loading Reel Studio projects…</div>;

  if (openProject) {
    return <ProjectDetail
      project={openProject} organicRows={organicRows} adsRows={adsRows} brandBlocks={brandBlocks}
      motions={motions} motionsLoading={motionsLoading}
      onBack={() => setOpenProjectId(null)}
      onProjectChanged={(next) => setProjects((current) => current.map((row) => row.id === next.id ? next : row))}
    />;
  }

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <div className="shrink-0 rounded-[10px] border border-line bg-ink-200 px-4 py-3"><div className="flex flex-wrap items-center gap-4 text-xs"><span className="text-paper">{projects.length} project{projects.length === 1 ? "" : "s"}</span><Button size="sm" variant="primary" className="ml-auto" onClick={() => setNewProjectOpen(true)}>New project</Button></div></div>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {projects.length === 0
      ? <div className="rounded-[10px] border border-dashed border-line p-10 text-center text-xs text-paper-3">No Reel Studio projects yet. Start one from an Organic or Ads content row, or create one directly here.</div>
      : <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">{projects.map((project) => {
        const shots = shotsByProject.filter((shot) => shot.video_project_id === project.id);
        const complete = shots.filter((shot) => shot.status === "complete").length;
        return <div key={project.id} className="min-w-0 border-b border-line px-4 py-3.5 last:border-b-0"><div className="flex flex-col gap-2 sm:flex-row sm:items-start"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-2xs font-mono text-teal">{sourceRefFor(project, organicRows, adsRows)}</span><StatusBadge status={project.status} /><span className="text-2xs font-mono text-paper-3">{project.archetype}</span><span className="text-2xs font-mono text-paper-3">{shots.length ? `${complete}/${shots.length} shots complete` : "no shots yet"}</span></div><h3 className="mt-1.5 break-words text-xs font-medium leading-5 text-paper">{project.title}</h3></div><div className="flex shrink-0 gap-2"><Button size="sm" variant="ghost" onClick={() => setOpenProjectId(project.id)}>Open</Button></div></div></div>;
      })}</div>}
    {newProjectOpen && <NewProjectModal
      clientId={clientId} organicRows={organicRows} adsRows={adsRows} brandBlocks={brandBlocks}
      prefill={(prefillTable === "organic_master" || prefillTable === "ads_master") && prefillRowId ? { table: prefillTable, rowId: prefillRowId } : null}
      onClose={() => { setNewProjectOpen(false); clearPrefill(); }}
      onCreated={(project) => { setProjects((current) => [project, ...current]); setNewProjectOpen(false); clearPrefill(); setOpenProjectId(project.id); }}
    />}
  </div>;
}
