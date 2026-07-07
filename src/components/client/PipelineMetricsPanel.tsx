import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/primitives";
import { fetchPipelineMetrics, type PipelineMetrics } from "@/lib/api";

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

const STAGE_TILES: Array<{ key: keyof PipelineMetrics["active"]; label: string }> = [
  { key: "master", label: "Masters" },
  { key: "content_creation", label: "Content Creation" },
  { key: "assets", label: "Assets" },
  { key: "distribution", label: "Distribution" },
  { key: "analytics", label: "Analytics" },
  { key: "analysis", label: "Analysis / Iteration" },
  { key: "completed", label: "Completed Runs" },
];

const TOTAL_TILES: Array<{ key: keyof PipelineMetrics["totals"]; label: string }> = [
  { key: "entered", label: "Refs entered pipeline" },
  { key: "produced", label: "Produced assets" },
  { key: "approved", label: "Approved assets" },
  { key: "distributionReady", label: "Distribution-ready" },
  { key: "scheduled", label: "Scheduled" },
  { key: "published", label: "Published" },
  { key: "analyticsComplete", label: "Analytics complete" },
];

/**
 * H4 Pipeline: active-per-stage counts + lifecycle totals for the client, all
 * derived from real records (pipeline state, effective stage map, masters,
 * distribution + analytics records). No invented numbers.
 */
export function PipelineMetricsPanel({ clientId, executionMonth }: { clientId: string; executionMonth: string }) {
  const [metrics, setMetrics] = useState<PipelineMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setMetrics(await fetchPipelineMetrics(clientId, executionMonth)); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => { void load(); }; window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);

  if (loading && !metrics) return <div className="p-6 text-xs text-paper-3">Loading pipeline metrics…</div>;
  return <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
    <div className="flex items-center gap-3">
      <div><div className="text-sm text-paper">Pipeline</div><div className="mt-1 text-2xs text-paper-3">Active assets per lifecycle stage · {executionMonth}</div></div>
      <Button size="sm" variant="ghost" className="ml-auto" disabled={loading} onClick={() => void load()}>{loading ? "Reloading…" : "Reload"}</Button>
    </div>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {metrics && <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {STAGE_TILES.map(({ key, label }) => (
          <div key={key} className="rounded-[10px] border border-line bg-ink-200 p-4">
            <div className="font-mono text-2xl text-teal">{metrics.active[key]}</div>
            <div className="mt-1 text-2xs text-paper-3">{label}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="mb-2 text-2xs uppercase tracking-wide text-paper-3">Lifecycle totals</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {TOTAL_TILES.map(({ key, label }) => (
            <div key={key} className="rounded-[10px] border border-line bg-ink-200 p-4">
              <div className="font-mono text-xl text-paper">{metrics.totals[key]}</div>
              <div className="mt-1 text-2xs text-paper-3">{label}</div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-2xs text-paper-3">Active counts show refs whose current effective stage is that stage. Totals are cumulative across the month. All figures are derived from live records — none are invented.</p>
    </>}
  </div>;
}
