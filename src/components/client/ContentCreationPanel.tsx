import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import { MarkdownPreview } from "./ExecutionFilesPanel";
import { assignProductionBriefToContractor, createContractor, fetchAssignmentsForBrief, fetchContractors, fetchProductionBrief, fetchProductionBriefs, generateAiAssets, logActivity, updateProductionBrief, updateProductionBriefReviewState } from "@/lib/api";
import type { ContractorAssignmentRow, ContractorRow, ProductionBriefRow } from "@/types/phase";
import type { ReviewState } from "@/types/client";

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

function expectedAiOutput(brief: ProductionBriefRow): { count: number | null; label: string; aspectRatio: string } {
  if (brief.asset_format === "feed_post") return { count: 1, label: "image", aspectRatio: "4:5" };
  if (brief.asset_format === "ad_static") return { count: 1, label: "image", aspectRatio: "4:5" };
  if (brief.asset_format === "reel_video") return { count: null, label: "video", aspectRatio: "9:16" };
  const item = brief.asset_format === "carousel" ? "slide" : "frame";
  const matches = [...brief.content_md.matchAll(new RegExp(`\\b${item}\\s*(\\d{1,2})\\b`, "gi"))].map((match) => Number.parseInt(match[1], 10));
  const metadataCount = typeof brief.metadata.expected_output_count === "number" ? brief.metadata.expected_output_count : 0;
  const count = Math.max(metadataCount, ...matches, 0) || null;
  return { count, label: `${item}${count === 1 ? "" : "s"}`, aspectRatio: brief.asset_format === "carousel" ? "4:5 each" : "9:16 each" };
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
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newContractor, setNewContractor] = useState({ name: "", email: "", role: "", specialties: "", notes: "" });
  const aiOutput = expectedAiOutput(brief);

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

  async function generate() {
    if (brief.asset_format === "reel_video") return;
    setGenerating(true); setError(null);
    try {
      const result = await generateAiAssets(brief);
      onGenerated(result.brief, result.asset_count);
      onClose();
    } catch (value) { setError(errorText(value)); }
    finally { setGenerating(false); }
  }

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 sm:items-center" onClick={() => { if (!generating && !sending) onClose(); }}>
    <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="shrink-0 border-b border-line px-5 py-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="font-mono text-2xs text-teal">{brief.source_ref}</div><h2 className="mt-1 text-base font-medium text-paper">Produce asset</h2><p className="mt-1 text-xs text-paper-3">Choose how this approved production brief should be fulfilled.</p></div><button disabled={generating || sending} onClick={onClose} className="text-paper-3 hover:text-paper disabled:opacity-40">✕</button></div></header>
      {error && <div role="alert" className="shrink-0 border-b border-neg/20 bg-neg/5 px-5 py-2 text-xs text-neg">{error}</div>}
      <main className="min-h-0 flex-1 overflow-y-auto p-5">{step === "method" ? <div className="grid gap-3 sm:grid-cols-2"><button className="rounded-xl border border-teal/30 bg-teal/5 p-5 text-left hover:bg-teal/10" onClick={() => setStep("human")}><div className="text-sm font-medium text-paper">Human</div><div className="mt-2 text-xs leading-5 text-paper-3">Assign the approved markdown instructions to an active contractor and send them by email.</div></button><button disabled={brief.asset_format === "reel_video"} className={`rounded-xl border p-5 text-left ${brief.asset_format === "reel_video" ? "cursor-not-allowed border-line bg-ink opacity-60" : "border-teal/30 bg-teal/5 hover:bg-teal/10"}`} onClick={() => setStep("ai")}><div className="text-sm font-medium text-paper">AI</div><div className="mt-2 text-xs leading-5 text-paper-3">{brief.asset_format === "reel_video" ? "Video content is human-only. AI video generation is blocked." : `Generate ${aiOutput.count ?? "the approved"} ${aiOutput.label} and store ${aiOutput.count === 1 ? "it" : "them"} for review.`}</div></button></div> : step === "ai" ? <div className="space-y-4"><Button size="sm" variant="ghost" onClick={() => setStep("method")}>← Production method</Button><div className="rounded-xl border border-teal/20 bg-teal/5 p-5"><h3 className="text-sm font-medium text-paper">Generate AI asset?</h3><p className="mt-2 text-xs leading-5 text-paper-2">The approved production brief will be sent as a self-contained prompt. Generated files will be stored privately and marked needs review.</p><dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-paper-3">Format</dt><dd className="mt-0.5 text-paper">{brief.asset_format.replaceAll("_", " ")}</dd></div><div><dt className="text-paper-3">Expected output</dt><dd className="mt-0.5 text-paper">{aiOutput.count ?? "Count validated from brief"} {aiOutput.label}</dd></div><div><dt className="text-paper-3">Aspect ratio</dt><dd className="mt-0.5 text-paper">{aiOutput.aspectRatio}</dd></div><div><dt className="text-paper-3">Source</dt><dd className="mt-0.5 font-mono text-teal">{brief.source_ref}</dd></div></dl><p className="mt-4 text-2xs leading-5 text-warn">Carousel slides and story frames generate one at a time. A partial group is rolled back if any image fails.</p></div></div> : <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={() => setStep("method")}>← Production method</Button><span className="text-xs text-paper-2">Assign to human contractor</span><Button size="sm" variant="secondary" className="ml-auto" onClick={() => setAdding((value) => !value)}>{adding ? "Cancel Add" : "Add Contractor"}</Button></div>{adding && <div className="grid gap-2 rounded-lg border border-line bg-ink p-3 sm:grid-cols-2"><input placeholder="Name *" value={newContractor.name} onChange={(event) => setNewContractor((current) => ({ ...current, name: event.target.value }))} className="rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper" /><input type="email" placeholder="Email *" value={newContractor.email} onChange={(event) => setNewContractor((current) => ({ ...current, email: event.target.value }))} className="rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper" /><input placeholder="Role" value={newContractor.role} onChange={(event) => setNewContractor((current) => ({ ...current, role: event.target.value }))} className="rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper" /><input placeholder="Specialties, comma separated" value={newContractor.specialties} onChange={(event) => setNewContractor((current) => ({ ...current, specialties: event.target.value }))} className="rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper" /><textarea placeholder="Notes" value={newContractor.notes} onChange={(event) => setNewContractor((current) => ({ ...current, notes: event.target.value }))} className="min-h-20 rounded border border-line bg-ink-200 px-2.5 py-2 text-xs text-paper sm:col-span-2" /><Button size="sm" variant="primary" className="sm:col-span-2" disabled={loading || !newContractor.name.trim() || !newContractor.email.trim()} onClick={() => void addContractor()}>Save Contractor</Button></div>}<div className="grid gap-2 sm:grid-cols-[1fr_180px]"><input placeholder="Filter contractors…" value={query} onChange={(event) => setQuery(event.target.value)} className="rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper" /><select value={specialty} onChange={(event) => setSpecialty(event.target.value)} className="rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper"><option value="all">All specialties</option>{specialties.map((value) => <option key={value} value={value}>{value}</option>)}</select></div>{loading ? <div className="py-6 text-center text-xs text-paper-3">Loading contractors…</div> : visible.length ? <div className="space-y-2">{visible.map((contractor) => <label key={contractor.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${selectedId === contractor.id ? "border-teal/40 bg-teal/5" : "border-line bg-ink"}`}><input type="radio" name="contractor" checked={selectedId === contractor.id} onChange={() => setSelectedId(contractor.id)} className="mt-1 accent-teal" /><div className="min-w-0"><div className="text-xs font-medium text-paper">{contractor.name}</div><div className="mt-0.5 break-words text-2xs text-paper-3">{contractor.email}{contractor.role ? ` · ${contractor.role}` : ""}</div>{contractor.specialties.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{contractor.specialties.map((value) => <span key={value} className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">{value}</span>)}</div>}</div></label>)}</div> : <div className="rounded-lg border border-dashed border-line p-6 text-center"><div className="text-sm text-paper">No contractors added yet.</div><div className="mt-1 text-xs text-paper-3">Add an active contractor before sending instructions.</div></div>}<textarea placeholder="Optional assignment message…" value={message} maxLength={4000} onChange={(event) => setMessage(event.target.value)} className="min-h-24 w-full rounded border border-line bg-ink px-3 py-2 text-xs text-paper" /></div>}</main>
      {step === "human" && <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3"><span className="text-2xs text-paper-3">Email sends only after confirmation.</span><Button size="sm" variant="primary" className="ml-auto" disabled={!selectedId || sending || brief.status !== "approved"} onClick={() => void send()}>{sending ? "Sending…" : "Send Instructions"}</Button></footer>}
      {step === "ai" && <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3"><span className="text-2xs text-paper-3">No video generation. Images remain private and require review.</span><Button size="sm" variant="primary" className="ml-auto" disabled={generating || brief.asset_format === "reel_video" || brief.status !== "approved" || (brief.asset_format !== "feed_post" && brief.asset_format !== "ad_static" && !aiOutput.count)} onClick={() => void generate()}>{generating ? `Generating ${aiOutput.count ?? ""} ${aiOutput.label}…` : "Generate Asset"}</Button></footer>}
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
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 sm:px-5"><div className="flex rounded-md border border-line bg-ink p-0.5">{(["preview", "edit", "split"] as ViewMode[]).map((value) => <button key={value} onClick={() => setMode(value)} className={`rounded px-2.5 py-1 text-xs capitalize ${mode === value ? "bg-teal/15 text-teal" : "text-paper-3"}`}>{value}</button>)}</div><div className="ml-auto flex flex-wrap gap-2"><Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void reload()}>{busy === "reload" ? "Reloading…" : "Reload Brief"}</Button>{brief.status !== "approved" && <Button size="sm" variant="secondary" disabled={dirty || busy !== null} onClick={() => void review("approved")}>{busy === "approved" ? "Approving…" : "Approve Review"}</Button>}{brief.status !== "rejected" && <Button size="sm" variant="danger" disabled={dirty || busy !== null} onClick={() => void review("rejected")}>{busy === "rejected" ? "Rejecting…" : "Reject"}</Button>}{(mode === "edit" || mode === "split") && <><Button size="sm" variant="ghost" disabled={!dirty || busy !== null} onClick={() => setDraft(brief.content_md)}>Reset Changes</Button><Button size="sm" variant="primary" disabled={!dirty || !draft.trim() || busy !== null} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save Changes"}</Button></>}</div></div>
      {notice && <div role={notice.error ? "alert" : "status"} className={`shrink-0 border-b px-5 py-2 text-xs ${notice.error ? "border-neg/20 bg-neg/5 text-neg" : "border-teal/20 bg-teal/5 text-teal"}`}>{notice.message}</div>}
      <main className="min-h-0 flex-1 overflow-hidden">{mode === "preview" && <div className="h-full overflow-y-auto p-5 sm:p-7"><MarkdownPreview content={draft} /></div>}{mode === "edit" && <div className="flex h-full min-h-0 p-4"><div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-line">{editor}</div></div>}{mode === "split" && <div className="grid h-full min-h-0 grid-cols-1 grid-rows-2 gap-3 overflow-hidden p-3 min-[900px]:grid-cols-2 min-[900px]:grid-rows-1"><section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line"><div className="shrink-0 border-b border-line px-3 py-2 text-2xs uppercase text-paper-3">Markdown</div><div className="flex min-h-0 flex-1">{editor}</div></section><section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line"><div className="shrink-0 border-b border-line px-3 py-2 text-2xs uppercase text-paper-3">Preview</div><div className="min-h-0 flex-1 overflow-y-auto p-5"><MarkdownPreview content={draft} /></div></section></div>}</main>
      <footer className="flex shrink-0 items-center gap-3 border-t border-line px-5 py-2.5 text-xs"><span className={brief.status === "approved" ? "text-teal" : "text-warn"}>{brief.status === "approved" ? "Approved production brief." : "Review required before production."}</span>{assignments[0] && <span className="text-paper-3">Latest assignment: {assignments[0].contractors?.name ?? "contractor"} · {assignments[0].status}</span>}{brief.production_status === "produced" && onViewAssets && <Button size="sm" variant="ghost" className="ml-auto" onClick={onViewAssets}>View Assets</Button>}<Button size="sm" variant="primary" className={brief.production_status === "produced" && onViewAssets ? "" : "ml-auto"} disabled={dirty || brief.status !== "approved"} title={brief.status !== "approved" ? "Approve the production brief first" : "Choose human or AI production"} onClick={() => setProduceOpen(true)}>Produce</Button></footer>
      {produceOpen && <ProductionModal brief={brief} onClose={() => setProduceOpen(false)} onAssigned={(assignment, nextBrief) => { setAssignments((current) => [assignment, ...current]); onAssignment?.(assignment); accept(nextBrief); setNotice({ error: false, message: `Instructions sent to ${assignment.contractors?.name ?? "contractor"}.` }); }} onGenerated={(nextBrief, assetCount) => { accept(nextBrief); setNotice({ error: false, message: `${assetCount} AI image asset${assetCount === 1 ? "" : "s"} generated and stored for review.` }); }} />}
    </div>
  </div>;
}

