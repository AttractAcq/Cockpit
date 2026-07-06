import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/primitives";
import { fetchEffectiveStageMap, type EffectiveStageEntry } from "@/lib/api";
import { ROUTES } from "@/lib/constants";
import { isActiveInStage, isPassedThrough, STAGE_LABEL } from "@/lib/pipeline";
import { PassedThroughDrawer } from "./PassedThroughDrawer";

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * H2 Distribution: shows refs that have been approved and are now distribution-
 * ready (pipeline stage = distribution). It is intentionally read-only — the
 * publish payload editor, Publish Now / Schedule actions, the shared publish
 * function and the scheduled worker all arrive in H3. Nothing here publishes.
 */
export function DistributionPanel({ clientId, executionMonth, onViewAssets }: { clientId: string; executionMonth: string; onViewAssets?: () => void }) {
  const navigate = useNavigate();
  const [stageMap, setStageMap] = useState<Map<string, EffectiveStageEntry>>(new Map());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setStageMap(await fetchEffectiveStageMap(clientId, executionMonth)); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => { void load(); }; window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);

  const active = useMemo(() => [...stageMap.values()].filter((entry) => isActiveInStage(entry.stage, "distribution")).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [stageMap]);
  const passedThroughEntries = useMemo(() => [...stageMap.values()].filter((entry) => isPassedThrough(entry.stage, "distribution")), [stageMap]);

  if (loading && !stageMap.size) return <div className="p-6 text-xs text-paper-3">Loading distribution queue…</div>;
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="text-paper">{active.length} distribution-ready</span>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={loading} onClick={() => void load()}>{loading ? "Reloading…" : "Reload"}</Button>
        <Button size="sm" variant="ghost" disabled={!passedThroughEntries.length} onClick={() => setDrawerOpen(true)}>Archived / Passed Through{passedThroughEntries.length ? ` (${passedThroughEntries.length})` : ""}</Button>
      </div>
      <p className="mt-2 text-2xs text-paper-3">Approved assets land here as distribution-ready. Publishing (payload editor, Publish Now / Schedule, scheduled worker) arrives in H3 — no publishing happens yet.</p>
    </div>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {!active.length ? (
      <div className="rounded-[10px] border border-dashed border-line p-10 text-center">
        <div className="text-sm text-paper">Nothing is waiting for distribution.</div>
        <div className="mt-2 text-xs text-paper-3">Approve an asset group in the Assets tab to make it distribution-ready.</div>
      </div>
    ) : (
      <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">
        {active.map((entry) => (
          <article key={entry.source_ref} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <span className="w-28 shrink-0 font-mono text-2xs text-teal">{entry.source_ref}</span>
            <div className="min-w-[240px] flex-1">
              <div className="break-words text-xs text-paper">{entry.title ?? entry.source_ref}</div>
              <div className="mt-1 text-2xs text-paper-3">
                {(entry.asset_format ?? "asset").replaceAll("_", " ")} · from {STAGE_LABEL[entry.state?.previous_stage ?? "assets"]} · updated {new Date(entry.updated_at).toLocaleString()}
              </div>
            </div>
            <span className="rounded border border-warn/20 bg-warn/10 px-1.5 py-0.5 font-mono text-2xs text-warn">pending publish</span>
            {onViewAssets && <Button size="sm" variant="ghost" onClick={onViewAssets}>View Asset</Button>}
          </article>
        ))}
      </div>
    )}
    {drawerOpen && <PassedThroughDrawer tabStage="distribution" entries={passedThroughEntries} onClose={() => setDrawerOpen(false)} onViewFullArchive={(sourceRef) => navigate(`${ROUTES.clientSection(clientId, "archive")}?source_ref=${encodeURIComponent(sourceRef)}`)} />}
  </div>;
}
