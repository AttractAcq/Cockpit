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
  generateVideoStoryboard,
  getVideoShotSignedUrls,
  handoffVideoProject,
  createReelDistributionDraft,
  fetchDistributionRecordsForVideoProject,
  fetchFinalReelDeliverables,
  fetchMasterRowById,
  fetchReelVideoBriefsForSource,
  getFinalReelSignedUrl,
  reviewFinalReel,
  uploadFinalReel,
  regenerateVideoShot,
  retryShotStillImage,
  retryShotVideo,
  updateVideoProjectStatus,
  updateVideoShot,
} from "@/lib/api";
import {
  classifyReelShotFailure,
  reelShotRecoveryPlan,
} from "../../../supabase/functions/_shared/reel-studio-recovery";
import {
  resolveReelSourceEligibility,
  type ReelSourceEligibility,
} from "../../../supabase/functions/_shared/reel-studio-eligibility";
import {
  reelSpecWarnings,
  summariseShotPackage,
} from "../../../supabase/functions/_shared/final-reel-contract";
import type { AdsMasterRow, DistributionRecordRow, OrganicMasterRow, ProductionBriefRow } from "@/types/phase";
import type {
  AwarenessStage,
  BrandPromptBlockRow,
  HiggsfieldMotion,
  HumanPresence,
  ReelContinuityPlan,
  ReelStoryStrategy,
  RenderTier,
  ShotClass,
  VideoArchetype,
  VideoProjectDeliverableRow,
  VideoProjectRow,
  VideoProjectStatus,
  VideoShotRow,
} from "@/types/reel-studio";
import { REEL_STORY_ROLE_LABELS } from "@/types/reel-studio";
import { ReelProductionPanel } from "@/components/client/ReelProductionPanel";

/**
 * The story spine, shown above the shot list so a disjointed sequence is
 * obvious before any image is generated. Read-only: the spine is system-
 * generated authority, and editing it here would silently desynchronise it from
 * the shots it produced.
 */
