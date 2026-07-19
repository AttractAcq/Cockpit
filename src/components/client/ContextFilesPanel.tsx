import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Panel } from "@/components/primitives";
import {
  fetchClientContextFile,
  fetchClientContextFiles,
  fetchContextUpdateProposals,
  fetchContextPatchDrafts,
  generatePhase1File,
  logActivity,
  updateContextFileContent,
  updateContextFileStatus,
} from "@/lib/api";
import { CONTEXT_FILE_DEFS } from "@/types/phase";
import type { ClientContextFile, ClientContextPatchDraft, ClientContextUpdateProposal, ContextFileStatus } from "@/types/phase";
import { isContextPatchStale } from "@/lib/context-patch-application";
import { ROUTES } from "@/lib/constants";

type ViewMode = "preview" | "edit" | "split";
type Filter = "all" | "approved" | "needs_review" | "needs_client_input";
type Notice = { type: "success" | "error" | "info"; message: string } | null;

const STATUS_COLOUR: Record<ContextFileStatus, string> = {
  not_started: "text-paper-3",
  generating: "text-warn",
  generated: "text-teal",
  needs_review: "text-warn",
  approved: "text-teal",
  needs_client_input: "text-neg",
};

const STATUS_LABEL: Record<ContextFileStatus, string> = {
  not_started: "Missing",
  generating: "Generating…",
  generated: "Generated",
  needs_review: "Needs Review",
  approved: "Approved",
  needs_client_input: "Needs Client Input",
};

function formatError(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint]
      .filter(Boolean)
      .join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <article className="text-sm text-paper-2 leading-7 break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-2xl text-paper font-semibold mt-1 mb-5 border-b border-line pb-3">{children}</h1>,
          h2: ({ children }) => <h2 className="text-lg text-paper font-semibold mt-8 mb-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-base text-paper font-medium mt-6 mb-2">{children}</h3>,
          h4: ({ children }) => <h4 className="text-sm text-paper font-medium mt-5 mb-2">{children}</h4>,
          p: ({ children }) => <p className="my-3">{children}</p>,
          ul: ({ children }) => <ul className="my-3 ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-3 ml-5 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-paper">{children}</strong>,
          em: ({ children }) => <em className="italic text-paper-2">{children}</em>,
          blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-teal/50 pl-4 text-paper-3 italic">{children}</blockquote>,
          hr: () => <hr className="my-6 border-line" />,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-teal underline underline-offset-2">{children}</a>,
          pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-lg border border-line bg-ink p-4 text-xs leading-6 text-paper">{children}</pre>,
          code: ({ children, className }) => className
            ? <code className={`${className} font-mono`}>{children}</code>
            : <code className="rounded bg-ink px-1.5 py-0.5 font-mono text-xs text-teal">{children}</code>,
          table: ({ children }) => <div className="my-5 overflow-x-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-ink-100 text-paper">{children}</thead>,
          th: ({ children }) => <th className="border border-line px-3 py-2 text-left font-medium">{children}</th>,
          td: ({ children }) => <td className="border border-line px-3 py-2 align-top">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}