export function ContentCreationPanel({ clientId, executionMonth, onViewAssets }: { clientId: string; executionMonth: string; onViewAssets?: () => void }) {
  const [briefs, setBriefs] = useState<ProductionBriefRow[]>([]);
  const [latestAssignments, setLatestAssignments] = useState<Record<string, ContractorAssignmentRow | undefined>>({});
  const [open, setOpen] = useState<ProductionBriefRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(null); try { const next = await fetchProductionBriefs(clientId, executionMonth); setBriefs(next); const histories = await Promise.all(next.map((brief) => fetchAssignmentsForBrief(brief.id))); setLatestAssignments(Object.fromEntries(next.map((brief, index) => [brief.id, histories[index][0]]))); } catch (value) { setError(errorText(value)); } finally { setLoading(false); } }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);
  const counts = useMemo(() => ({ approved: briefs.filter((brief) => brief.status === "approved").length, review: briefs.filter((brief) => brief.status === "needs_review").length }), [briefs]);
  function accept(next: ProductionBriefRow) { setBriefs((current) => current.map((brief) => brief.id === next.id ? next : brief)); setOpen(next); }
  if (loading && !briefs.length) return <div className="p-6 text-xs text-paper-3">Loading production briefs…</div>;
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"><div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3"><div className="flex flex-wrap gap-4 text-xs"><span className="text-paper">{briefs.length} production briefs</span><span className="text-teal">{counts.approved} approved</span><span className="text-warn">{counts.review} need review</span></div><p className="mt-2 text-2xs text-paper-3">Approved static, carousel, and story briefs support AI image production. Reels remain human-only.</p></div>{error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}{!briefs.length ? <div className="rounded-[10px] border border-dashed border-line p-10 text-center"><div className="text-sm text-paper">No production briefs yet.</div><div className="mt-2 text-xs text-paper-3">Generate a brief from a Master asset.</div></div> : <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">{briefs.map((brief) => { const assignment = latestAssignments[brief.id]; return <article key={brief.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"><span className="w-28 shrink-0 font-mono text-2xs text-teal">{brief.source_ref}</span><div className="min-w-[240px] flex-1"><div className="break-words text-xs text-paper">{brief.title}</div><div className="mt-1 text-2xs text-paper-3">{brief.asset_format.replaceAll("_", " ")} · {brief.production_status.replaceAll("_", " ")} · v{brief.version} · {new Date(brief.updated_at).toLocaleString()}</div>{assignment && <div className={`mt-1 text-2xs ${assignment.status === "failed" ? "text-neg" : "text-paper-3"}`}>{assignment.contractors?.name ?? "Contractor"} · {assignment.status}{assignment.sent_at ? ` · sent ${new Date(assignment.sent_at).toLocaleString()}` : ""}</div>}</div><StateBadge state={brief.status} /><Button size="sm" variant="ghost" onClick={() => setOpen(brief)}>View / Edit</Button></article>; })}</div>}{open && <ProductionBriefModal initialBrief={open} onClose={() => setOpen(null)} onUpdated={accept} onAssignment={(assignment) => setLatestAssignments((current) => ({ ...current, [assignment.production_brief_id]: assignment }))} onViewAssets={onViewAssets} />}</div>;
}
