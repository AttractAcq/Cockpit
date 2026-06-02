import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Panel, Sparkline } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import type { PulseMetric } from "@/types";

export function PulsePanel() {
  const [metrics, setMetrics] = useState<PulseMetric[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.pulse.metrics().then((m) => setMetrics(m.slice(0, 4)));
  }, []);

  return (
    <Panel title="Pulse" meta="7-day">
      <button
        onClick={() => navigate(ROUTES.money)}
        className="grid grid-cols-2 w-full text-left"
      >
        {metrics.map((m, i) => {
          const deltaColor =
            m.trend === "flat"
              ? "text-paper-3"
              : m.trend_is_good
                ? "text-teal"
                : "text-warn";
          const sparkColor: "teal" | "warn" =
            m.trend === "flat" ? "teal" : m.trend_is_good ? "teal" : "warn";
          // 4 cells, 2 cols → bottom row needs no bottom border; right col no right border
          const borderRight = i % 2 === 0 ? "border-r border-line" : "";
          const borderBottom = i < 2 ? "border-b border-line" : "";
          return (
            <div
              key={m.key}
              className={`px-3 py-2.5 flex flex-col gap-1.5 hover:bg-ink-50 cursor-pointer transition-colors ${borderRight} ${borderBottom}`}
            >
              <div className="text-[9.5px] uppercase tracking-cap text-paper-3">
                {m.label}
              </div>
              <div className="font-serif text-[20px] text-paper leading-none">
                {m.display_value}
              </div>
              <div className="flex items-center justify-between gap-1.5">
                <span className={`text-2xs ${deltaColor}`}>
                  {m.delta_display} {m.delta_label}
                </span>
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
