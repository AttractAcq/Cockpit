import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState } from "@/components/primitives";
import { fetchClientExecutionFiles } from "@/lib/api";
import type { ClientExecutionFile } from "@/types/phase";
import { ExecutionFileModal, MarkdownPreview } from "./ExecutionFilesPanel";

const E11_NAME = "11_Stage_2_SOP_and_Laws.md";

export function SopsLawsPanel({ clientId, executionMonth }: { clientId: string; executionMonth: string }) {
  const [file, setFile] = useState<ClientExecutionFile | null>(null);
  const [mode, setMode] = useState<"preview" | "edit" | "split" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const files = await fetchClientExecutionFiles(clientId, executionMonth);
      setFile(files.find((candidate) => candidate.file_number === 11 && candidate.file_name === E11_NAME) ?? null);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-6 text-xs text-paper-3">Loading Stage 2 SOP and Laws…</div>;
  if (error) return <div role="alert" className="m-4 rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>;
  if (!file) return <div className="flex flex-1 items-center justify-center p-8"><EmptyState icon="clock" title="Stage 2 SOP and Laws has not been generated" body="Run Phase 2 first." /></div>;

  return <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-4">
    <header className="shrink-0 rounded-t-[10px] border border-line bg-ink-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3"><span className="font-mono text-2xs text-teal">E11</span><div className="min-w-0 flex-1"><h2 className="break-words text-sm font-medium text-paper">{file.file_name}</h2><div className="mt-1 text-2xs text-paper-3">Governance · version {file.version} · updated {new Date(file.updated_at).toLocaleString()} · {file.generated_by_function ?? file.generated_by_agent ?? "manual"}</div></div><span className={`rounded border px-1.5 py-0.5 text-2xs font-mono ${file.review_state === "approved" ? "border-teal/20 bg-teal/10 text-teal" : "border-warn/20 bg-warn/10 text-warn"}`}>{file.review_state.replaceAll("_", " ")}</span></div>
      <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => setMode("preview")}>Preview</Button><Button size="sm" variant="secondary" onClick={() => setMode("edit")}>Edit</Button><Button size="sm" variant="secondary" onClick={() => setMode("split")}>Split</Button><Button size="sm" variant="ghost" onClick={() => void load()}>Reload File</Button></div>
      {file.review_state !== "approved" && <p className="mt-2 text-2xs text-warn">This governance document requires human review before Phase 3.</p>}
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto rounded-b-[10px] border border-t-0 border-line bg-ink-200 p-5 sm:p-7"><MarkdownPreview content={file.content_md ?? ""} /></div>
    {mode && <ExecutionFileModal initialFile={file} initialMode={mode} onClose={() => setMode(null)} onUpdated={(next) => setFile(next)} />}
  </div>;
}
