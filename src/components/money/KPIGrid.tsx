import { useEffect, useState } from "react";
import { EmptyState, Sparkline } from "@/components/primitives";
import { api } from "@/lib/api";
import type { PulseMetric } from "@/types";

function SkeletonKPI() {
  return (
    <div className="bg-ink-200 border border-line rounded-[10px] px-3.5 py-3 flex flex-col gap-2 animate-pulse">
      <div className="h-2.5 w-16 bg-ink-100 rounded" />
      <div className="h-7 w-24 bg-ink-100 rounded" />
      <div className="flex items-center justify-between gap-2 mt-auto">
        <div className="h-3 w-12 bg-ink-100 rounded" />
        <div className="h-4 w-16 bg-ink-100 rounded" />
      </div>
    </div>
  );
}

export function KPIGrid() {
  const [metrics, setMetrics] = useState<PulseMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.pulse.metrics()
      .then((m) => setMetrics(m))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-5 gap-3">
        {[0, 1, 2, 3, 4].map((i) => <SkeletonKPI key={i} />)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-3 text-xs text-neg bg-neg-dim border border-neg/30 rounded-lg">
        KPI load failed: {error}
      </div>
    );
  }

  if (metrics.length === 0) {
    return (
      <div className="col-span-5">
        <EmptyState icon="money" title="No metrics yet" body="KPIs will appear once MRR data is available." />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-5 gap-3">
      {metrics.map((m, i) => {
        const deltaColor = m.trend === "flat" ? "text-paper-3" : m.trend_is_good ? "text-teal" : "text-warn";
        const sparkColor: "teal" | "warn" = m.trend === "flat" ? "teal" : m.trend_is_good ? "teal" : "warn";
        return (
          <div
            key={`${m.key}-${i}`}
            className="bg-ink-200 border border-line rounded-[10px] px-3.5 py-3 flex flex-col gap-2"
          >
            <div className="text-[9.5px] uppercase tracking-cap text-paper-3">{m.label}</div>
            <div className="font-serif text-[24px] text-paper leading-none">{m.display_value}</div>
            <div className="flex items-center justify-between gap-2 mt-auto">
              <span className={`text-2xs ${deltaColor}`}>{m.delta_display} {m.delta_label}</span>
              <div className="w-16">
                <Sparkline values={m.sparkline} color={sparkColor} height={16} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
