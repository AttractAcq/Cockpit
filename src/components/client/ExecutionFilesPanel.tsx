import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Panel } from "@/components/primitives";
import {
  fetchClientExecutionFile,
  fetchClientExecutionFiles,
  logActivity,
  regenerateExecutionFile,
  updateExecutionFileContent,
  updateExecutionFileReviewState,
} from "@/lib/api";
import type { ClientExecutionFile, Phase2Section } from "@/types/phase";
import type { ReviewState } from "@/types/client";
import { EXECUTION_FILE_COUNT, EXECUTION_FILE_MANIFEST, EXECUTION_GROUP_ORDER, executionDefinitionByNumber } from "../../../supabase/functions/_shared/execution-manifest";

type ViewMode = "preview" | "edit" | "split";
type Filter = "all" | ReviewState;
type Notice = { kind: "success" | "error"; message: string } | null;

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
  return <span className={`shrink-0 rounded border px-1.5 py-0.5 text-2xs font-mono ${STATE_STYLE[state]}`}>{state.replaceAll("_", " ")}</span>;
}

function canonicalDefinition(file: Pick<ClientExecutionFile, "file_number" | "file_name">) {
  const definition = executionDefinitionByNumber(file.file_number ?? -1);
  return definition?.fileName === file.file_name ? definition : undefined;
}

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <article className="break-words text-sm leading-7 text-paper-2">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        h1: ({ children }) => <h1 className="mb-5 mt-1 border-b border-line pb-3 text-2xl font-semibold text-paper">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-3 mt-8 text-lg font-semibold text-paper">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-6 text-base font-medium text-paper">{children}</h3>,
        p: ({ children }) => <p className="my-3">{children}</p>,
        ul: ({ children }) => <ul className="my-3 ml-5 list-disc space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="my-3 ml-5 list-decimal space-y-1">{children}</ol>,
        blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-teal/50 pl-4 italic text-paper-3">{children}</blockquote>,
        pre: ({ children }) => <pre className="my-4 overflow-x-auto rounded-lg border border-line bg-ink p-4 text-xs leading-6 text-paper">{children}</pre>,
        code: ({ children }) => <code className="rounded bg-ink px-1 py-0.5 font-mono text-xs text-teal">{children}</code>,
        table: ({ children }) => <div className="my-5 overflow-x-auto"><table className="min-w-full border-collapse text-xs">{children}</table></div>,
        th: ({ children }) => <th className="border border-line px-3 py-2 text-left text-paper">{children}</th>,
        td: ({ children }) => <td className="border border-line px-3 py-2 align-top">{children}</td>,
      }}>{content}</ReactMarkdown>
    </article>
  );
}

