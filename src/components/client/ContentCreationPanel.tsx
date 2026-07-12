import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/primitives";
import { MarkdownPreview } from "./ExecutionFilesPanel";
import { assignProductionBriefToContractor, createContractor, driveAssetJob, fetchAssignmentsForBrief, fetchAssetJobItems, fetchContractors, fetchEffectiveStageMap, fetchLatestAssetJobForBrief, fetchProductionBrief, fetchProductionBriefs, generateAiAssets, isAssetJobActive, logActivity, startAssetGeneration, transitionContentCreationToAssets, updateProductionBrief, updateProductionBriefReviewState, uploadVisualInputImage, type EffectiveStageEntry } from "@/lib/api";
import { ROUTES } from "@/lib/constants";
import { isPassedThrough } from "@/lib/pipeline";
import type { AiVisualDirection, AiVisualMode, AssetGenerationItemRow, AssetGenerationJobRow, AssetJobProgress, BackgroundStrength, ContractorAssignmentRow, ContractorRow, ProductionBriefRow, VisualInputUpload } from "@/types/phase";
import type { ReviewState } from "@/types/client";
import { resolveMultiImageCount, MULTI_IMAGE_SOURCE_LABEL, type MultiImageCountSource } from "../../../supabase/functions/_shared/production-brief-contract";
import { PassedThroughDrawer } from "./PassedThroughDrawer";
import { DestructiveDialog } from "./DestructiveDialog";

type ViewMode = "preview" | "edit" | "split";
type Notice = { error: boolean; message: string } | null;

