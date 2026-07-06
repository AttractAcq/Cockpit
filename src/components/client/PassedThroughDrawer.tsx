import { useEffect } from "react";
import { Button } from "@/components/primitives";
import type { EffectiveStageEntry } from "@/lib/api";
import type { PipelineStage } from "@/types/phase";
import { STAGE_LABEL } from "@/lib/pipeline";

/**
 * A subtle, tab-local "passed through" view. It lists records that have advanced
 * beyond this tab's stage — the source rows still live in their own tables; this
 * is only lifecycle memory scoped to one tab. The full cross-stage Archive is a
 * separate H4 surface, reached via "View in Full Archive".
 */
export function PassedThroughDrawer({
  tabStage,
  entries,
  onClose,
  onViewFullArchive,
}: {
  tabStage: PipelineStage;
  entries: EffectiveStageEntry[];
  onClose: () => void;
  onViewFullArchive?: (sourceRef: string) => void;
}) {
  useEffect(() => {
    function onEscape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [onClose]);

  const sorted = [...entries].sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <div className="fixed inset-0 z-[65] flex justify-end bg-black/60" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`${STAGE_LABEL[tabStage]} passed-through records`}
        className="flex h-full w-full max-w-lg flex-col border-l border-line bg-ink-200 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-line px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium text-paper">Passed Through · {STAGE_LABEL[tabStage]}</h2>
              <p className="mt-1 text-2xs text-paper-3">
                Records that have moved on from this stage. Source rows remain in their original tables.
              </p>
            </div>
            <button aria-label="Close" onClick={onClose} className="text-paper-3 hover:text-paper">✕</button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {sorted.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-line p-8 text-center text-xs text-paper-3">
              Nothing has passed through this stage yet.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {sorted.map((entry) => (
                <li key={entry.source_ref} className="rounded-[10px] border border-line bg-ink p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-2xs text-teal">{entry.source_ref}</span>
                    {entry.asset_format && (
                      <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">
                        {entry.asset_format.replaceAll("_", " ")}
                      </span>
                    )}
                    <span className="rounded border border-teal/20 bg-teal/10 px-1.5 py-0.5 font-mono text-2xs text-teal">
                      now: {STAGE_LABEL[entry.stage]}
                    </span>
                  </div>
                  {entry.title && <div className="mt-1.5 break-words text-xs text-paper">{entry.title}</div>}
                  <div className="mt-1.5 text-2xs text-paper-3">
                    Left after {STAGE_LABEL[tabStage]}
                    {entry.state?.previous_stage ? ` · from ${STAGE_LABEL[entry.state.previous_stage]}` : ""}
                    {" · "}
                    {entry.state
                      ? `snapshot on record${entry.state.transition_reason ? ` (${entry.state.transition_reason.replaceAll("_", " ")})` : ""}`
                      : "reconciled from records (no snapshot captured)"}
                  </div>
                  <div className="mt-1 text-2xs font-mono text-paper-3">
                    updated {new Date(entry.updated_at).toLocaleString()}
                  </div>
                  {onViewFullArchive && (
                    <div className="mt-2 flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => onViewFullArchive(entry.source_ref)}>
                        View in Full Archive →
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="shrink-0 border-t border-line px-5 py-3 text-2xs text-paper-3">
          {sorted.length} record{sorted.length === 1 ? "" : "s"} · full lifecycle detail arrives in the Archive tab (H4).
        </footer>
      </aside>
    </div>
  );
}