function StoryboardSummary({
  strategy,
  continuity,
  shots,
}: {
  strategy: ReelStoryStrategy;
  continuity: ReelContinuityPlan | null;
  shots: VideoShotRow[];
}) {
  const [open, setOpen] = useState(true);
  const roles = shots.map((shot) => shot.story_role).filter(Boolean) as Array<keyof typeof REEL_STORY_ROLE_LABELS>;

  return <div className="shrink-0 rounded-[10px] border border-teal/20 bg-teal/5 px-4 py-3">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-2xs uppercase tracking-wide text-teal">Story</p>
        <p className="mt-1 text-xs leading-5 text-paper">{strategy.core_message}</p>
      </div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>{open ? "Hide detail" : "Show detail"}</Button>
    </div>
    {roles.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-1">
      {roles.map((role, index) => <span key={`${role}-${index}`} className="flex items-center gap-1">
        <span className="rounded border border-teal/30 bg-ink px-1.5 py-0.5 text-2xs text-teal">{REEL_STORY_ROLE_LABELS[role]}</span>
        {index < roles.length - 1 && <span className="text-2xs text-paper-3">→</span>}
      </span>)}
    </div>}
    {open && <dl className="mt-3 grid gap-x-6 gap-y-2 text-2xs leading-5 sm:grid-cols-2">
      <div><dt className="text-paper-3">Viewer</dt><dd className="text-paper">{strategy.viewer}</dd></div>
      <div><dt className="text-paper-3">Objective</dt><dd className="text-paper">{strategy.objective}</dd></div>
      <div><dt className="text-paper-3">Hook strategy</dt><dd className="text-paper">{strategy.hook_strategy}</dd></div>
      <div><dt className="text-paper-3">Central tension</dt><dd className="text-paper">{strategy.central_tension}</dd></div>
      <div><dt className="text-paper-3">Proof or payoff</dt><dd className="text-paper">{strategy.proof_or_payoff}</dd></div>
      <div><dt className="text-paper-3">Recurring motif</dt><dd className="text-paper">{strategy.recurring_visual_motif}</dd></div>
      <div><dt className="text-paper-3">Opening image</dt><dd className="text-paper">{strategy.opening_image_purpose}</dd></div>
      <div><dt className="text-paper-3">Ending image</dt><dd className="text-paper">{strategy.ending_image_purpose}</dd></div>
      <div><dt className="text-paper-3">Emotional progression</dt><dd className="text-paper">{strategy.emotional_progression.join(" → ")}</dd></div>
      <div><dt className="text-paper-3">Visual progression</dt><dd className="text-paper">{strategy.visual_progression.join(" → ")}</dd></div>
      <div className="sm:col-span-2"><dt className="text-paper-3">Final takeaway</dt><dd className="text-paper">{strategy.cta_or_final_takeaway}</dd></div>
      {strategy.continuity_rules.length > 0 && <div className="sm:col-span-2">
        <dt className="text-paper-3">Continuity rules</dt>
        <dd className="text-paper"><ul className="list-disc pl-4">{strategy.continuity_rules.map((rule, i) => <li key={i}>{rule}</li>)}</ul></dd>
      </div>}
      {continuity && <div className="sm:col-span-2">
        <dt className="text-paper-3">Visual world</dt>
        <dd className="text-paper">{continuity.visual_world} · {continuity.palette_bible} · {continuity.lens_bible}</dd>
      </div>}
    </dl>}
  </div>;
}

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

  // Once a shot has moved past 'pending' (e.g. its still has already been
  // generated), the server only accepts motion-only edits -- storyboard
  // content is locked in to protect the still already generated from it.
  const isMotionOnlyEdit = initialShot !== null && initialShot.status !== "pending";

  async function save() {
    if (isMotionOnlyEdit) {
      if (!motionType) { setError("Choose a motion."); return; }
      setBusy(true); setError(null);
      try { onSaved(await updateVideoShot(initialShot!.id, { motionType, motionStrength })); }
      catch (value) { setError(errorText(value)); }
      finally { setBusy(false); }
      return;
    }
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
        {isMotionOnlyEdit && <p className="mb-3 text-2xs text-warn">This shot's still has already been generated — only the motion can be changed now.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Shot number</label><input disabled={isMotionOnlyEdit} type="number" min={1} value={shotNumber} onChange={(event) => setShotNumber(Number(event.target.value))} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper outline-none focus:border-teal/50 disabled:opacity-50" /></div>
            <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Beat description</label><textarea disabled={isMotionOnlyEdit} value={beatDescription} onChange={(event) => setBeatDescription(event.target.value)} className="min-h-20 w-full resize-y rounded border border-line bg-ink px-2 py-1.5 text-xs leading-5 text-paper outline-none focus:border-teal/50 disabled:opacity-50" /></div>
            <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Compiled prompt</label><textarea disabled={isMotionOnlyEdit} value={compiledPrompt} onChange={(event) => setCompiledPrompt(event.target.value)} className="min-h-28 w-full resize-y rounded border border-line bg-ink px-2 py-1.5 text-xs leading-5 text-paper outline-none focus:border-teal/50 disabled:opacity-50" /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Shot class</label><select disabled={isMotionOnlyEdit} value={shotClass} onChange={(event) => setShotClass(event.target.value as ShotClass)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper disabled:opacity-50"><option value="">Choose…</option>{SHOT_CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
              <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Human presence</label><select disabled={isMotionOnlyEdit} value={humanPresence} onChange={(event) => setHumanPresence(event.target.value as HumanPresence)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper disabled:opacity-50">{HUMAN_PRESENCE.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
              <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Render tier</label><select disabled={isMotionOnlyEdit} value={renderTier} onChange={(event) => setRenderTier(event.target.value as RenderTier)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper disabled:opacity-50">{RENDER_TIERS.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
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

function FailureDetail({ shot }: { shot: VideoShotRow }) {
  // Phase 2, Workstream C §6.7: name the phase that failed, show a safe provider
  // summary and the last attempt time. Never render credentials, signed URLs, or
  // raw provider payloads — `shot.error` is already the sanitised summary written
  // by safeHiggsfieldError().
  const classification = classifyReelShotFailure(shot);
  if (!classification.failed) return null;
  const attemptedAt = classification.phase === "video"
    ? shot.last_video_attempt_at ?? shot.failed_at
    : shot.last_still_attempt_at ?? shot.failed_at;
  const attempts = classification.phase === "video" ? shot.video_attempt_count : shot.still_attempt_count;
  return <div className="mt-2 rounded border border-neg/20 bg-neg/5 px-2.5 py-2 text-2xs leading-5 text-neg">
    <div className="font-medium">{classification.label}</div>
    {shot.error && <div className="mt-1 break-words text-neg/90">{shot.error}</div>}
    <div className="mt-1 text-paper-3">
      {attemptedAt ? `Last attempt ${new Date(attemptedAt).toLocaleString()}` : "Last attempt time not recorded"}
      {attempts > 0 ? ` · ${attempts} retr${attempts === 1 ? "y" : "ies"} so far` : ""}
      {classification.derived ? " · phase inferred from stored job data" : ""}
    </div>
  </div>;
}

/**
 * Video-retry confirmation. Motion is preserved by default; changing it here is
 * the deliberate action §6.3 requires (a failed shot is not motion-editable
 * through the normal edit path, so the change travels with the retry itself and
 * is applied by the same locked, concurrency-checked RPC).
 */
function VideoRetryModal({ shot, motions, motionsLoading, busy, onCancel, onConfirm }: {
  shot: VideoShotRow;
  motions: HiggsfieldMotion[];
  motionsLoading: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (motion: { motionType: string; motionStrength: number } | null) => void;
}) {
  const [changeMotion, setChangeMotion] = useState(false);
  const [motionType, setMotionType] = useState<string | null>(shot.motion_type);
  const [motionStrength, setMotionStrength] = useState(shot.motion_strength ?? 0.5);
  const currentName = motions.find((motion) => motion.id === shot.motion_type)?.name ?? shot.motion_type ?? "none";
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4" onClick={busy ? undefined : onCancel}>
    <div role="dialog" aria-modal="true" aria-label={`Retry video generation for shot ${shot.shot_number}`} className="w-full max-w-lg rounded-[12px] border border-line bg-ink-200 p-5" onClick={(event) => event.stopPropagation()}>
      <h3 className="text-sm font-medium text-paper">Retry video generation — shot {shot.shot_number}?</h3>
      <div className="mt-3 grid gap-1.5 rounded border border-line bg-ink p-3 text-2xs leading-5 text-paper-3">
        <div><span className="text-teal">Preserved:</span> the rendered still image, the shot's planning text and prompt.</div>
        <div><span className="text-warn">Replaced:</span> only the failed video job. The still is not regenerated.</div>
        <div>Current motion: <span className="font-mono text-paper">{currentName}</span>{shot.motion_strength !== null ? ` · strength ${shot.motion_strength}` : ""}</div>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-paper-2"><input type="checkbox" className="accent-teal" checked={changeMotion} onChange={(event) => setChangeMotion(event.target.checked)} />Change the motion before retrying</label>
      {changeMotion && <div className="mt-3 space-y-2">
        <MotionPicker motions={motions} value={motionType} onChange={setMotionType} loading={motionsLoading} />
        {motionType && <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Motion strength ({motionStrength.toFixed(2)})</label><input type="range" min={0} max={1} step={0.05} value={motionStrength} onChange={(event) => setMotionStrength(Number(event.target.value))} className="w-full accent-teal" /></div>}
      </div>}
      <div className="mt-5 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" disabled={busy || (changeMotion && !motionType)} onClick={() => onConfirm(changeMotion && motionType ? { motionType, motionStrength } : null)}>{busy ? "Resetting…" : "Retry video generation"}</Button>
      </div>
    </div>
  </div>;
}

function ShotRow({ shot, planningAllowed, motions, motionsLoading, onChanged, onEdit, onRegenerate, onRetryStill, onRetryVideo, onDelete }: {
  shot: VideoShotRow;
  planningAllowed: boolean;
  motions: HiggsfieldMotion[];
  motionsLoading: boolean;
  onChanged: (shot: VideoShotRow) => void;
  onEdit: () => void;
  onRegenerate: () => Promise<VideoShotRow>;
  onRetryStill: () => Promise<{ shot: VideoShotRow; message: string; preserved: string | null }>;
  onRetryVideo: (motion: { motionType: string; motionStrength: number } | null) => Promise<{ shot: VideoShotRow; message: string; preserved: string | null }>;
  onDelete: () => void;
}) {
  const [retryVideoOpen, setRetryVideoOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showError, setShowError] = useState(false);
  const [urls, setUrls] = useState<{ stillUrl: string | null; clipUrl: string | null }>({ stillUrl: null, clipUrl: null });

  useEffect(() => {
    let active = true;
    void getVideoShotSignedUrls(shot).then((value) => { if (active) setUrls(value); }).catch(() => { if (active) setUrls({ stillUrl: null, clipUrl: null }); });
    return () => { active = false; };
  }, [shot.still_image_url, shot.clip_url]);

  async function run(action: string, fn: () => Promise<VideoShotRow>) {
    setBusy(action); setError(null); setNotice(null);
    try { onChanged(await fn()); }
    catch (value) { setError(errorText(value)); }
    finally { setBusy(null); }
  }

  async function runRecovery(action: string, fn: () => Promise<{ shot: VideoShotRow; message: string; preserved: string | null }>) {
    setBusy(action); setError(null); setNotice(null);
    try {
      const result = await fn();
      onChanged(result.shot);
      setNotice(result.message);
      setShowError(false);
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(null); }
  }

  function confirmRegeneration() {
    if (!window.confirm(`Regenerate shot ${shot.shot_number}? This replaces only this shot's planning text and visual prompt. No image will be generated.`)) return;
    void run("regenerate", onRegenerate);
  }

  function confirmRetryStill() {
    if (!window.confirm(`Retry image generation for shot ${shot.shot_number}?\n\nKeeps: the shot's planning text and latest saved prompt.\nReplaces: only the failed image job. No video or clip is affected.`)) return;
    void runRecovery("retry-still", onRetryStill);
  }

  async function confirmRetryVideo(motion: { motionType: string; motionStrength: number } | null) {
    await runRecovery("retry-video", () => onRetryVideo(motion));
    setRetryVideoOpen(false);
  }

  // The shot's state machine drives exactly which actions are offered. Provider
  // recovery ("Retry …") is deliberately distinct from planning regeneration
  // ("Regenerate shot"), which only ever applies before an image exists.
  const recovery = reelShotRecoveryPlan(shot, planningAllowed);
  const failure = classifyReelShotFailure(shot);
  const isPending = shot.status === "pending";
  const stillComplete = shot.status === "still_complete";

  return <div className="border-b border-line px-4 py-3.5 last:border-b-0">
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><span className="text-2xs font-mono text-teal">Shot {shot.shot_number}</span>{shot.story_role && <span className="rounded border border-teal/30 bg-teal/10 px-1.5 py-0.5 text-2xs text-teal">{REEL_STORY_ROLE_LABELS[shot.story_role]}</span>}<ShotStatusBadge status={shot.status} />{failure.failed && <span className="rounded border border-neg/20 bg-neg/10 px-1.5 py-0.5 text-2xs text-neg">{failure.phase === "video" ? "video stage" : "image stage"}</span>}<span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">{shot.shot_class}</span><span className="text-2xs font-mono text-paper-3">{shot.human_presence}</span><span className="text-2xs font-mono text-paper-3">{shot.render_tier}</span></div>
        <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-paper">{shot.beat_description}</p>
        {shot.message_supported && <p className="mt-1 text-2xs leading-4 text-paper-3"><span className="text-paper-3">Carries:</span> <span className="text-paper">{shot.message_supported}</span></p>}
        {(shot.transition_from_previous || shot.transition_to_next) && <p className="mt-0.5 text-2xs leading-4 text-paper-3">
          {shot.transition_from_previous && <><span>From previous:</span> <span className="text-paper">{shot.transition_from_previous}</span></>}
          {shot.transition_from_previous && shot.transition_to_next && <span className="px-1">·</span>}
          {shot.transition_to_next && <><span>Sets up:</span> <span className="text-paper">{shot.transition_to_next}</span></>}
        </p>}
        {urls.stillUrl && <a href={urls.stillUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-2xs text-teal underline">View still</a>}
        {urls.clipUrl && <a href={urls.clipUrl} target="_blank" rel="noreferrer" className="ml-3 inline-block text-2xs text-teal underline">View clip</a>}
        {failure.failed && showError && <FailureDetail shot={shot} />}
        {failure.failed && showError && recovery.retryPreserves && <p className="mt-1 text-2xs leading-4 text-paper-3">{recovery.retryPreserves}</p>}
        {failure.failed && showError && !recovery.canRetryStill && !recovery.canRetryVideo && recovery.blockedReason &&
          <p className="mt-1 text-2xs leading-4 text-warn">Retry is not permitted: {recovery.blockedReason}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {(isPending || stillComplete) && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onEdit}>{stillComplete ? "Edit motion" : "Edit"}</Button>}
        {isPending && planningAllowed && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={confirmRegeneration}>{busy === "regenerate" ? "Regenerating…" : "Regenerate shot"}</Button>}
        {isPending && <Button size="sm" variant="danger" disabled={busy !== null} onClick={onDelete}>Delete shot</Button>}
        {isPending && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run("still", () => generateShotStill(shot.id))}>{busy === "still" ? "Submitting…" : "Generate image"}</Button>}
        {recovery.canCheckStill && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run("check-still", () => checkShotStill(shot.id))}>{busy === "check-still" ? "Checking…" : "Check still"}</Button>}
        {stillComplete && (shot.motion_type
          ? <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run("video", () => generateShotVideo(shot.id))}>{busy === "video" ? "Submitting…" : "Generate video"}</Button>
          : <span className="text-2xs text-warn">Edit motion before generating video.</span>)}
        {recovery.canCheckVideo && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run("check-video", () => checkShotVideo(shot.id))}>{busy === "check-video" ? "Checking…" : "Check video"}</Button>}
        {failure.failed && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setShowError((value) => !value)}>{showError ? "Hide error" : "View error"}</Button>}
        {recovery.canRetryStill && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={confirmRetryStill}>{busy === "retry-still" ? "Resetting…" : "Retry image generation"}</Button>}
        {recovery.canRetryVideo && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => setRetryVideoOpen(true)}>{busy === "retry-video" ? "Resetting…" : "Retry video generation"}</Button>}
      </div>
    </div>
    {retryVideoOpen && <VideoRetryModal shot={shot} motions={motions} motionsLoading={motionsLoading} busy={busy === "retry-video"} onCancel={() => setRetryVideoOpen(false)} onConfirm={(motion) => void confirmRetryVideo(motion)} />}
    {notice && <div role="status" className="mt-2 rounded border border-teal/20 bg-teal/5 px-2 py-1.5 text-2xs text-teal">{notice}</div>}
    {error && <div role="alert" className="mt-2 rounded border border-neg/20 bg-neg/5 px-2 py-1.5 text-2xs text-neg">{error}</div>}
  </div>;
}


// ── Phase 3: the final edited Reel ─────────────────────────────────────────
//
// PRODUCTION BOUNDARY. Cockpit generates and manages the individual shot clips.
// An external editor combines them with voiceover, captions, on-screen text,
// music, sound design, transitions and final colour/timing. Cockpit receives the
// finished MP4 and owns versioning, review, approval, distribution and
// publishing. Cockpit never assembles, trims or renders video.

const DELIVERABLE_STATUS_STYLE: Record<string, string> = {
  needs_review: "border-warn/20 bg-warn/10 text-warn",
  approved: "border-teal/20 bg-teal/10 text-teal",
  rejected: "border-neg/20 bg-neg/10 text-neg",
  archived: "border-line bg-ink text-paper-3",
};

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "unknown";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

function FinalReelPlayer({ deliverable }: { deliverable: VideoProjectDeliverableRow }) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(() => {
    let active = true;
    setState("loading");
    void getFinalReelSignedUrl(deliverable)
      .then((value) => { if (!active) return; setUrl(value); setState(value ? "ready" : "error"); })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [deliverable.storage_bucket, deliverable.storage_path]);
  useEffect(() => load(), [load]);

  if (state === "loading") return <div className="flex aspect-[9/16] w-full max-w-[260px] items-center justify-center rounded-lg border border-line bg-black/30 text-2xs text-paper-3">Loading final Reel…</div>;
  if (state === "error" || !url) {
    return <div className="flex aspect-[9/16] w-full max-w-[260px] flex-col items-center justify-center gap-2 rounded-lg border border-line bg-black/30 px-3 text-center text-2xs text-neg">
      <span>The final Reel could not be loaded. Its private link may have expired.</span>
      <button className="text-teal hover:underline" onClick={() => load()}>Reload preview</button>
    </div>;
  }
  return <div className="w-full max-w-[260px]">
    <video src={url} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-lg border border-line bg-black object-contain" />
    <a href={url} target="_blank" rel="noreferrer" className="mt-1.5 inline-block text-2xs text-teal underline">Open full video ↗</a>
    <a href={url} download={`${deliverable.original_filename ?? `final-reel-v${deliverable.version}.mp4`}`} className="ml-3 inline-block text-2xs text-teal underline">Download original MP4</a>
  </div>;
}

function ShotPackagePanel({ shots }: { shots: VideoShotRow[] }) {
  const summary = summariseShotPackage(shots.map((shot) => ({
    shot_number: shot.shot_number,
    status: shot.status,
    clip_url: shot.clip_url,
    approved: shot.approved_at !== null,
    is_current: true,
  })));
  return <div className="rounded-[10px] border border-line bg-ink px-4 py-3">
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="text-xs font-medium text-paper">Production package for the external editor</h4>
      <span className={`rounded border px-1.5 py-0.5 text-2xs ${summary.allClipsPresent ? "border-teal/20 bg-teal/10 text-teal" : "border-warn/20 bg-warn/10 text-warn"}`}>
        {summary.renderedClips}/{summary.totalShots} clips rendered
      </span>
    </div>
    <p className="mt-1.5 text-2xs leading-5 text-paper-3">
      Cockpit produces the shot clips. An external editor combines them with voiceover, captions, on-screen text, music, transitions and final grading, then the finished MP4 is uploaded back here. Cockpit does not assemble or edit video.
    </p>
    {!summary.allClipsPresent && summary.missingShotNumbers.length > 0 &&
      <p className="mt-1.5 text-2xs text-warn">Shots not yet rendered: {summary.missingShotNumbers.join(", ")}. The package is incomplete.</p>}
    <p className="mt-1.5 text-2xs text-paper-3">Download the ordered clips from the Assets tab — the handed-off group lists each shot in clip order with its review status.</p>
  </div>;
}

function FinalReelUploadRow({ project, currentDeliverable, onUploaded }: {
  project: VideoProjectRow;
  currentDeliverable: VideoProjectDeliverableRow | null;
  onUploaded: (result: { deliverable: VideoProjectDeliverableRow; specWarnings: string[] }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    // Replacing an approved version is deliberate, never silent.
    let acknowledge = false;
    if (currentDeliverable?.status === "approved") {
      if (!window.confirm(`Version ${currentDeliverable.version} is already APPROVED.\n\nUploading a new version supersedes it. The approved version is preserved for history but is no longer publishable. Continue?`)) return;
      acknowledge = true;
    }
    setBusy(true);
    try {
      const result = await uploadFinalReel({
        clientId: project.client_id, videoProjectId: project.id, file,
        acknowledgeReplaceApproved: acknowledge,
      });
      onUploaded(result);
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(false); }
  }

  return <div>
    <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-teal/30 bg-teal/5 px-3 py-1.5 text-xs text-teal hover:bg-teal/10">
      <input type="file" accept="video/mp4,.mp4" className="hidden" disabled={busy}
        onChange={(event) => void pick(event.target.files?.[0])} />
      {busy ? "Uploading…" : currentDeliverable ? "Upload new final Reel version" : "Upload final Reel"}
    </label>
    <p className="mt-1.5 text-2xs text-paper-3">MP4 only, up to 200 MB. The upload path is generated by the server; previous versions are always preserved.</p>
    {error && <div role="alert" className="mt-2 rounded border border-neg/20 bg-neg/5 px-2.5 py-1.5 text-2xs text-neg">{error}</div>}
  </div>;
}

function FinalReelReviewControls({ project, deliverable, onReviewed }: {
  project: VideoProjectRow;
  deliverable: VideoProjectDeliverableRow;
  onReviewed: (next: VideoProjectDeliverableRow, message: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function run(action: "approve" | "request_revision", notes?: string) {
    setBusy(action); setError(null);
    try {
      const result = await reviewFinalReel({
        clientId: project.client_id, videoProjectId: project.id,
        deliverableId: deliverable.id, expectedUpdatedAt: deliverable.updated_at,
        action, feedback: notes,
      });
      onReviewed(result.deliverable, result.message);
      setRevisionOpen(false); setFeedback("");
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(null); }
  }

  return <div className="mt-3">
    <div className="flex flex-wrap gap-2">
      {deliverable.status !== "approved" && <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => {
        if (window.confirm("Approve this final Reel?\n\nApproval means it may be distributed and published. It does NOT publish anything, and it is a different decision from approving the shot clips.")) void run("approve");
      }}>{busy === "approve" ? "Approving…" : "Approve final Reel"}</Button>}
      <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => setRevisionOpen((value) => !value)}>Request final Reel revision</Button>
    </div>
    {revisionOpen && <div className="mt-2 rounded border border-line bg-ink p-3">
      <label className="block text-2xs uppercase text-paper-3">Revision notes for the editor</label>
      <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} rows={3}
        placeholder="Explain exactly what must change in the edit."
        className="mt-1 w-full rounded border border-line bg-ink-200 p-2 text-xs text-paper outline-none focus:border-teal" />
      <p className="mt-1 text-2xs text-paper-3">The uploaded version and its file are preserved for history. It cannot be scheduled until a new version is uploaded and approved.</p>
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setRevisionOpen(false)}>Cancel</Button>
        <Button size="sm" variant="danger" disabled={busy !== null || feedback.trim().length < 8} onClick={() => void run("request_revision", feedback.trim())}>
          {busy === "request_revision" ? "Saving…" : "Request revision"}
        </Button>
      </div>
    </div>}
    {error && <div role="alert" className="mt-2 rounded border border-neg/20 bg-neg/5 px-2.5 py-1.5 text-2xs text-neg">{error}</div>}
  </div>;
}