const STATE_STYLE: Record<ReviewState, string> = {
  needs_review: "border-warn/20 bg-warn/10 text-warn",
  approved: "border-teal/20 bg-teal/10 text-teal",
  rejected: "border-neg/20 bg-neg/10 text-neg",
  archived: "border-line bg-ink text-paper-3",
};

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function StateBadge({ state }: { state: ReviewState }) {
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${STATE_STYLE[state]}`}>{state.replaceAll("_", " ")}</span>;
}

function expectedAiOutput(brief: ProductionBriefRow): { count: number | null; label: string; aspectRatio: string; source: MultiImageCountSource; ambiguous: boolean; maxItems: number } {
  if (brief.asset_format === "reel_video") return { count: null, label: "video", aspectRatio: "9:16", source: "ambiguous", ambiguous: true, maxItems: 0 };
  const resolved = resolveMultiImageCount(brief);
  const noun = resolved.label;
  const ambiguous = resolved.count === null || resolved.source === "ambiguous";
  const aspectRatio = brief.asset_format === "carousel" ? "4:5 each" : brief.asset_format === "story_sequence" ? "9:16 each" : "4:5";
  return {
    count: resolved.count,
    label: `${noun}${resolved.count === 1 ? "" : "s"}`,
    aspectRatio,
    source: resolved.source,
    ambiguous,
    maxItems: resolved.maxItems,
  };
}

const ITEM_DOT: Record<AssetGenerationItemRow["status"], string> = {
  complete: "bg-teal",
  processing: "bg-warn animate-pulse",
  failed: "bg-neg",
  queued: "bg-line",
};

// Persisted-progress panel for a multi-image job. Reads job + item state from the
// database, so it renders correctly whether generation is live in this modal or
// was started earlier and the page was reloaded.
function AiJobProgress({ job, items, noun, generating, onResume, onRetry }: {
  job: AssetGenerationJobRow;
  items: AssetGenerationItemRow[];
  noun: string;
  generating: boolean;
  onResume: () => void;
  onRetry: () => void;
}) {
  const active = job.status === "queued" || job.status === "processing";
  const failed = job.status === "partial" || job.status === "failed";
  const done = job.status === "complete";
  const current = Math.min(job.completed_output_count + 1, job.expected_output_count);
  const tone = done ? "border-teal/30 bg-teal/5" : failed ? "border-neg/30 bg-neg/5" : "border-warn/30 bg-warn/5";
  return <div className={`mt-4 rounded-xl border p-4 ${tone}`}>
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-paper">{done ? "Generation complete" : active ? (generating ? `Generating ${noun} ${current} of ${job.expected_output_count}…` : `Generation in progress — ${job.completed_output_count} of ${job.expected_output_count}`) : failed ? "Generation incomplete" : "Generation queued"}</span>
      <span className="ml-auto rounded border border-line px-1.5 py-0.5 font-mono text-2xs text-paper-3">{job.status}</span>
    </div>
    <div className="mt-3 flex flex-wrap gap-1.5">{Array.from({ length: job.expected_output_count }, (_, i) => { const item = items.find((it) => it.sequence_index === i + 1); const status = item?.status ?? "queued"; return <span key={i} title={`${noun} ${i + 1}: ${status}${item?.last_error ? ` — ${item.last_error}` : ""}`} className={`h-2.5 w-6 rounded-full ${ITEM_DOT[status]}`} />; })}</div>
    <div className="mt-2 text-2xs text-paper-3">{job.completed_output_count} of {job.expected_output_count} {noun}s stored · one image at a time. You can close this panel; generation state is saved and resumes here.</div>
    {job.last_error && !done && <div className="mt-2 rounded border border-neg/20 bg-neg/5 px-2 py-1 text-2xs text-neg">Last error: {job.last_error}</div>}
    {!generating && (active || failed) && <div className="mt-3 flex gap-2">{active && <Button size="sm" variant="primary" onClick={onResume}>Resume generation</Button>}{failed && <Button size="sm" variant="primary" onClick={onRetry}>Retry failed {noun}s</Button>}</div>}
  </div>;
}

function ProductionModal({ brief, onClose, onAssigned, onGenerated }: {
  brief: ProductionBriefRow;
  onClose: () => void;
  onAssigned: (assignment: ContractorAssignmentRow, updatedBrief: ProductionBriefRow) => void;
  onGenerated: (updatedBrief: ProductionBriefRow, assetCount: number) => void;
}) {
  const [step, setStep] = useState<"method" | "human" | "ai">("method");
  const [contractors, setContractors] = useState<ContractorRow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [specialty, setSpecialty] = useState("all");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [confirmCount, setConfirmCount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newContractor, setNewContractor] = useState({ name: "", email: "", role: "", specialties: "", notes: "" });
  // Visual direction state (Produce with AI).
  const [visualMode, setVisualMode] = useState<AiVisualMode>("text_only");
  const [bgStrength, setBgStrength] = useState<BackgroundStrength>("subtle");
  const [visualNotes, setVisualNotes] = useState("");
  const [uploadedImage, setUploadedImage] = useState<VisualInputUpload | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const requiresUpload = visualMode === "uploaded_background" || visualMode === "uploaded_insert";
  const aiOutput = expectedAiOutput(brief);
  const isMultiImage = brief.asset_format === "carousel" || brief.asset_format === "story_sequence";
  const slideNoun = brief.asset_format === "story_sequence" ? "frame" : "slide";

  // ── Persisted generation job (carousel/story) ──────────────────────────────
  // Generation runs slide-by-slide against a persisted job, so closing this modal
  // or reloading the page never loses progress — on reopen we read the job back.
  const [job, setJob] = useState<AssetGenerationJobRow | null>(null);
  const [items, setItems] = useState<AssetGenerationItemRow[]>([]);
  const keepDriving = useRef(true);
  const jobActive = isAssetJobActive(job);
  const jobFailed = job?.status === "partial" || job?.status === "failed";

  function applyProgress(p: AssetJobProgress) { setJob(p.job); }

  const loadJob = useCallback(async () => {
    if (!isMultiImage) return;
    try {
      const latest = await fetchLatestAssetJobForBrief(brief.id);
      setJob(latest);
      if (latest) setItems(await fetchAssetJobItems(latest.id));
    } catch { /* non-fatal — the Generate button still works */ }
  }, [brief.id, isMultiImage]);
  useEffect(() => { void loadJob(); }, [loadJob]);
  useEffect(() => { keepDriving.current = true; return () => { keepDriving.current = false; }; }, []);

  function resetVisualUpload() { setUploadedImage(null); setUploadPreview(null); }

  async function onSelectVisualFile(file: File | undefined) {
    if (!file) return;
    setError(null); resetVisualUpload(); setUploading(true);
    try {
      const upload = await uploadVisualInputImage(brief.client_id, brief.execution_month, brief.source_ref, file);
      setUploadedImage(upload);
      const reader = new FileReader();
      reader.onload = () => setUploadPreview(typeof reader.result === "string" ? reader.result : null);
      reader.readAsDataURL(file);
    } catch (value) { setError(errorText(value)); }
    finally { setUploading(false); }
  }

  async function loadContractors() {
    setLoading(true); setError(null);
    try { setContractors(await fetchContractors()); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (step === "human") void loadContractors(); }, [step]);
  const specialties = useMemo(() => [...new Set(contractors.flatMap((contractor) => contractor.specialties))].sort(), [contractors]);
  const visible = contractors.filter((contractor) => {
    const search = `${contractor.name} ${contractor.email} ${contractor.role ?? ""} ${contractor.specialties.join(" ")}`.toLowerCase();
    return (!query.trim() || search.includes(query.trim().toLowerCase())) && (specialty === "all" || contractor.specialties.includes(specialty));
  });

  async function addContractor() {
    if (!newContractor.name.trim() || !newContractor.email.trim()) return;
    setLoading(true); setError(null);
    try {
      const created = await createContractor({
        name: newContractor.name,
        email: newContractor.email,
        role: newContractor.role,
        specialties: newContractor.specialties.split(","),
        notes: newContractor.notes,
      });
      setContractors((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedId(created.id); setAdding(false);
    } catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }

  async function send() {
    const contractor = contractors.find((candidate) => candidate.id === selectedId);
    if (!contractor || !window.confirm(`Send ${brief.source_ref} production instructions to ${contractor.name} at ${contractor.email}?`)) return;
    setSending(true); setError(null);
    try {
      const result = await assignProductionBriefToContractor({ productionBriefId: brief.id, contractorId: contractor.id, message });
      onAssigned({ ...result.assignment, contractors: result.assignment.contractors ?? contractor }, result.brief);
      onClose();
    } catch (value) { setError(errorText(value)); }
    finally { setSending(false); }
  }

  // Move the ref from Content Creation → Assets on first production, then notify.
  // Best-effort transition — the asset(s) already committed and presence derivation
  // keeps visibility correct regardless.
  async function finishComplete(assetGroupRef: string, assetCount: number) {
    if (brief.production_status !== "produced") {
      try {
        await transitionContentCreationToAssets({
          clientId: brief.client_id, executionMonth: brief.execution_month, sourceRef: brief.source_ref,
          productionBriefId: brief.id, assetGroupRef,
          title: brief.title, assetFormat: brief.asset_format,
          briefSnapshot: brief as unknown as Record<string, unknown>,
        });
      } catch { /* non-fatal */ }
    }
    const updated = await fetchProductionBrief(brief.id).catch(() => ({ ...brief, production_status: "produced" as const }));
    onGenerated(updated, assetCount);
    window.dispatchEvent(new Event("aa:reload"));
    onClose();
  }

  // Drive a persisted job slide-by-slide to a terminal state, updating progress.
  async function runJob(jobId: string, opts: { retryFailed?: boolean } = {}) {
    setGenerating(true); setError(null);
    try {
      const final = await driveAssetJob(jobId, applyProgress, { retryFailed: opts.retryFailed, shouldContinue: () => keepDriving.current });
      setJob(final.job);
      setItems(await fetchAssetJobItems(jobId).catch(() => []));
      if (final.status === "complete") {
        await finishComplete(final.asset_group_ref, final.expected_output_count);
      } else if (keepDriving.current) {
        setError(`Generation ${final.status}: ${final.completed_output_count} of ${final.expected_output_count} ${slideNoun}s done.${final.last_error ? ` Last error: ${final.last_error}` : ""} Retry the remaining ${slideNoun}s below.`);
      }
    } catch (value) { setError(errorText(value)); }
    finally { setGenerating(false); }
  }

  async function generate() {
    if (brief.asset_format === "reel_video") return;
    // For an ambiguous multi-image brief the operator must confirm the count;
    // it is passed only as a fallback (the generator ignores it if the brief is
    // itself unambiguous). Never silently default.
    let overrideCount: number | undefined;
    if (aiOutput.ambiguous) {
      const parsed = Number(confirmCount);
      if (!Number.isInteger(parsed) || parsed < 2 || parsed > aiOutput.maxItems) {
        setError(`Enter a confirmed count between 2 and ${aiOutput.maxItems} before generating.`);
        return;
      }
      overrideCount = parsed;
    }
    // Upload modes must have a stored image — never let an uploaded mode become
    // a silent no-op with no image attached.
    if (requiresUpload && !uploadedImage) {
      setError("Upload a valid image for this visual mode before generating.");
      return;
    }
    const visual: AiVisualDirection = {
      visual_mode: visualMode,
      uploaded_image_path: uploadedImage?.path ?? null,
      uploaded_image_mime_type: uploadedImage?.mime_type ?? null,
      uploaded_image_filename: uploadedImage?.filename ?? null,
      uploaded_image_size: uploadedImage?.size ?? null,
      visual_instructions: visualNotes.trim() || null,
      background_strength: visualMode === "generated_background" ? bgStrength : undefined,
      preserve_text_readability: true,
    };
    // Multi-image (carousel/story): start a persisted job and drive it one slide
    // per call — never one long request (that caused the 546). Single-image
    // formats stay on the original single-shot path.
    if (isMultiImage) {
      setGenerating(true); setError(null);
      try {
        const started = await startAssetGeneration(brief, { expectedCount: overrideCount, visual });
        setJob(started.job);
        setItems(await fetchAssetJobItems(started.job.id).catch(() => []));
        await runJob(started.job.id);
      } catch (value) { setError(errorText(value)); setGenerating(false); }
      return;
    }
    setGenerating(true); setError(null);
    try {
      const result = await generateAiAssets(brief, { expectedCount: overrideCount, visual });
      await finishComplete(result.asset_group_ref, result.asset_count);
    } catch (value) { setError(errorText(value)); }
    finally { setGenerating(false); }
  }

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 sm:items-center" onClick={onClose}>
    <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="shrink-0 border-b border-line px-5 py-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="font-mono text-2xs text-teal">{brief.source_ref}</div><h2 className="mt-1 text-base font-medium text-paper">Produce asset</h2><p className="mt-1 text-xs text-paper-3">{generating || sending ? "The server operation will continue if this modal is closed. Reload the relevant tab to recover its result." : "Choose how this approved production brief should be fulfilled."}</p></div><button onClick={onClose} className="text-paper-3 hover:text-paper">✕</button></div></header>
      {error && <div role="alert" className="shrink-0 border-b border-neg/20 bg-neg/5 px-5 py-2 text-xs text-neg">{error}</div>}
      <main className="min-h-0 flex-1 overflow-y-auto p-5">{step === "method" ? <div className="grid gap-3 sm:grid-cols-2"><button className="rounded-xl border border-teal/30 bg-teal/5 p-5 text-left hover:bg-teal/10" onClick={() => setStep("human")}><div className="text-sm font-medium text-paper">Human</div><div className="mt-2 text-xs leading-5 text-paper-3">Assign the approved markdown instructions to an active contractor and send them by email.</div></button><button disabled={brief.asset_format === "reel_video"} className={`rounded-xl border p-5 text-left ${brief.asset_format === "reel_video" ? "cursor-not-allowed border-line bg-ink opacity-60" : "border-teal/30 bg-teal/5 hover:bg-teal/10"}`} onClick={() => setStep("ai")}><div className="text-sm font-medium text-paper">AI</div><div className="mt-2 text-xs leading-5 text-paper-3">{brief.asset_format === "reel_video" ? "Video content is human-only. AI video generation is blocked." : `Generate ${aiOutput.count ?? "the approved"} ${aiOutput.label} and store ${aiOutput.count === 1 ? "it" : "them"} for review.`}</div></button></div> : step === "ai" ? <div className="space-y-4"><Button size="sm" variant="ghost" onClick={() => setStep("method")}>← Production method</Button><div className="rounded-xl border border-teal/20 bg-teal/5 p-5"><h3 className="text-sm font-medium text-paper">Generate AI asset?</h3><p className="mt-2 text-xs leading-5 text-paper-2">The approved production brief will be sent as a self-contained prompt. Generated files will be stored privately and marked needs review.</p><dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-paper-3">Format</dt><dd className="mt-0.5 text-paper">{brief.asset_format.replaceAll("_", " ")}</dd></div><div><dt className="text-paper-3">Expected output</dt><dd className={`mt-0.5 ${aiOutput.ambiguous ? "text-warn" : "text-paper"}`}>{aiOutput.ambiguous ? "Count could not be determined" : `${aiOutput.count} ${aiOutput.label}${(aiOutput.count ?? 1) > 1 ? ", generated one by one" : ""}`}</dd></div><div><dt className="text-paper-3">Count source</dt><dd className="mt-0.5 text-paper-2">{MULTI_IMAGE_SOURCE_LABEL[aiOutput.source]}</dd></div><div><dt className="text-paper-3">Aspect ratio</dt><dd className="mt-0.5 text-paper">{aiOutput.aspectRatio}</dd></div></dl>{aiOutput.ambiguous ? <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-3"><div className="text-2xs font-medium text-warn">Slide/frame count could not be confidently determined from the brief.</div><label className="mt-2 flex items-center gap-2 text-xs text-paper-2">Confirm count:<input inputMode="numeric" value={confirmCount} onChange={(event) => setConfirmCount(event.target.value.replace(/[^0-9]/g, ""))} placeholder={`2–${aiOutput.maxItems}`} className="w-20 rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50" /></label><div className="mt-1 text-2xs text-paper-3">Fix the brief's Slide Count field to avoid confirming manually next time.</div></div> : null}<p className="mt-4 text-2xs leading-5 text-warn">Carousel slides and story frames generate one at a time against a saved job. Completed slides are kept; you can retry only the ones that fail. Closing this modal does not cancel the job.</p>{isMultiImage && job && <AiJobProgress job={job} items={items} noun={slideNoun} generating={generating} onResume={() => void runJob(job.id)} onRetry={() => void runJob(job.id, { retryFailed: true })} />}</div>
      <div className="rounded-xl border border-line bg-ink p-4">
        <div className="text-sm font-medium text-paper">Visual Direction</div>
        <p className="mt-1 text-2xs text-paper-3">Choose how the AI treats visuals. Defaults to text/layout only. Applies to every slide/frame for multi-image assets.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">{([
          ["text_only", "Text / Layout only", "No image. Typography and layout over a plain brand background."],
          ["uploaded_background", "Upload background image", "Your image becomes the base layer; text is kept readable over it."],
          ["uploaded_insert", "Upload image to include", "Your image is placed as a supporting element, not necessarily full background."],
          ["generated_background", "Generate AI background image", "AI creates a subtle brand-aligned background behind the text."],
        ] as [AiVisualMode, string, string][]).map(([mode, label, desc]) => <button key={mode} type="button" onClick={() => { setVisualMode(mode); if (mode !== "uploaded_background" && mode !== "uploaded_insert") resetVisualUpload(); }} className={`rounded-lg border p-3 text-left ${visualMode === mode ? "border-teal/40 bg-teal/5" : "border-line bg-ink-200 hover:border-teal/20"}`}><div className="text-xs font-medium text-paper">{label}</div><div className="mt-1 text-2xs leading-4 text-paper-3">{desc}</div></button>)}</div>
        {requiresUpload && <div className="mt-3 rounded-lg border border-line bg-ink-200 p-3"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void onSelectVisualFile(event.target.files?.[0])} className="block w-full text-2xs text-paper-3 file:mr-3 file:rounded file:border-0 file:bg-teal/15 file:px-2 file:py-1 file:text-teal" /><div className="mt-1 text-2xs text-paper-3">{visualMode === "uploaded_background" ? "This image will be used as the background/base layer. The generated design should keep text readable." : "Use this as a supporting image, not necessarily full background."}</div>{uploading && <div className="mt-2 text-2xs text-warn">Uploading…</div>}{uploadPreview && <div className="mt-2 flex items-center gap-3"><img src={uploadPreview} alt="input preview" className="h-16 w-16 rounded border border-line object-cover" /><div className="min-w-0 text-2xs text-paper-3"><div className="truncate text-paper">{uploadedImage?.filename}</div><div>{uploadedImage ? `${(uploadedImage.size / 1024 / 1024).toFixed(2)} MB · ${uploadedImage.mime_type}` : ""}</div><button type="button" className="mt-1 text-teal hover:underline" onClick={resetVisualUpload}>Remove</button></div></div>}</div>}
        {visualMode === "generated_background" && <div className="mt-3 rounded-lg border border-line bg-ink-200 p-3"><label className="flex items-center gap-2 text-2xs text-paper-3">Background strength:<select value={bgStrength} onChange={(event) => setBgStrength(event.target.value as BackgroundStrength)} className="rounded border border-line bg-ink px-2 py-1 text-xs text-paper"><option value="subtle">subtle</option><option value="moderate">moderate</option><option value="strong">strong</option></select></label><div className="mt-1 text-2xs text-paper-3">AI will create a brand-aligned visual background behind the text.</div></div>}
        <label className="mt-3 flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Additional visual instructions</span><textarea value={visualNotes} onChange={(event) => setVisualNotes(event.target.value)} maxLength={2000} placeholder="e.g. Use abstract premium gradient, no people; keep image darkened behind ivory typography" className="min-h-16 rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper" /></label>
        <div className="mt-3 rounded border border-warn/20 bg-warn/5 px-2.5 py-1.5 text-2xs text-warn">Generated text inside images may need review. Keep final copy checked against the production brief.</div>
      </div></div> : <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={() => setStep("method")}>← Production method</Button><span className="text-xs text-paper-2">Assign to human contractor</span><Button size="sm" variant="secondary" className="ml-auto" onClick={() => setAdding((value) => !value)}>{adding ? "Cancel Add" : "Add Contractor"}</Button></div>{adding && <div className="grid gap-2 rounded-lg border border-line bg-ink p-3 sm:grid-cols-2"><input placeholder="Name *" value={newContractor.name} onChange={(event) => setNewContractor((current) => ({ ...current, name: event.target.value }))} className="rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper" /><input type="email" placeholder="Email *" value={newContractor.email} onChange={(event) => setNewContractor((current) => ({ ...current, email: event.target.value }))} className="rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper" /><input placeholder="Role" value={newContractor.role} onChange={(event) => setNewContractor((current) => ({ ...current, role: event.target.value }))} className="rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper" /><input placeholder="Specialties, comma separated" value={newContractor.specialties} onChange={(event) => setNewContractor((current) => ({ ...current, specialties: event.target.value }))} className="rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper" /><textarea placeholder="Notes" value={newContractor.notes} onChange={(event) => setNewContractor((current) => ({ ...current, notes: event.target.value }))} className="min-h-20 rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper sm:col-span-2" /><Button size="sm" variant="primary" className="sm:col-span-2" disabled={loading || !newContractor.name.trim() || !newContractor.email.trim()} onClick={() => void addContractor()}>Save Contractor</Button></div>}<div className="grid gap-2 sm:grid-cols-[1fr_180px]"><input placeholder="Filter contractors…" value={query} onChange={(event) => setQuery(event.target.value)} className="rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper" /><select value={specialty} onChange={(event) => setSpecialty(event.target.value)} className="rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper"><option value="all">All specialties</option>{specialties.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>{loading ? <div className="py-6 text-center text-xs text-paper-3">Loading contractors…</div> : visible.length ? <div className="space-y-2">{visible.map((contractor) => <label key={contractor.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${selectedId === contractor.id ? "border-teal/40 bg-teal/5" : "border-line bg-ink"}`}><input type="radio" name="contractor" checked={selectedId === contractor.id} onChange={() => setSelectedId(contractor.id)} className="mt-1 accent-teal" /><div className="min-w-0"><div className="text-xs font-medium text-paper">{contractor.name}</div><div className="mt-0.5 break-words text-2xs text-paper-3">{contractor.email}{contractor.role ? ` · ${contractor.role}` : ""}</div>{contractor.specialties.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{contractor.specialties.map((value) => <span key={value} className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">{value}</span>)}</div>}</div></label>)}</div> : <div className="rounded-lg border border-dashed border-line p-6 text-center"><div className="text-sm text-paper">No contractors added yet.</div><div className="mt-1 text-xs text-paper-3">Add an active contractor before sending instructions.</div></div>}<textarea placeholder="Optional assignment message…" value={message} maxLength={4000} onChange={(event) => setMessage(event.target.value)} className="min-h-24 w-full rounded border border-line bg-ink px-3 py-2 text-xs text-paper" /></div>}</main>
      {step === "human" && <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3"><span className="text-2xs text-paper-3">Email sends only after confirmation.</span><Button size="sm" variant="primary" className="ml-auto" disabled={!selectedId || sending || brief.status !== "approved"} onClick={() => void send()}>{sending ? "Sending…" : "Send Instructions"}</Button></footer>}
      {step === "ai" && <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3"><span className="text-2xs text-paper-3">{jobActive ? "A generation job is in progress. Resume it above." : "No video generation. Images remain private and require review."}</span><Button size="sm" variant="primary" className="ml-auto" disabled={generating || uploading || jobActive || (requiresUpload && !uploadedImage) || brief.asset_format === "reel_video" || brief.status !== "approved" || (aiOutput.ambiguous && !(Number.isInteger(Number(confirmCount)) && Number(confirmCount) >= 2 && Number(confirmCount) <= aiOutput.maxItems))} onClick={() => void generate()}>{generating ? `Generating…` : isMultiImage && (jobFailed || job?.status === "complete") ? "Generate New Group" : "Generate Asset"}</Button></footer>}
    </div>
  </div>;
}

export function ProductionBriefModal({ initialBrief, onClose, onUpdated, onAssignment, onViewAssets }: {
  initialBrief: ProductionBriefRow;
  onClose: () => void;
  onUpdated: (brief: ProductionBriefRow) => void;
  onAssignment?: (assignment: ContractorAssignmentRow) => void;
  onViewAssets?: () => void;
}) {
  const [brief, setBrief] = useState(initialBrief);
  const [draft, setDraft] = useState(initialBrief.content_md);
  const [mode, setMode] = useState<ViewMode>("preview");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [assignments, setAssignments] = useState<ContractorAssignmentRow[]>([]);
  const [produceOpen, setProduceOpen] = useState(false);
  const [rejectRollbackOpen, setRejectRollbackOpen] = useState(false);
  const dirty = draft !== brief.content_md;

  useEffect(() => {
    let active = true;
    void fetchAssignmentsForBrief(initialBrief.id)
      .then((rows) => { if (active) setAssignments(rows); })
      .catch((error) => { if (active) setNotice({ error: true, message: errorText(error) }); });
    return () => { active = false; };
  }, [initialBrief.id]);

  function accept(next: ProductionBriefRow) { setBrief(next); setDraft(next.content_md); onUpdated(next); }
  function close() { if (!dirty || window.confirm("Discard unsaved production-brief changes?")) onClose(); }
  async function reload() {
    if (dirty && !window.confirm("Reload the saved brief and discard unsaved changes?")) return;
    setBusy("reload"); setNotice(null);
    try { accept(await fetchProductionBrief(brief.id)); setNotice({ error: false, message: "Reloaded the latest brief." }); }
    catch (error) { setNotice({ error: true, message: errorText(error) }); }
    finally { setBusy(null); }
  }
  async function save() {
    if (!dirty || !draft.trim()) return;
    setBusy("save"); setNotice(null);
    try {
      const next = await updateProductionBrief(brief, draft);
      accept(next); setNotice({ error: false, message: `Saved version ${next.version}.` });
      void logActivity(brief.client_id, "production_brief_saved", `${brief.source_ref} production brief edited.`, { brief_id: brief.id, version: next.version });
    } catch (error) { setNotice({ error: true, message: errorText(error) }); }
    finally { setBusy(null); }
  }
  async function review(status: Extract<ReviewState, "approved" | "rejected">) {
    if (dirty || !window.confirm(`${status === "approved" ? "Approve" : "Reject"} this production brief?`)) return;
    setBusy(status); setNotice(null);
    try {
      const next = await updateProductionBriefReviewState(brief.id, status);
      accept(next); setNotice({ error: false, message: `Brief marked ${status}.` });
      void logActivity(brief.client_id, `production_brief_${status}`, `${brief.source_ref} production brief marked ${status}.`, { brief_id: brief.id });
    } catch (error) { setNotice({ error: true, message: errorText(error) }); }
    finally { setBusy(null); }
  }
  const editor = <textarea aria-label={`${brief.source_ref} production brief editor`} className="h-full min-h-0 w-full flex-1 resize-none overflow-y-auto bg-ink p-4 font-mono text-xs leading-6 text-paper outline-none" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />;

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={close}>
    <div className="flex h-[94vh] max-h-[calc(100vh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:h-[90vh] sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="shrink-0 border-b border-line px-4 py-3 sm:px-5"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-2xs text-teal">{brief.source_ref}</span><StateBadge state={brief.status} /><span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">{brief.asset_format.replaceAll("_", " ")}</span></div><h2 className="mt-2 break-words text-sm font-medium text-paper">{brief.title}</h2><div className="mt-1 flex flex-wrap gap-3 font-mono text-2xs text-paper-3"><span>v{brief.version}</span><span>{brief.production_status.replaceAll("_", " ")}</span><span>{brief.production_mode ?? "mode unassigned"}</span>{assignments[0]?.contractors && <span>contractor {assignments[0].contractors.name}</span>}<span>{new Date(brief.updated_at).toLocaleString()}</span>{dirty && <span className="text-warn">unsaved changes</span>}</div></div><button onClick={close} className="text-paper-3 hover:text-paper">✕</button></div></header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 sm:px-5"><div className="flex rounded-md border border-line bg-ink p-0.5">{(["preview", "edit", "split"] as ViewMode[]).map((value) => <button key={value} onClick={() => setMode(value)} className={`rounded px-2.5 py-1 text-xs capitalize ${mode === value ? "bg-teal/15 text-teal" : "text-paper-3"}`}>{value}</button>)}</div><div className="ml-auto flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void reload()}>{busy === "reload" ? "Reloading…" : "Reload Brief"}</Button>{brief.status !== "approved" && <Button size="sm" variant="secondary" disabled={dirty || busy !== null} onClick={() => void review("approved")}>{busy === "approved" ? "Approving…" : "Approve Review"}</Button>}{brief.status !== "rejected" && <Button size="sm" variant="danger" disabled={dirty || busy !== null} onClick={() => void review("rejected")}>{busy === "rejected" ? "Rejecting…" : "Reject"}</Button>}<Button size="sm" variant="danger" disabled={busy !== null} title="Reject this brief, remove its generated assets, and return the ref to Content" onClick={() => setRejectRollbackOpen(true)}>Reject → Content</Button>{(mode === "edit" || mode === "split") && <><Button size="sm" variant="ghost" disabled={!dirty || busy !== null} onClick={() => setDraft(brief.content_md)}>Reset Changes</Button><Button size="sm" variant="primary" disabled={!dirty || !draft.trim() || busy !== null} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save Changes"}</Button></>}</div></div>
      {notice && <div role={notice.error ? "alert" : "status"} className={`shrink-0 border-b px-5 py-2 text-xs ${notice.error ? "border-neg/20 bg-neg/5 text-neg" : "border-teal/20 bg-teal/5 text-teal"}`}>{notice.message}</div>}
      <main className="min-h-0 flex-1 overflow-hidden">{mode === "preview" && <div className="h-full overflow-y-auto p-5 sm:p-7"><MarkdownPreview content={draft} /></div>}{mode === "edit" && <div className="flex h-full min-h-0 p-4"><div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-line">{editor}</div></div>}{mode === "split" && <div className="grid h-full min-h-0 grid-cols-1 grid-rows-2 gap-3 overflow-hidden p-3 min-[900px]:grid-cols-2 min-[900px]:grid-rows-1"><section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line"><div className="shrink-0 border-b border-line px-3 py-2 text-2xs uppercase text-paper-3">Markdown</div><div className="flex min-h-0 flex-1">{editor}</div></section><section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line"><div className="shrink-0 border-b border-line px-3 py-2 text-2xs uppercase text-paper-3">Preview</div><div className="min-h-0 flex-1 overflow-y-auto p-5"><MarkdownPreview content={draft} /></div></section></div>}</main>
      <footer className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-2.5 text-xs"><span className={brief.status === "approved" ? "text-teal" : "text-warn"}>{brief.status === "approved" ? "Approved production brief." : "Review required before production."}</span>{assignments[0] && <span className="text-paper-3">Latest assignment: {assignments[0].contractors?.name ?? "contractor"} · {assignments[0].status}</span>}{brief.production_status === "produced" && onViewAssets && <Button size="sm" variant="ghost" className="ml-auto" onClick={onViewAssets}>View Assets</Button>}<Button size="sm" variant="primary" className={brief.production_status === "produced" && onViewAssets ? "" : "ml-auto"} disabled={dirty || brief.status !== "approved"} title={brief.status !== "approved" ? "Approve the production brief first" : "Choose human or AI production"} onClick={() => setProduceOpen(true)}>Produce</Button></footer>
      {produceOpen && <ProductionModal brief={brief} onClose={() => setProduceOpen(false)} onAssigned={(assignment, nextBrief) => { setAssignments((current) => [assignment, ...current]); onAssignment?.(assignment); accept(nextBrief); setNotice({ error: false, message: `Instructions sent to ${assignment.contractors?.name ?? "contractor"}.` }); }} onGenerated={(nextBrief, assetCount) => { accept(nextBrief); setNotice({ error: false, message: `${assetCount} AI image asset${assetCount === 1 ? "" : "s"} generated and stored for review.` }); }} />}
      {rejectRollbackOpen && <DestructiveDialog target={{ operation_type: "reject_content_brief", brief_id: brief.id }} title={`Reject brief ${brief.source_ref} → Content`} confirmWord={brief.source_ref} onClose={() => setRejectRollbackOpen(false)} onDone={() => { window.dispatchEvent(new Event("aa:reload")); onClose(); }} />}
    </div>
  </div>;
}

// ── Content-format grouping ──────────────────────────────────────────────────
// One central config drives BOTH the section order and the format-filter options,
// so labels/order live in exactly one place. Content Briefs are grouped by the
// brief's canonical asset_format (the content being produced), NOT by source
// master. Unknown/legacy formats fall through to "Other" and never disappear.
interface ContentFormatGroup { keys: string[]; label: string; order: number }
const CONTENT_FORMATS: ContentFormatGroup[] = [
  { keys: ["feed_post"], label: "Feed Posts", order: 1 },
  { keys: ["carousel"], label: "Carousels", order: 2 },
  { keys: ["reel_video", "reel"], label: "Reels", order: 3 },
  { keys: ["story_sequence", "story"], label: "Story Sequences", order: 4 },
  { keys: ["ad_static"], label: "Static Ads", order: 5 },
  { keys: ["ad_video"], label: "Video Ads", order: 6 },
];
const OTHER_FORMAT = { label: "Other", order: 99 };
const FORMAT_FILTER_OPTIONS = ["All Formats", ...CONTENT_FORMATS.map((group) => group.label), OTHER_FORMAT.label];
const STATUS_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All Statuses" },
  { value: "needs_review", label: "Needs review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

function formatGroupFor(assetFormat: string): { label: string; order: number } {
  const key = (assetFormat ?? "").toLowerCase();
  const match = CONTENT_FORMATS.find((group) => group.keys.includes(key));
  return match ? { label: match.label, order: match.order } : OTHER_FORMAT;
}

// Planned date is derived (not stored on the brief) from the brief's calendar
// metadata; empty when unknown so those briefs sort last within their section.
function briefPlannedDate(brief: ProductionBriefRow): string {
  const calendar = (brief.metadata as { calendar?: Array<{ date?: unknown }> } | undefined)?.calendar;
  if (Array.isArray(calendar)) {
    const dates = calendar.map((cell) => (typeof cell?.date === "string" ? cell.date : "")).filter(Boolean).sort();
    if (dates.length) return dates[0];
  }
  return "";
}

function byPlannedThenRef(a: ProductionBriefRow, b: ProductionBriefRow): number {
  const pa = briefPlannedDate(a) || "9999-99-99";
  const pb = briefPlannedDate(b) || "9999-99-99";
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.source_ref.localeCompare(b.source_ref);
}

export function ContentCreationPanel({ clientId, executionMonth, onViewAssets }: { clientId: string; executionMonth: string; onViewAssets?: () => void }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [briefs, setBriefs] = useState<ProductionBriefRow[]>([]);
  const [stageMap, setStageMap] = useState<Map<string, EffectiveStageEntry>>(new Map());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [latestAssignments, setLatestAssignments] = useState<Record<string, ContractorAssignmentRow | undefined>>({});
  const [open, setOpen] = useState<ProductionBriefRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [formatFilter, setFormatFilter] = useState("All Formats");
  const load = useCallback(async () => { setLoading(true); setError(null); try { const [next, stages] = await Promise.all([fetchProductionBriefs(clientId, executionMonth), fetchEffectiveStageMap(clientId, executionMonth)]); setBriefs(next); setStageMap(stages); const histories = await Promise.all(next.map((brief) => fetchAssignmentsForBrief(brief.id))); setLatestAssignments(Object.fromEntries(next.map((brief, index) => [brief.id, histories[index][0]]))); } catch (value) { setError(errorText(value)); } finally { setLoading(false); } }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => { void load(); }; window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);
  useEffect(() => {
    const sourceRef = searchParams.get("source_ref");
    if (!sourceRef || !briefs.length) return;
    const match = briefs.find((brief) => brief.source_ref === sourceRef);
    if (!match) return;
    setOpen(match);
    setSearchParams({}, { replace: true });
  }, [briefs, searchParams, setSearchParams]);
  // Active = briefs whose ref is still in content_creation. Once a ref has an
  // asset (stage assets or later) it drops into the passed-through drawer.
  const activeBriefs = useMemo(() => briefs.filter((brief) => { const entry = stageMap.get(brief.source_ref); return !entry || !isPassedThrough(entry.stage, "content_creation"); }), [briefs, stageMap]);
  const passedThroughEntries = useMemo(() => [...stageMap.values()].filter((entry) => entry.has_production_brief && isPassedThrough(entry.stage, "content_creation")), [stageMap]);
  // Search + status + format filters apply to ALL active briefs BEFORE grouping.
  const filteredBriefs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activeBriefs.filter((brief) => {
      if (statusFilter !== "all" && brief.status !== statusFilter) return false;
      if (formatFilter !== "All Formats" && formatGroupFor(brief.asset_format).label !== formatFilter) return false;
      if (query && !`${brief.source_ref} ${brief.title ?? ""} ${brief.asset_format}`.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [activeBriefs, search, statusFilter, formatFilter]);
  // Group the visible briefs by format; only non-empty sections render, ordered
  // by the central config. Each brief lands in exactly one section.
  const sections = useMemo(() => {
    const map = new Map<string, { label: string; order: number; briefs: ProductionBriefRow[] }>();
    for (const brief of filteredBriefs) {
      const group = formatGroupFor(brief.asset_format);
      const entry = map.get(group.label) ?? { label: group.label, order: group.order, briefs: [] };
      entry.briefs.push(brief);
      map.set(group.label, entry);
    }
    return [...map.values()].map((section) => ({ ...section, briefs: [...section.briefs].sort(byPlannedThenRef) })).sort((a, b) => a.order - b.order);
  }, [filteredBriefs]);
  const counts = useMemo(() => ({ total: filteredBriefs.length, approved: filteredBriefs.filter((brief) => brief.status === "approved").length, review: filteredBriefs.filter((brief) => brief.status === "needs_review").length }), [filteredBriefs]);
  function accept(next: ProductionBriefRow) { setBriefs((current) => current.map((brief) => brief.id === next.id ? next : brief)); setOpen(next); }
  function clearFilters() { setSearch(""); setStatusFilter("all"); setFormatFilter("All Formats"); }

  const briefCard = (brief: ProductionBriefRow) => {
    const assignment = latestAssignments[brief.id];
    return <article key={brief.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <span className="w-28 shrink-0 font-mono text-2xs text-teal">{brief.source_ref}</span>
      <div className="min-w-[200px] flex-1"><div className="break-words text-xs text-paper">{brief.title}</div><div className="mt-1 text-2xs text-paper-3">{brief.asset_format.replaceAll("_", " ")} · {brief.production_status.replaceAll("_", " ")} · v{brief.version} · {new Date(brief.updated_at).toLocaleString()}</div>{assignment && <div className={`mt-1 text-2xs ${assignment.status === "failed" ? "text-neg" : "text-paper-3"}`}>{assignment.contractors?.name ?? "Contractor"} · {assignment.status}{assignment.sent_at ? ` · sent ${new Date(assignment.sent_at).toLocaleString()}` : ""}</div>}</div>
      <StateBadge state={brief.status} />
      <Button size="sm" variant="ghost" onClick={() => setOpen(brief)}>View / Edit</Button>
    </article>;
  };

  const field = "rounded border border-line bg-ink px-2.5 py-1.5 text-xs text-paper outline-none focus:border-teal";
  if (loading && !briefs.length) return <div className="p-6 text-xs text-paper-3">Loading production briefs…</div>;
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4 text-xs"><span className="text-paper">{counts.total} of {activeBriefs.length} briefs</span><span className="text-teal">{counts.approved} approved</span><span className="text-warn">{counts.review} need review</span><Button size="sm" variant="ghost" className="ml-auto" disabled={!passedThroughEntries.length} onClick={() => setDrawerOpen(true)}>Archived / Passed Through{passedThroughEntries.length ? ` (${passedThroughEntries.length})` : ""}</Button></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_180px]">
        <input aria-label="Search briefs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ref, title, or format…" className={field} />
        <select aria-label="Status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={field}>{STATUS_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        <select aria-label="Format filter" value={formatFilter} onChange={(event) => setFormatFilter(event.target.value)} className={field}>{FORMAT_FILTER_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select>
      </div>
      <p className="mt-2 text-2xs text-paper-3">Grouped by content format. Approved static, carousel, and story briefs support AI image production. Reels remain human-only.</p>
    </div>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {!activeBriefs.length ? (
      <div className="rounded-[10px] border border-dashed border-line p-10 text-center"><div className="text-sm text-paper">{briefs.length ? "No briefs are active in content creation." : "No production briefs yet."}</div><div className="mt-2 text-xs text-paper-3">{briefs.length ? "Produced briefs appear under Archived / Passed Through." : "Generate a brief from a Content row."}</div></div>
    ) : !sections.length ? (
      <div className="rounded-[10px] border border-dashed border-line p-10 text-center"><div className="text-sm text-paper">No briefs match these filters.</div><button className="mt-2 text-xs text-teal hover:underline" onClick={clearFilters}>Clear filters</button></div>
    ) : (
      <div className="flex flex-col gap-4">{sections.map((section) => {
        const secApproved = section.briefs.filter((brief) => brief.status === "approved").length;
        const secReview = section.briefs.filter((brief) => brief.status === "needs_review").length;
        return <section key={section.label}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1 pb-2"><h3 className="text-sm font-medium text-paper">{section.label}</h3><span className="font-mono text-xs text-paper-3">· {section.briefs.length}</span>{(secApproved > 0 || secReview > 0) && <span className="text-2xs text-paper-3">{secApproved > 0 && <span className="text-teal">{secApproved} approved</span>}{secApproved > 0 && secReview > 0 && " · "}{secReview > 0 && <span className="text-warn">{secReview} need review</span>}</span>}</div>
          <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">{section.briefs.map(briefCard)}</div>
        </section>;
      })}</div>
    )}
    {open && <ProductionBriefModal initialBrief={open} onClose={() => setOpen(null)} onUpdated={accept} onAssignment={(assignment) => setLatestAssignments((current) => ({ ...current, [assignment.production_brief_id]: assignment }))} onViewAssets={onViewAssets} />}
    {drawerOpen && <PassedThroughDrawer tabStage="content_creation" entries={passedThroughEntries} onClose={() => setDrawerOpen(false)} onViewFullArchive={(sourceRef) => navigate(`${ROUTES.clientSection(clientId, "archive")}?source_ref=${encodeURIComponent(sourceRef)}`)} />}
  </div>;
}