function ContentDrawer({
  initialFile,
  initialMode,
  onClose,
  onUpdated,
}: {
  initialFile: ClientContextFile;
  initialMode: ViewMode;
  onClose: () => void;
  onUpdated: (file: ClientContextFile) => void;
}) {
  const [file, setFile] = useState(initialFile);
  const [draft, setDraft] = useState(initialFile.content_md ?? "");
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [busy, setBusy] = useState<"save" | "reload" | "approve" | "resolve" | "regenerate" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const dirty = draft !== (file.content_md ?? "");

  function acceptUpdated(updated: ClientContextFile) {
    setFile(updated);
    setDraft(updated.content_md ?? "");
    onUpdated(updated);
  }

  function close() {
    if (dirty && !window.confirm("Discard unsaved markdown changes?")) return;
    onClose();
  }

  async function reload() {
    if (dirty && !window.confirm("Reload this file and discard unsaved changes?")) return;
    setBusy("reload");
    setNotice(null);
    try {
      const updated = await fetchClientContextFile(file.client_id, file.file_number);
      acceptUpdated(updated);
      setNotice({ type: "success", message: "Reloaded the latest file from Supabase." });
    } catch (error) {
      setNotice({ type: "error", message: `Reload failed: ${formatError(error)}` });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!dirty || !draft.trim()) return;
    setBusy("save");
    setNotice(null);
    try {
      const updated = await updateContextFileContent(file, draft);
      acceptUpdated(updated);
      setNotice({ type: "success", message: `Changes saved as version ${updated.version}. Review state was not changed.` });
      void logActivity(file.client_id, "context_file_saved", `${file.file_name} markdown edited and saved.`, {
        file_id: file.id,
        file_number: file.file_number,
        version: updated.version,
      });
    } catch (error) {
      setNotice({ type: "error", message: `Save failed: ${formatError(error)}` });
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(next: "needs_review" | "approved") {
    const approving = next === "approved";
    const prompt = approving
      ? "Approve this context file as ready for Phase 2?"
      : "Mark client input requirement as resolved and move this file to needs_review?";
    if (!window.confirm(prompt)) return;
    setBusy(approving ? "approve" : "resolve");
    setNotice(null);
    try {
      const updated = await updateContextFileStatus(file, next);
      acceptUpdated(updated);
      setNotice({
        type: "success",
        message: approving ? "Context file approved for Phase 2." : "Client input requirement resolved. Human review is still required.",
      });
      void logActivity(
        file.client_id,
        approving ? "context_file_approved" : "context_file_client_input_resolved",
        approving ? `${file.file_name} approved for Phase 2.` : `${file.file_name} client input requirement resolved; moved to needs_review.`,
        { file_id: file.id, file_number: file.file_number },
      );
    } catch (error) {
      setNotice({ type: "error", message: `Status update failed: ${formatError(error)}` });
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    if (!window.confirm("Regenerate this file from the current saved Context Inputs? This will replace the current markdown content for this file.")) return;
    setBusy("regenerate");
    setNotice(null);
    try {
      const result = await generatePhase1File(file.client_id, file.file_number, file.file_name);
      if (!result.ok) throw new Error(result.message);
      const updated = await fetchClientContextFile(file.client_id, file.file_number);
      acceptUpdated(updated);
      setNotice({ type: "success", message: `${file.file_name} regenerated. It must be reviewed again before Phase 2.` });
      void logActivity(file.client_id, "context_file_regenerated", `${file.file_name} regenerated individually from saved Context Inputs.`, {
        file_id: file.id,
        file_number: file.file_number,
        status: updated.status,
      });
    } catch (error) {
      setNotice({ type: "error", message: `Regeneration failed: ${formatError(error)}` });
    } finally {
      setBusy(null);
    }
  }

  const editor = (
    <textarea
      aria-label={`${file.file_name} markdown editor`}
      className="block h-full min-h-0 w-full flex-1 resize-none overflow-y-auto border-0 bg-ink p-4 font-mono text-xs leading-6 text-paper outline-none"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      spellCheck={false}
    />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={close}>
      <div className="flex h-[94vh] max-h-[calc(100vh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:h-[90vh] sm:max-h-[calc(100vh-2rem)] sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
        <div className="shrink-0 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xs text-paper-3">#{String(file.file_number).padStart(2, "0")}</span>
            <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-paper">{file.file_name}</h2>
            <span className={`text-2xs font-mono ${STATUS_COLOUR[file.status]}`}>{STATUS_LABEL[file.status]}</span>
            <button onClick={close} className="ml-1 text-sm text-paper-3 hover:text-paper">✕</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs font-mono text-paper-3">
            <span>version {file.version}</span>
            <span>updated {new Date(file.updated_at).toLocaleString()}</span>
            <span>generator {file.generated_by_function ?? "manual"}</span>
            {file.confidence_level && <span>confidence {file.confidence_level}</span>}
            {dirty && <span className="text-warn">unsaved changes</span>}
          </div>
        </div>

        <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 sm:px-5">
          <div className="flex rounded-md border border-line bg-ink p-0.5">
            {(["preview", "edit", "split"] as ViewMode[]).map((option) => (
              <button
                key={option}
                className={`rounded px-2.5 py-1 text-xs capitalize ${mode === option ? "bg-teal/15 text-teal" : "text-paper-3 hover:text-paper"}`}
                onClick={() => setMode(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void reload()}>{busy === "reload" ? "Reloading…" : "Reload File"}</Button>
            <Button size="sm" variant="secondary" disabled={busy !== null || dirty} onClick={() => void regenerate()}>{busy === "regenerate" ? "Regenerating…" : "Regenerate File"}</Button>
            {file.status === "needs_client_input" && (
              <Button size="sm" variant="secondary" disabled={busy !== null || dirty} onClick={() => void changeStatus("needs_review")}>{busy === "resolve" ? "Resolving…" : "Resolve Client Input"}</Button>
            )}
            {file.status === "needs_review" && (
              <Button size="sm" variant="secondary" disabled={busy !== null || dirty} onClick={() => void changeStatus("approved")}>{busy === "approve" ? "Approving…" : "Approve Review"}</Button>
            )}
            {(mode === "edit" || mode === "split") && (
              <>
                <Button size="sm" variant="ghost" disabled={!dirty || busy !== null} onClick={() => setDraft(file.content_md ?? "")}>Reset Changes</Button>
                <Button size="sm" variant="primary" disabled={!dirty || !draft.trim() || busy !== null} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save Changes"}</Button>
              </>
            )}
          </div>
        </div>

        {notice && (
          <div role={notice.type === "error" ? "alert" : "status"} className={`shrink-0 border-b px-5 py-2 text-xs ${notice.type === "error" ? "border-neg/20 bg-neg/5 text-neg" : notice.type === "success" ? "border-teal/20 bg-teal/5 text-teal" : "border-line text-paper-2"}`}>
            {notice.message}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {mode === "preview" && (
            <div className="h-full overflow-y-auto p-5 sm:p-7">
              {draft ? <MarkdownPreview content={draft} /> : <p className="text-xs italic text-paper-3">No content yet.</p>}
            </div>
          )}
          {mode === "edit" && (
            <div className="flex h-full min-h-0 p-4 sm:p-5">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-ink focus-within:border-teal/50">
                {editor}
              </div>
            </div>
          )}
          {mode === "split" && (
            <div className="grid h-full min-h-0 grid-cols-1 grid-rows-2 gap-3 overflow-hidden p-3 min-[900px]:grid-cols-2 min-[900px]:grid-rows-1 min-[900px]:p-4">
              <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-ink">
                <div className="shrink-0 border-b border-line bg-ink-100 px-3 py-2 text-2xs font-medium uppercase tracking-cap text-paper-3">
                  Markdown
                </div>
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden focus-within:ring-1 focus-within:ring-teal/30">
                  {editor}
                </div>
              </section>
              <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-ink-200">
                <div className="shrink-0 border-b border-line bg-ink-100 px-3 py-2 text-2xs font-medium uppercase tracking-cap text-paper-3">
                  Preview
                </div>
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5">
                  <MarkdownPreview content={draft} />
                </div>
              </section>
            </div>
          )}
        </div>

        <div className={`shrink-0 border-t border-line px-5 py-2.5 text-xs ${file.status === "approved" ? "text-teal" : file.status === "needs_client_input" ? "text-neg" : "text-warn"}`}>
          {file.status === "approved" && "Approved for Phase 2."}
          {file.status === "needs_client_input" && "This file requires client input before it can be used downstream."}
          {file.status === "needs_review" && "This file requires human review before Phase 2."}
          {file.status === "generated" && "This generated file requires review before Phase 2."}
        </div>
      </div>
    </div>
  );
}

export function ContextFilesPanel({
  clientId,
  onFilesLoaded,
}: {
  clientId: string;
  onFilesLoaded?: (files: ClientContextFile[]) => void;
}) {
  const [files, setFiles] = useState<ClientContextFile[]>([]);
  const [proposals, setProposals] = useState<ClientContextUpdateProposal[]>([]);
  const [patches, setPatches] = useState<ClientContextPatchDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<{ file: ClientContextFile; mode: ViewMode } | null>(null);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [data,nextProposals,nextPatches] = await Promise.all([fetchClientContextFiles(clientId),fetchContextUpdateProposals(clientId),fetchContextPatchDrafts(clientId)]);
      setFiles(data);
      setProposals(nextProposals);
      setPatches(nextPatches);
      onFilesLoaded?.(data);
      return data;
    } catch (error) {
      setLoadError(formatError(error));
      throw error;
    } finally {
      setLoading(false);
    }
  }, [clientId, onFilesLoaded]);

  useEffect(() => {
    void loadFiles().catch(() => undefined);
  }, [loadFiles]);

  const counts = useMemo(() => ({
    approved: files.filter((file) => file.status === "approved").length,
    needsReview: files.filter((file) => file.status === "needs_review" || file.status === "generated").length,
    needsInput: files.filter((file) => file.status === "needs_client_input").length,
    missing: CONTEXT_FILE_DEFS.length - new Set(files.map((file) => file.file_number)).size,
  }), [files]);
  const latest = files.reduce<string | null>((value, file) => !value || file.updated_at > value ? file.updated_at : value, null);
  const fileProposalItems = proposals.flatMap((proposal) => (proposal.items ?? []).map((item) => ({ proposal, item }))).filter(({ item }) => item.target_file_id);
  const fileMap = new Map(files.map((file) => [file.file_number, file]));
  const visibleDefinitions = CONTEXT_FILE_DEFS.filter((definition) => {
    if (filter === "all") return true;
    const status = fileMap.get(definition.number)?.status ?? "not_started";
    return filter === "needs_review" ? status === "needs_review" || status === "generated" : status === filter;
  });

  function updateLocal(updated: ClientContextFile) {
    const next = files.map((file) => file.id === updated.id ? updated : file);
    setFiles(next);
    setOpen((current) => current ? { ...current, file: updated } : current);
    onFilesLoaded?.(next);
  }

  if (loading && files.length === 0) return <div className="p-6 text-xs text-paper-3">Loading context files…</div>;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <span className="text-paper"><span className="text-teal">{files.length}</span><span className="text-paper-3"> total</span></span>
          <span className="text-teal">{counts.approved} approved</span>
          <span className="text-warn">{counts.needsReview} needs review</span>
          <span className="text-neg">{counts.needsInput} needs client input</span>
          <span className={counts.missing ? "text-neg" : "text-paper-3"}>{counts.missing} missing</span>
          <span className="ml-auto text-2xs font-mono text-paper-3">Last generated {latest ? new Date(latest).toLocaleString() : "—"}</span>
        </div>
        {files.length === CONTEXT_FILE_DEFS.length && counts.approved !== CONTEXT_FILE_DEFS.length && (
          <p className="mt-2 text-2xs text-warn">Phase 2 blocked: approve or resolve all context files first.</p>
        )}
        {proposals.length > 0 && <p className="mt-2 text-2xs text-paper-3">Proposal only — {proposals.filter((proposal)=>proposal.status==="needs_review"||proposal.status==="approved").length} open context update proposal{proposals.filter((proposal)=>proposal.status==="needs_review"||proposal.status==="approved").length===1?"":"s"}; no context file is edited from this indicator.</p>}
        {patches.length > 0 && <p className="mt-1 text-2xs text-paper-3">Context patches — {patches.filter((patch)=>patch.status==="draft"||patch.status==="needs_review").length} draft/review · {patches.filter((patch)=>patch.status==="approved").length} approved · {patches.filter((patch)=>patch.status==="applied").length} applied. Patch actions remain in Performance &amp; Iteration.</p>}
      </div>

      {loadError && <div className="rounded-md border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg" role="alert">Could not load context files: {loadError}</div>}

      <div className="flex flex-wrap gap-1.5">
        {([
          ["all", `All (${CONTEXT_FILE_DEFS.length})`],
          ["approved", `Approved (${counts.approved})`],
          ["needs_review", `Needs Review (${counts.needsReview})`],
          ["needs_client_input", `Needs Client Input (${counts.needsInput})`],
        ] as Array<[Filter, string]>).map(([value, label]) => (
          <button key={value} onClick={() => setFilter(value)} className={`rounded-md border px-2.5 py-1 text-xs ${filter === value ? "border-teal/30 bg-teal/10 text-teal" : "border-line text-paper-3 hover:text-paper"}`}>{label}</button>
        ))}
      </div>

      <Panel title="21 Client Context OS Files" meta={`${visibleDefinitions.length} shown`}>
        {visibleDefinitions.map((definition, index) => {
          const file = fileMap.get(definition.number);
          const status: ContextFileStatus = file?.status ?? "not_started";
          const affecting = file ? fileProposalItems.filter(({item})=>item.target_file_id===file.id) : [];
          const filePatches = file ? patches.filter((patch)=>patch.target_file_id===file.id) : [];
          const stalePatches = file ? filePatches.filter((patch)=>isContextPatchStale(patch,file)) : [];
          return (
            <div key={definition.number} className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 ${index < visibleDefinitions.length - 1 ? "border-b border-line" : ""}`}>
              <span className="w-5 shrink-0 text-right font-mono text-2xs text-paper-3">{String(definition.number).padStart(2, "0")}</span>
              <div className="min-w-[220px] flex-1">
                <div className="text-xs text-paper">{definition.file_name}</div>
                <div className="text-2xs text-paper-3">{definition.title}</div>
              </div>
              {file && <span className="text-2xs font-mono text-paper-3">v{file.version}</span>}
              {file && <span className="hidden text-2xs text-paper-3 md:inline">{new Date(file.updated_at).toLocaleString()}</span>}
              {file && <span className="hidden max-w-36 truncate text-2xs text-paper-3 lg:inline">{file.generated_by_function ?? "manual"}</span>}
              <span className={`shrink-0 text-2xs font-mono ${STATUS_COLOUR[status]}`}>{STATUS_LABEL[status]}</span>
              {affecting.length>0&&<span className="shrink-0 rounded border border-warn/20 bg-warn/5 px-1.5 py-0.5 text-2xs text-warn">proposals {affecting.length} · open {affecting.filter(({proposal})=>proposal.status==="needs_review").length} · approved {affecting.filter(({proposal})=>proposal.status==="approved").length} · converted {affecting.filter(({proposal})=>proposal.status==="converted_to_patch").length}</span>}
              {filePatches.length>0&&<a href={ROUTES.clientSection(clientId,"performance-iteration")} className="shrink-0 rounded border border-teal/20 bg-teal/5 px-1.5 py-0.5 text-2xs text-teal">patches {filePatches.length} · approved {filePatches.filter((patch)=>patch.status==="approved").length} · applied {filePatches.filter((patch)=>patch.status==="applied").length}{stalePatches.length?" · stale "+stalePatches.length:""}</a>}
              {file && (
                <div className="flex items-center gap-2">
                  <button className="text-2xs text-teal hover:underline" onClick={() => setOpen({ file, mode: "preview" })}>View</button>
                  <button className="text-2xs text-teal hover:underline" onClick={() => setOpen({ file, mode: "edit" })}>Edit</button>
                </div>
              )}
            </div>
          );
        })}
        {visibleDefinitions.length === 0 && <div className="px-4 py-8 text-center text-xs text-paper-3">No files match this filter.</div>}
      </Panel>

      {open && (
        <ContentDrawer
          initialFile={open.file}
          initialMode={open.mode}
          onClose={() => setOpen(null)}
          onUpdated={updateLocal}
        />
      )}
    </div>
  );
}