export function ExecutionFileModal({ initialFile, initialMode, onClose, onUpdated }: {
  initialFile: ClientExecutionFile;
  initialMode: ViewMode;
  onClose: () => void;
  onUpdated: (file: ClientExecutionFile) => void;
}) {
  const [file, setFile] = useState(initialFile);
  const [draft, setDraft] = useState(initialFile.content_md ?? "");
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const dirty = draft !== (file.content_md ?? "");

  function accept(next: ClientExecutionFile) {
    setFile(next);
    setDraft(next.content_md ?? "");
    onUpdated(next);
  }

  function close() {
    if (dirty && !window.confirm("Discard unsaved execution-file changes?")) return;
    onClose();
  }

  async function reload() {
    if (dirty && !window.confirm("Reload from Supabase and discard unsaved changes?")) return;
    setBusy("reload"); setNotice(null);
    try {
      accept(await fetchClientExecutionFile(file.client_id, file.month, file.file_number ?? 0));
      setNotice({ kind: "success", message: "Reloaded the latest execution file." });
    } catch (error) { setNotice({ kind: "error", message: errorText(error) }); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!dirty || !draft.trim()) return;
    setBusy("save"); setNotice(null);
    try {
      const next = await updateExecutionFileContent(file, draft);
      accept(next);
      setNotice({ kind: "success", message: `Saved version ${next.version}.${file.review_state === "approved" ? " Review reset to needs_review." : ""}` });
      void logActivity(file.client_id, "execution_file_saved", `${file.file_name} edited and saved.`, { file_id: file.id, version: next.version });
    } catch (error) { setNotice({ kind: "error", message: errorText(error) }); }
    finally { setBusy(null); }
  }

  async function approve() {
    if (dirty || !window.confirm("Approve this execution file as ready for Phase 3?")) return;
    setBusy("approve"); setNotice(null);
    try {
      const next = await updateExecutionFileReviewState(file.id, "approved");
      accept(next);
      setNotice({ kind: "success", message: "Execution file approved for Phase 3." });
      void logActivity(file.client_id, "execution_file_approved", `${file.file_name} approved for Phase 3.`, { file_id: file.id });
    } catch (error) { setNotice({ kind: "error", message: errorText(error) }); }
    finally { setBusy(null); }
  }

  async function regenerate() {
    const section = canonicalDefinition(file)?.code as Phase2Section | undefined;
    if (!section || dirty || !window.confirm("Regenerate only this execution file from the approved Context Files? Current markdown will be replaced.")) return;
    setBusy("regenerate"); setNotice(null);
    try {
      const result = await regenerateExecutionFile(file.client_id, file.month, section);
      if (!result.ok) throw new Error(result.message);
      const next = await fetchClientExecutionFile(file.client_id, file.month, file.file_number ?? 0);
      accept(next);
      setNotice({ kind: "success", message: "Execution file regenerated and returned to needs_review." });
    } catch (error) { setNotice({ kind: "error", message: errorText(error) }); }
    finally { setBusy(null); }
  }

  const editor = <textarea aria-label={`${file.file_name} markdown editor`} className="h-full min-h-0 w-full flex-1 resize-none overflow-y-auto bg-ink p-4 font-mono text-xs leading-6 text-paper outline-none" value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} />;
  const definition = canonicalDefinition(file);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center" onClick={close}>
      <div className="flex h-[94vh] max-h-[calc(100vh-1rem)] w-full max-w-6xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:h-[90vh] sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
        <header className="shrink-0 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xs text-teal">{definition?.code ?? `#${String(file.file_number ?? 0).padStart(2, "0")}`}</span>
            <div className="min-w-0 flex-1"><h2 className="break-words text-sm font-medium text-paper">{file.file_name}</h2>{definition && <div className="mt-0.5 text-2xs text-paper-3">{definition.title} · {definition.group}</div>}</div>
            <StateBadge state={file.review_state} />
            <button onClick={close} className="text-paper-3 hover:text-paper">✕</button>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-2xs font-mono text-paper-3">
            <span>version {file.version}</span><span>updated {new Date(file.updated_at).toLocaleString()}</span>
            <span>generator {file.generated_by_function ?? "manual"}</span>{definition && <><span>confidence {definition.confidence}</span><span>baseline {definition.statusBaseline}</span></>}{dirty && <span className="text-warn">unsaved changes</span>}
          </div>
        </header>
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 sm:px-5">
          <div className="flex rounded-md border border-line bg-ink p-0.5">{(["preview", "edit", "split"] as ViewMode[]).map((value) => <button key={value} onClick={() => setMode(value)} className={`rounded px-2.5 py-1 text-xs capitalize ${mode === value ? "bg-teal/15 text-teal" : "text-paper-3"}`}>{value}</button>)}</div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void reload()}>{busy === "reload" ? "Reloading…" : "Reload File"}</Button>
            <Button size="sm" variant="secondary" disabled={!definition || busy !== null || dirty} onClick={() => void regenerate()}>{busy === "regenerate" ? "Regenerating…" : "Regenerate File"}</Button>
            {file.review_state === "needs_review" && <Button size="sm" variant="secondary" disabled={busy !== null || dirty} onClick={() => void approve()}>{busy === "approve" ? "Approving…" : "Approve Review"}</Button>}
            {(mode === "edit" || mode === "split") && <><Button size="sm" variant="ghost" disabled={!dirty || busy !== null} onClick={() => setDraft(file.content_md ?? "")}>Reset Changes</Button><Button size="sm" variant="primary" disabled={!dirty || !draft.trim() || busy !== null} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save Changes"}</Button></>}
          </div>
        </div>
        {notice && <div role={notice.kind === "error" ? "alert" : "status"} className={`shrink-0 border-b px-5 py-2 text-xs ${notice.kind === "error" ? "border-neg/20 bg-neg/5 text-neg" : "border-teal/20 bg-teal/5 text-teal"}`}>{notice.message}</div>}
        <main className="min-h-0 flex-1 overflow-hidden">
          {mode === "preview" && <div className="h-full overflow-y-auto p-5 sm:p-7"><MarkdownPreview content={draft} /></div>}
          {mode === "edit" && <div className="flex h-full min-h-0 p-4"><div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-line">{editor}</div></div>}
          {mode === "split" && <div className="grid h-full min-h-0 grid-cols-1 grid-rows-2 gap-3 overflow-hidden p-3 min-[900px]:grid-cols-2 min-[900px]:grid-rows-1">
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line"><div className="shrink-0 border-b border-line px-3 py-2 text-2xs uppercase text-paper-3">Markdown</div><div className="flex min-h-0 flex-1">{editor}</div></section>
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line"><div className="shrink-0 border-b border-line px-3 py-2 text-2xs uppercase text-paper-3">Preview</div><div className="min-h-0 flex-1 overflow-y-auto p-5"><MarkdownPreview content={draft} /></div></section>
          </div>}
        </main>
        <footer className={`shrink-0 border-t border-line px-5 py-2.5 text-xs ${file.review_state === "approved" ? "text-teal" : "text-warn"}`}>{file.review_state === "approved" ? "Approved for Phase 3." : "Human review is required before Phase 3."}</footer>
      </div>
    </div>
  );
}

