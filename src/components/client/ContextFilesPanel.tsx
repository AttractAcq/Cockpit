import { useEffect, useState } from "react";
import { Panel } from "@/components/primitives";
import { fetchClientContextFiles } from "@/lib/api";
import { CONTEXT_FILE_DEFS } from "@/types/phase";
import type { ClientContextFile, ContextFileStatus } from "@/types/phase";

const STATUS_COLOUR: Record<ContextFileStatus, string> = {
  not_started:       "text-paper-3",
  generating:        "text-warn",
  generated:         "text-teal",
  needs_review:      "text-warn",
  approved:          "text-teal",
  needs_client_input: "text-neg",
};

const STATUS_LABEL: Record<ContextFileStatus, string> = {
  not_started:       "Not Generated",
  generating:        "Generating…",
  generated:         "Generated",
  needs_review:      "Needs Review",
  approved:          "Approved",
  needs_client_input: "Needs Client Input",
};

function ContentDrawer({
  file,
  onClose,
}: {
  file: ClientContextFile;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-ink-200 border border-line rounded-t-[16px] sm:rounded-[16px] w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-line flex items-center gap-3">
          <span className="text-xs font-medium text-paper flex-1 truncate">
            {file.file_name}
          </span>
          <span
            className={`text-2xs font-mono ${STATUS_COLOUR[file.status]}`}
          >
            {STATUS_LABEL[file.status]}
          </span>
          {file.confidence_level && (
            <span className="text-2xs font-mono text-paper-3">
              conf: {file.confidence_level}
            </span>
          )}
          <button
            onClick={onClose}
            className="text-paper-3 hover:text-paper text-xs ml-1"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {file.content_md ? (
            <pre className="text-xs text-paper font-mono whitespace-pre-wrap leading-relaxed">
              {file.content_md}
            </pre>
          ) : (
            <p className="text-xs text-paper-3 italic">
              No content yet. Run Phase 1 to generate this file.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ContextFilesPanel({ clientId }: { clientId: string }) {
  const [files, setFiles] = useState<ClientContextFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<ClientContextFile | null>(null);

  useEffect(() => {
    let alive = true;
    fetchClientContextFiles(clientId).then((data) => {
      if (alive) { setFiles(data); setLoading(false); }
    }).catch(() => setLoading(false));
    return () => { alive = false; };
  }, [clientId]);

  if (loading)
    return (
      <div className="p-6 text-paper-3 text-xs">Loading context files…</div>
    );

  const fileMap = new Map(files.map((f) => [f.file_number, f]));
  const approvedCount = files.filter((f) => f.status === "approved").length;
  const needsInputCount = files.filter(
    (f) => f.status === "needs_client_input"
  ).length;

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
      {/* Summary */}
      <div className="bg-ink-200 border border-line rounded-[10px] px-4 py-3 flex items-center gap-4 flex-wrap">
        <span className="text-xs text-paper">
          <span className={files.length > 0 ? "text-teal" : "text-paper-3"}>
            {files.length}
          </span>
          <span className="text-paper-3"> / 21 generated</span>
        </span>
        <span className="text-2xs font-mono text-paper-3">
          {approvedCount} approved
          {needsInputCount > 0 && (
            <span className="text-neg"> · {needsInputCount} need client input</span>
          )}
        </span>
        {files.length === 0 && (
          <span className="text-2xs font-mono text-paper-3 ml-auto">
            Run Phase 1 to generate the 21 context files.
          </span>
        )}
      </div>

      {/* File list */}
      <Panel title="21 Client Context OS Files" meta={`${files.length} / 21`}>
        {CONTEXT_FILE_DEFS.map((def, idx) => {
          const file = fileMap.get(def.number);
          const status: ContextFileStatus = file?.status ?? "not_started";
          const canView =
            file && file.status !== "not_started" && file.status !== "generating";

          return (
            <div
              key={def.number}
              className={`px-4 py-3 flex items-center gap-3 ${
                idx < CONTEXT_FILE_DEFS.length - 1 ? "border-b border-line" : ""
              }`}
            >
              <span className="text-2xs font-mono text-paper-3 w-5 text-right shrink-0">
                {String(def.number).padStart(2, "0")}
              </span>
              <span className="text-xs text-paper flex-1">{def.title}</span>
              <span
                className={`text-2xs font-mono shrink-0 ${STATUS_COLOUR[status]}`}
              >
                {STATUS_LABEL[status]}
              </span>
              {canView && (
                <button
                  className="text-2xs text-teal hover:underline shrink-0"
                  onClick={() => setOpen(file)}
                >
                  View
                </button>
              )}
            </div>
          );
        })}
      </Panel>

      {open && <ContentDrawer file={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
