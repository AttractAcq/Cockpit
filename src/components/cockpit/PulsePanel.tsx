import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, Panel, Sparkline } from "@/components/primitives";
import { api } from "@/lib/api";
import { ROUTES } from "@/lib/constants";
import type { PulseMetric } from "@/types";

export function PulsePanel() {
  const [metrics, setMetrics] = useState<PulseMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.pulse.metrics()
      .then((m) => {
        setMetrics(m.slice(0, 4));
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setMetrics([]);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Panel title="Pulse" meta={loading ? "loading" : "live"}>
      {error && (
        <div className="px-3 py-3 text-xs text-neg bg-neg-dim border-b border-neg/30">
          Pulse read failed: {error}
        </div>
      )}
      {!loading && !error && metrics.length === 0 && (
        <EmptyState icon="trending-up" title="No pulse metrics" body="No live operational metrics are visible yet." />
      )}
      <button onClick={() => navigate(ROUTES.money)} className="grid grid-cols-2 w-full text-left">
        {metrics.map((m, i) => {
          const deltaColor = m.trend === "flat" ? "text-paper-3" : m.trend_is_good ? "text-teal" : "text-warn";
          const sparkColor: "teal" | "warn" = m.trend === "flat" ? "teal" : m.trend_is_good ? "teal" : "warn";
          const borderRight = i % 2 === 0 ? "border-r border-line" : "";
          const borderBottom = i < 2 ? "border-b border-line" : "";
          return (
            <div key={m.key} className={`px-3 py-2.5 flex flex-col gap-1.5 hover:bg-ink-50 cursor-pointer transition-colors ${borderRight} ${borderBottom}`}>
              <div className="text-[9.5px] uppercase tracking-cap text-paper-3">{m.label}</div>
              <div className="font-serif text-[20px] text-paper leading-none">{m.display_value}</div>
              <div className="flex items-center justify-between gap-1.5">
                <span className={`text-2xs ${deltaColor}`}>{m.delta_display} {m.delta_label}</span>
                <div className="w-12">
                  <Sparkline values={m.sparkline} color={sparkColor} height={14} />
                </div>
              </div>
            </div>
          );
        })}
      </button>
    </Panel>
  );
}