export function ExecutionFilesPanel({ clientId, executionMonth, onFilesLoaded }: { clientId: string; executionMonth: string; onFilesLoaded?: (files: ClientExecutionFile[]) => void }) {
  const [files, setFiles] = useState<ClientExecutionFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<{ file: ClientExecutionFile; mode: ViewMode } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(EXECUTION_GROUP_ORDER.map((group) => [group, true])));

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const next = await fetchClientExecutionFiles(clientId, executionMonth); setFiles(next); onFilesLoaded?.(next); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId, executionMonth, onFilesLoaded]);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({ approved: files.filter((file) => file.review_state === "approved").length, needsReview: files.filter((file) => file.review_state === "needs_review").length }), [files]);
  const visible = filter === "all" ? files : files.filter((file) => file.review_state === filter);
  function accept(updated: ClientExecutionFile) {
    const next = files.map((file) => file.id === updated.id ? updated : file);
    setFiles(next); setOpen((current) => current ? { ...current, file: updated } : current); onFilesLoaded?.(next);
  }

  function fileRow(file: ClientExecutionFile) {
    const definition = canonicalDefinition(file);
    return <div key={file.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <span className="w-8 font-mono text-2xs text-teal">{definition?.code ?? `#${String(file.file_number ?? 0).padStart(2, "0")}`}</span>
      <div className="min-w-[220px] flex-1">
        <div className="break-words text-xs text-paper">{file.file_name}</div>
        <div className="mt-0.5 text-2xs text-paper-3">{definition ? `${definition.title} · ${definition.group} · confidence ${definition.confidence}` : "Legacy / non-canonical file"}</div>
        <div className="mt-0.5 text-2xs text-paper-3">v{file.version} · {new Date(file.updated_at).toLocaleString()} · {file.generated_by_function ?? "manual"}</div>
      </div>
      <StateBadge state={file.review_state} />
      <button className="text-2xs text-teal hover:underline" onClick={() => setOpen({ file, mode: "preview" })}>View</button>
      <button className="text-2xs text-teal hover:underline" onClick={() => setOpen({ file, mode: "edit" })}>Edit</button>
    </div>;
  }

  if (loading && files.length === 0) return <div className="p-6 text-xs text-paper-3">Loading execution files…</div>;
  return <div className="flex-1 space-y-3 overflow-y-auto p-4">
    <div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3 text-xs"><div className="flex flex-wrap gap-4"><span className="text-paper">{files.length} / {EXECUTION_FILE_COUNT} canonical files</span><span className="text-teal">{counts.approved} approved</span><span className="text-warn">{counts.needsReview} need review</span></div>{(files.length !== EXECUTION_FILE_COUNT || counts.approved !== EXECUTION_FILE_COUNT) && <p className="mt-2 text-2xs text-warn">Phase 3 blocked: all 11 canonical Execution Files must exist and be approved.</p>}</div>
    {error && <div role="alert" className="rounded-md border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    <div className="flex gap-1.5">{(["all", "approved", "needs_review"] as Filter[]).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded border px-2.5 py-1 text-xs ${filter === value ? "border-teal/30 bg-teal/10 text-teal" : "border-line text-paper-3"}`}>{value.replaceAll("_", " ")}</button>)}</div>
    {EXECUTION_GROUP_ORDER.map((group) => {
      const grouped = visible.filter((file) => canonicalDefinition(file)?.group === group);
      const groupApproved = grouped.filter((file) => file.review_state === "approved").length;
      const groupNeedsReview = grouped.filter((file) => file.review_state === "needs_review").length;
      const groupNeedsInput = grouped.filter((file) => (file.review_state as string) === "needs_client_input").length;
      return grouped.length ? <section key={group} className="shrink-0 overflow-hidden rounded-[10px] border border-line bg-ink-200">
        <button aria-expanded={expandedGroups[group]} onClick={() => setExpandedGroups((current) => ({ ...current, [group]: !current[group] }))} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-ink-100">
          <span className="text-2xs text-paper-3">{expandedGroups[group] ? "▼" : "▶"}</span><span className="text-2xs font-medium uppercase tracking-wide text-paper-2">{group}</span>
          <span className="ml-auto font-mono text-2xs text-paper-3">{grouped.length} files</span><span className="font-mono text-2xs text-teal">{groupApproved} approved</span><span className="font-mono text-2xs text-warn">{groupNeedsReview} need review</span>{groupNeedsInput > 0 && <span className="font-mono text-2xs text-neg">{groupNeedsInput} need client input</span>}
        </button>
        {expandedGroups[group] && <div className="border-t border-line">{grouped.map(fileRow)}</div>}
      </section> : null;
    })}
    {visible.some((file) => !canonicalDefinition(file)) && <Panel title="Legacy / Non-canonical" meta="replaced on next Phase 2 run" className="shrink-0">{visible.filter((file) => !canonicalDefinition(file)).map(fileRow)}</Panel>}
    {open && <ExecutionFileModal initialFile={open.file} initialMode={open.mode} onClose={() => setOpen(null)} onUpdated={accept} />}
  </div>;
}