function ReelPublicationStatus({ records }: { records: DistributionRecordRow[] }) {
  if (records.length === 0) return null;
  return <div className="mt-3 rounded border border-line bg-ink p-3">
    <div className="text-2xs uppercase text-paper-3">Distribution &amp; publication</div>
    <div className="mt-2 space-y-2">{records.map((record) => <div key={record.id} className="text-2xs leading-5 text-paper-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-teal">{record.source_ref}</span>
        <span className="rounded border border-line px-1.5 py-0.5 font-mono text-paper-2">{record.publish_status}</span>
        {record.container_status && <span className="rounded border border-line px-1.5 py-0.5 font-mono text-paper-3">container {record.container_status.toLowerCase().replaceAll("_", " ")}</span>}
        {record.destination && <span>→ {record.destination}</span>}
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3">
        {record.scheduled_publish_at && <span>scheduled {new Date(record.scheduled_publish_at).toLocaleString()}</span>}
        {record.published_at && <span className="text-teal">published {new Date(record.published_at).toLocaleString()}</span>}
        {record.external_post_id && <span className="font-mono">media {record.external_post_id}</span>}
        {typeof record.container_poll_count === "number" && record.container_poll_count > 0 && <span>{record.container_poll_count} status checks</span>}
        {record.published_url && <a href={record.published_url} target="_blank" rel="noreferrer" className="text-teal underline">view post ↗</a>}
      </div>
      {record.last_error && <div className="mt-1 text-neg">{record.last_error}</div>}
    </div>)}</div>
  </div>;
}

function FinalReelSection({ project, shots, onProjectChanged }: {
  project: VideoProjectRow;
  shots: VideoShotRow[];
  onProjectChanged: (project: VideoProjectRow) => void;
}) {
  const [deliverables, setDeliverables] = useState<VideoProjectDeliverableRow[]>([]);
  const [records, setRecords] = useState<DistributionRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draftBusy, setDraftBusy] = useState(false);
  const [caption, setCaption] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [rows, distribution] = await Promise.all([
        fetchFinalReelDeliverables(project.id),
        fetchDistributionRecordsForVideoProject(project.id),
      ]);
      setDeliverables(rows); setRecords(distribution);
    } catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [project.id]);
  useEffect(() => { void load(); }, [load]);

  // The CURRENT final Reel is the explicitly-flagged row — never the newest by
  // timestamp, never derived from a filename or storage listing.
  const current = deliverables.find((row) => row.is_current) ?? null;
  const history = deliverables.filter((row) => !row.is_current);
  const handedOff = project.status === "handed_off";
  const hasDraft = records.some((record) => record.publish_status !== "cancelled");

  async function createDraft() {
    if (!current) return;
    setDraftBusy(true); setError(null); setNotice(null);
    try {
      const result = await createReelDistributionDraft({
        clientId: project.client_id, videoProjectId: project.id, caption: caption.trim(),
      });
      setNotice(result.message);
      setRecords((rows) => [result.record, ...rows.filter((row) => row.id !== result.record.id)]);
    } catch (value) { setError(errorText(value)); }
    finally { setDraftBusy(false); }
  }

  return <div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-medium text-paper">Final Reel</h3>
      {current && <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${DELIVERABLE_STATUS_STYLE[current.status] ?? "border-line text-paper-3"}`}>{current.status.replaceAll("_", " ")}</span>}
      {current && <span className="rounded border border-line px-1.5 py-0.5 font-mono text-2xs text-paper-3">v{current.version} · current</span>}
    </div>

    {!handedOff && <p className="mt-2 rounded border border-warn/20 bg-warn/5 px-3 py-2 text-2xs leading-5 text-warn">
      The shot clips must be handed off to Assets before a final Reel can be uploaded. This project is currently <span className="font-mono">{project.status.replaceAll("_", " ")}</span>.
    </p>}

    <div className="mt-3"><ShotPackagePanel shots={shots} /></div>

    {error && <div role="alert" className="mt-3 rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {notice && <div role="status" className="mt-3 rounded border border-teal/20 bg-teal/5 px-3 py-2 text-xs text-teal">{notice}</div>}
    {warnings.length > 0 && <div className="mt-3 rounded border border-warn/20 bg-warn/5 px-3 py-2 text-2xs leading-5 text-warn">
      <div className="font-medium">Instagram compatibility warnings (advisory — from browser-read metadata):</div>
      <ul className="mt-1 list-disc pl-4">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
    </div>}

    {loading ? <div className="mt-3 text-xs text-paper-3">Loading final Reel…</div> : <>
      {handedOff && <div className="mt-3"><FinalReelUploadRow project={project} currentDeliverable={current} onUploaded={(result) => {
        setWarnings(result.specWarnings);
        setNotice(`Final Reel v${result.deliverable.version} uploaded and is awaiting review.`);
        onProjectChanged({ ...project, current_deliverable_id: result.deliverable.id });
        void load();
      }} /></div>}

      {!current ? <div className="mt-3 rounded border border-dashed border-line px-4 py-6 text-center text-xs text-paper-3">
        No final Reel has been uploaded yet. Send the shot package to the editor, then upload the finished MP4 here.
      </div> : <div className="mt-3 grid gap-4 md:grid-cols-[auto_1fr]">
        <FinalReelPlayer deliverable={current} />
        <div className="min-w-0">
          <dl className="grid gap-x-4 gap-y-1.5 text-2xs sm:grid-cols-2">
            <div><dt className="text-paper-3">Version</dt><dd className="text-paper">v{current.version} (current)</dd></div>
            <div><dt className="text-paper-3">Uploaded</dt><dd className="text-paper">{current.upload_completed_at ? new Date(current.upload_completed_at).toLocaleString() : "—"}</dd></div>
            <div><dt className="text-paper-3">File</dt><dd className="text-paper">{formatBytes(current.file_size_bytes)} · {current.mime_type}</dd></div>
            <div><dt className="text-paper-3">Dimensions</dt><dd className="text-paper">{current.width && current.height ? `${current.width}×${current.height}` : "unknown"}</dd></div>
            <div><dt className="text-paper-3">Duration</dt><dd className="text-paper">{formatDuration(current.duration_sec)}</dd></div>
            <div><dt className="text-paper-3">Metadata source</dt><dd className="text-paper">{current.media_metadata_source.replaceAll("_", " ")}</dd></div>
            <div><dt className="text-paper-3">Review status</dt><dd className="text-paper">{current.status.replaceAll("_", " ")}</dd></div>
            <div><dt className="text-paper-3">Reviewed</dt><dd className="text-paper">{current.reviewed_at ? new Date(current.reviewed_at).toLocaleString() : "not reviewed"}</dd></div>
          </dl>
          {current.review_feedback && <div className="mt-2 rounded border border-neg/20 bg-neg/5 px-2.5 py-1.5 text-2xs leading-5 text-neg">
            <span className="font-medium">Revision requested:</span> {current.review_feedback}
          </div>}
          {reelSpecWarnings(current).length > 0 && <ul className="mt-2 list-disc pl-4 text-2xs text-warn">
            {reelSpecWarnings(current).map((warning) => <li key={warning}>{warning}</li>)}
          </ul>}
          <FinalReelReviewControls project={project} deliverable={current} onReviewed={(next, message) => {
            setDeliverables((rows) => rows.map((row) => row.id === next.id ? next : row));
            setNotice(message);
          }} />

          {current.status === "approved" && <div className="mt-4 rounded border border-teal/20 bg-teal/5 p-3">
            <div className="text-2xs uppercase text-teal">Distribution</div>
            {hasDraft ? <p className="mt-1 text-2xs leading-5 text-paper-2">A distribution draft already exists for this final Reel. Open the Distribution tab to schedule it.</p> : <>
              <label className="mt-2 block text-2xs uppercase text-paper-3">Caption</label>
              <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={3} maxLength={2200}
                placeholder="Instagram caption for this Reel."
                className="mt-1 w-full rounded border border-line bg-ink p-2 text-xs text-paper outline-none focus:border-teal" />
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="primary" disabled={draftBusy} onClick={() => void createDraft()}>{draftBusy ? "Creating…" : "Create distribution draft"}</Button>
                <span className="text-2xs text-paper-3">Creates a draft only. Scheduling and publishing happen in Distribution.</span>
              </div>
            </>}
          </div>}
        </div>
      </div>}

      <ReelPublicationStatus records={records} />

      {history.length > 0 && <div className="mt-4">
        <div className="text-2xs uppercase text-paper-3">Previous versions ({history.length}) — preserved, not publishable</div>
        <div className="mt-1.5 space-y-1">{history.map((row) => <div key={row.id} className="flex flex-wrap items-center gap-2 rounded border border-line bg-ink px-2.5 py-1.5 text-2xs text-paper-3">
          <span className="font-mono text-paper-2">v{row.version}</span>
          <span className={`rounded border px-1.5 py-0.5 font-mono ${DELIVERABLE_STATUS_STYLE[row.status] ?? "border-line"}`}>{row.status.replaceAll("_", " ")}</span>
          <span>{formatBytes(row.file_size_bytes)}</span>
          <span>{row.upload_completed_at ? new Date(row.upload_completed_at).toLocaleDateString() : "—"}</span>
          {row.review_feedback && <span className="min-w-0 flex-1 truncate text-neg" title={row.review_feedback}>{row.review_feedback}</span>}
          <span className="ml-auto">superseded</span>
        </div>)}</div>
      </div>}
    </>}
  </div>;
}

function ProjectDetail({ project, organicRows, adsRows, brandBlocks, motions, motionsLoading, motionsError, onBack, onProjectChanged, onShotsChanged }: {
  project: VideoProjectRow;
  organicRows: OrganicMasterRow[];
  adsRows: AdsMasterRow[];
  brandBlocks: BrandPromptBlockRow[];
  motions: HiggsfieldMotion[];
  motionsLoading: boolean;
  motionsError: string | null;
  onBack: () => void;
  onProjectChanged: (project: VideoProjectRow) => void;
  onShotsChanged: (projectId: string, shots: VideoShotRow[]) => void;
}) {
  const [shots, setShots] = useState<VideoShotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [shotModal, setShotModal] = useState<{ shot: VideoShotRow | null } | null>(null);
  const [handoffInfo, setHandoffInfo] = useState<string | null>(null);
  const [storyboardBusy, setStoryboardBusy] = useState(false);
  const [spine, setSpine] = useState<{
    strategy: ReelStoryStrategy | null;
    continuity: ReelContinuityPlan | null;
  }>({ strategy: project.story_strategy ?? null, continuity: project.continuity_plan ?? null });

  const applyShots = useCallback((next: VideoShotRow[]) => {
    const ordered = [...next].sort((a, b) => a.shot_number - b.shot_number);
    setShots(ordered);
    onShotsChanged(project.id, ordered);
  }, [onShotsChanged, project.id]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { applyShots(await fetchVideoShots(project.id)); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [applyShots, project.id]);
  useEffect(() => { void load(); }, [load]);

  function replaceShot(next: VideoShotRow) {
    applyShots(shots.map((row) => row.id === next.id ? next : row));
  }

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

  async function generateStoryboard() {
    if (!window.confirm("Generate a full AI storyboard for this project's linked content brief?")) return;
    setStoryboardBusy(true); setError(null);
    try {
      const result = await generateVideoStoryboard(project.client_id, project.id);
      applyShots(result.shots);
      // The spine is persisted on the project, but the project row in memory
      // predates this call — show the freshly returned plan rather than a stale
      // null until the panel is next reloaded.
      setSpine({ strategy: result.strategy, continuity: result.continuity });
    }
    catch (value) { setError(errorText(value)); }
    finally { setStoryboardBusy(false); }
  }

  async function deleteShot(shot: VideoShotRow) {
    if (!window.confirm(`Delete shot ${shot.shot_number}? This removes only this pending shot.`)) return;
    setError(null);
    try {
      await deleteVideoShot({
        clientId: project.client_id,
        videoProjectId: project.id,
        shotId: shot.id,
      });
      await load();
    }
    catch (value) { setError(errorText(value)); }
  }

  const brandBlock = brandBlocks.find((block) => block.id === project.brand_prompt_block_id) ?? null;
  const complete = shots.filter((shot) => shot.status === "complete").length;
  const canPlan = project.status === "storyboarding" || project.status === "generating";

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
    {motionsError && <div role="alert" className="rounded border border-warn/20 bg-warn/5 px-3 py-2 text-xs text-warn">Motion catalogue unavailable: {motionsError}. Storyboard planning and image generation are unaffected; motion must load before video generation.</div>}
    {handoffInfo && <div role="status" className="rounded border border-teal/20 bg-teal/5 px-3 py-2 text-xs text-teal">{handoffInfo}</div>}
    {project.avatar_release_id && <div className="rounded border border-teal/20 bg-teal/5 px-3 py-2 text-2xs leading-5 text-teal">
      Avatar OS references attached · release {project.avatar_release_id.slice(0, 8)} · {(project.avatar_asset_ids ?? []).length} approved asset reference{(project.avatar_asset_ids ?? []).length === 1 ? "" : "s"} available to storyboard and image prompts.
    </div>}
    {spine.strategy && <StoryboardSummary strategy={spine.strategy} continuity={spine.continuity} shots={shots} />}
    <ReelProductionPanel
      clientId={project.client_id}
      videoProjectId={project.id}
      productionStrategy={project.production_strategy ?? null}
      onStrategySelected={(strategy) => onProjectChanged({ ...project, production_strategy: strategy })}
    />
    <div className="flex shrink-0 gap-2">
      {canPlan && <Button size="sm" variant="primary" onClick={() => setShotModal({ shot: null })}>Add shot</Button>}
      {canPlan && shots.length === 0 && (project.organic_master_id || project.ads_master_id) &&
        <Button size="sm" variant="secondary" disabled={storyboardBusy} onClick={() => void generateStoryboard()}>{storyboardBusy ? "Generating storyboard…" : "Generate full storyboard"}</Button>}
    </div>
    {shots.some((shot) => shot.status === "pending") && <div className="rounded border border-line bg-ink px-3 py-2 text-2xs leading-5 text-paper-3">Pending shots are still planning records: edit their structure, regenerate one shot, delete one shot, or generate its image. Generating an image locks that shot's structural fields; motion remains selectable after the still completes.</div>}
    {shots.some((shot) => shot.status === "failed") && <div className="rounded border border-warn/20 bg-warn/5 px-3 py-2 text-2xs leading-5 text-warn">
      Four different actions exist and they are not interchangeable — <span className="text-paper">Check still / Check video</span> polls the same provider job, <span className="text-paper">Retry image generation</span> starts one new image job after an image-stage failure, <span className="text-paper">Retry video generation</span> starts one new video job and keeps the existing still, and <span className="text-paper">Regenerate shot</span> only rewrites planning text before any image exists.
    </div>}
    {loading ? <div className="p-6 text-xs text-paper-3">Loading shots…</div>
      : shots.length === 0 ? <div className="rounded-[10px] border border-dashed border-line p-10 text-center text-xs text-paper-3">No shots yet. Add the first one.</div>
      : <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">{shots.map((shot) => <ShotRow
        key={shot.id}
        shot={shot}
        planningAllowed={canPlan}
        motions={motions}
        motionsLoading={motionsLoading}
        onChanged={replaceShot}
        onEdit={() => setShotModal({ shot })}
        onRegenerate={() => regenerateVideoShot({
          clientId: project.client_id,
          videoProjectId: project.id,
          shotId: shot.id,
          expectedUpdatedAt: shot.updated_at,
        })}
        onRetryStill={() => retryShotStillImage({
          clientId: project.client_id,
          videoProjectId: project.id,
          shotId: shot.id,
          expectedUpdatedAt: shot.updated_at,
        })}
        onRetryVideo={(motion) => retryShotVideo({
          clientId: project.client_id,
          videoProjectId: project.id,
          shotId: shot.id,
          expectedUpdatedAt: shot.updated_at,
          motionType: motion?.motionType ?? null,
          motionStrength: motion?.motionStrength ?? null,
        })}
        onDelete={() => void deleteShot(shot)}
      />)}</div>}
    {(project.status === "handed_off" || project.current_deliverable_id) &&
      <FinalReelSection project={project} shots={shots} onProjectChanged={onProjectChanged} />}
    {shotModal && <ShotFormModal videoProjectId={project.id} brandBlock={brandBlock} motions={motions} motionsLoading={motionsLoading} initialShot={shotModal.shot} onClose={() => setShotModal(null)} onSaved={(shot) => {
      applyShots(shotModal.shot ? shots.map((row) => row.id === shot.id ? shot : row) : [...shots, shot]);
      setShotModal(null);
    }} />}
  </div>;
}

function NewProjectModal({ clientId, organicRows, adsRows, brandBlocks, prefill, onClose, onCreated }: {
  clientId: string;
  organicRows: OrganicMasterRow[];
  adsRows: AdsMasterRow[];
  brandBlocks: BrandPromptBlockRow[];
  prefill: { table: "organic_master" | "ads_master"; rowId: string; title?: string; productionBriefId?: string } | null;
  onClose: () => void;
  onCreated: (project: VideoProjectRow) => void;
}) {
  const [sourceTable, setSourceTable] = useState<"organic_master" | "ads_master">(prefill?.table ?? "organic_master");
  const [sourceRowId, setSourceRowId] = useState(prefill?.rowId ?? "");
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [archetype, setArchetype] = useState<VideoArchetype>("A1");
  const [awarenessStage, setAwarenessStage] = useState<AwarenessStage>("unaware");
  const [targetDurationSec, setTargetDurationSec] = useState(28);
  const [brandPromptBlockId, setBrandPromptBlockId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase 2, Workstream B: a source-linked project must be bound to the exact
  // approved reel_video brief it will be produced from. When the prefill did not
  // carry one (e.g. the Content row's "Reel Studio" shortcut), resolve it here and
  // run the SAME eligibility resolver the backend enforces, so the operator sees
  // the real reason instead of a rejected create.
  const [eligibility, setEligibility] = useState<ReelSourceEligibility | null>(null);
  const [resolvedBriefId, setResolvedBriefId] = useState<string | null>(prefill?.productionBriefId ?? null);
  const [resolving, setResolving] = useState(false);

  const options = sourceTable === "organic_master" ? organicRows : adsRows;
  const brandDnaBlocks = brandBlocks.filter((block) => block.block_type === "brand_dna");
  const isBriefOrigin = Boolean(prefill?.productionBriefId);
  const isSourceLinked = Boolean(prefill);

  useEffect(() => {
    if (!isSourceLinked || !sourceRowId) { setEligibility(null); setResolvedBriefId(prefill?.productionBriefId ?? null); return; }
    let active = true;
    setResolving(true); setEligibility(null);
    void (async () => {
      try {
        const [sourceRow, briefs] = await Promise.all([
          fetchMasterRowById(sourceTable, sourceRowId),
          fetchReelVideoBriefsForSource({ clientId, sourceTable, sourceRowId }),
        ]);
        if (!active) return;
        const approved = briefs.filter((brief) => brief.status === "approved");
        const explicit = prefill?.productionBriefId
          ? briefs.find((brief) => brief.id === prefill.productionBriefId) ?? null
          : null;
        const candidate: ProductionBriefRow | null = explicit ?? (approved.length === 1 ? approved[0] : approved[0] ?? briefs[0] ?? null);
        setResolvedBriefId(explicit?.id ?? (approved.length === 1 ? approved[0].id : null));
        setEligibility(resolveReelSourceEligibility({
          sourceTable,
          sourceRow,
          brief: candidate,
          briefCandidateCount: explicit ? 1 : approved.length,
        }));
      } catch (value) {
        if (active) setError(errorText(value));
      } finally {
        if (active) setResolving(false);
      }
    })();
    return () => { active = false; };
  }, [clientId, isSourceLinked, prefill?.productionBriefId, sourceRowId, sourceTable]);

  const blocked = isSourceLinked && (resolving || !eligibility?.eligible || !resolvedBriefId);

  async function save() {
    if (isSourceLinked && !sourceRowId) { setError("Choose a source content row."); return; }
    if (isSourceLinked && (!eligibility?.eligible || !resolvedBriefId)) {
      setError(eligibility?.reason ?? "This content row cannot be produced in Reel Studio yet.");
      return;
    }
    if (!title.trim()) { setError("Title is required."); return; }
    setBusy(true); setError(null);
    try {
      const project = await createVideoProject({
        clientId,
        sourceTable: isSourceLinked ? sourceTable : undefined,
        sourceRowId: isSourceLinked ? sourceRowId : undefined,
        clientProductionBriefId: resolvedBriefId ?? undefined,
        title: title.trim(), archetype, awarenessStage,
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
        {isBriefOrigin && <div className="rounded border border-teal/20 bg-teal/5 px-3 py-2 text-2xs leading-5 text-teal">This project will be durably bound to the approved production brief that opened Reel Studio. Its source is locked. Cancel and choose New project to start an unbound project instead.</div>}
        {!isSourceLinked && <div className="rounded border border-line bg-ink px-3 py-2 text-2xs leading-5 text-paper-3">Standalone project — no linked content row and no production brief. You can add and generate shots manually, but AI storyboard generation and handoff to Assets both require a linked, approved reel_video brief.</div>}
        {isSourceLinked && resolving && <div className="rounded border border-line bg-ink px-3 py-2 text-2xs text-paper-3">Checking this content row's Reel Studio eligibility…</div>}
        {isSourceLinked && !resolving && eligibility && !eligibility.eligible && <div role="alert" className="rounded border border-warn/30 bg-warn/5 px-3 py-2 text-2xs leading-5 text-warn"><div className="font-medium">This content row cannot enter Reel Studio.</div><div className="mt-1">{eligibility.reason}</div></div>}
        {isSourceLinked && !resolving && eligibility?.eligible && !isBriefOrigin && <div className="rounded border border-teal/20 bg-teal/5 px-3 py-2 text-2xs leading-5 text-teal">Resolved one approved reel_video production brief for this row ({eligibility.resolvedMode} production). The project will be bound to it.</div>}
        {prefill && <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Source</label><div className="flex gap-2"><select disabled={isBriefOrigin} value={sourceTable} onChange={(event) => { setSourceTable(event.target.value as "organic_master" | "ads_master"); setSourceRowId(""); }} className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper disabled:cursor-not-allowed disabled:opacity-60"><option value="organic_master">Organic</option><option value="ads_master">Ads</option></select><select disabled={isBriefOrigin} value={sourceRowId} onChange={(event) => setSourceRowId(event.target.value)} className="min-w-0 flex-1 rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper disabled:cursor-not-allowed disabled:opacity-60"><option value="">Choose content row…</option>{options.map((row) => <option key={row.id} value={row.id}>{row.ref}</option>)}</select></div></div>}
        <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Title</label><input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper outline-none focus:border-teal/50" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Archetype</label><select value={archetype} onChange={(event) => setArchetype(event.target.value as VideoArchetype)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper">{ARCHETYPES.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>
          <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Awareness stage</label><select value={awarenessStage} onChange={(event) => setAwarenessStage(event.target.value as AwarenessStage)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper">{AWARENESS_STAGES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></div>
        </div>
        <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Target duration (22–34s)</label><input type="number" min={22} max={34} value={targetDurationSec} onChange={(event) => setTargetDurationSec(Number(event.target.value))} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper outline-none focus:border-teal/50" /></div>
        <div><label className="mb-1 block text-2xs font-mono uppercase tracking-wide text-paper-3">Brand prompt block</label><select value={brandPromptBlockId} onChange={(event) => setBrandPromptBlockId(event.target.value)} className="w-full rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper"><option value="">Default (active Brand DNA)</option>{brandDnaBlocks.map((block) => <option key={block.id} value={block.id}>{block.name} v{block.version}{block.is_active ? " (active)" : ""}</option>)}</select></div>
        {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-line px-5 py-3"><Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button size="sm" variant="primary" disabled={busy || blocked} title={blocked ? eligibility?.reason ?? "Resolving eligibility…" : undefined} onClick={() => void save()}>{busy ? "Creating…" : "Create project"}</Button></div>
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
  const [motionsError, setMotionsError] = useState<string | null>(null);
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
    void fetchHiggsfieldMotions()
      .then((value) => { setMotions(value); setMotionsError(null); })
      .catch((value) => setMotionsError(errorText(value)))
      .finally(() => setMotionsLoading(false));
    setMotionsLoading(true);
  }, []);

  const prefillTable = searchParams.get("reel_source_table");
  const prefillRowId = searchParams.get("reel_source_row_id");
  const prefillTitle = searchParams.get("reel_title");
  const prefillBriefId = searchParams.get("reel_production_brief_id");
  useEffect(() => {
    if ((prefillTable === "organic_master" || prefillTable === "ads_master") && prefillRowId) {
      setNewProjectOpen(true);
    }
  }, [prefillTable, prefillRowId]);

  function clearPrefill() {
    const next = new URLSearchParams(searchParams);
    next.delete("reel_source_table"); next.delete("reel_source_row_id"); next.delete("reel_source_ref");
    next.delete("reel_title"); next.delete("reel_production_brief_id");
    setSearchParams(next, { replace: true });
  }

  const openProject = projects.find((project) => project.id === openProjectId) ?? null;
  const handleShotsChanged = useCallback((projectId: string, nextShots: VideoShotRow[]) => {
    setShotsByProject((current) => [
      ...current.filter((shot) => shot.video_project_id !== projectId),
      ...nextShots,
    ]);
  }, []);

  if (loading && projects.length === 0) return <div className="p-6 text-xs text-paper-3">Loading Reel Studio projects…</div>;

  if (openProject) {
    return <ProjectDetail
      project={openProject} organicRows={organicRows} adsRows={adsRows} brandBlocks={brandBlocks}
      motions={motions} motionsLoading={motionsLoading} motionsError={motionsError}
      onBack={() => setOpenProjectId(null)}
      onProjectChanged={(next) => setProjects((current) => current.map((row) => row.id === next.id ? next : row))}
      onShotsChanged={handleShotsChanged}
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
      prefill={(prefillTable === "organic_master" || prefillTable === "ads_master") && prefillRowId
        ? { table: prefillTable, rowId: prefillRowId, title: prefillTitle ?? undefined, productionBriefId: prefillBriefId ?? undefined }
        : null}
      onClose={() => { setNewProjectOpen(false); clearPrefill(); }}
      onCreated={(project) => {
        setProjects((current) => [project, ...current]); setNewProjectOpen(false);
        clearPrefill(); setOpenProjectId(project.id);
      }}
    />}
  </div>;
}
