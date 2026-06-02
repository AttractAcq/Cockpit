import { useEffect, useState } from "react";
import { Sparkline } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import type { PulseMetric } from "@/types";

export function KPIGrid() {
  const [metrics, setMetrics] = useState<PulseMetric[]>([]);

  useEffect(() => {
    mockApi.pulse.metrics().then(setMetrics);
  }, []);

  return (
    <div className="grid grid-cols-5 gap-3">
      {metrics.map((m) => {
        const deltaColor =
          m.trend === "flat"
            ? "text-paper-3"
            : m.trend_is_good
              ? "text-teal"
              : "text-warn";
        const sparkColor: "teal" | "warn" =
          m.trend === "flat" ? "teal" : m.trend_is_good ? "teal" : "warn";
        return (
          <div
            key={m.key}
            className="bg-ink-200 border border-line rounded-[10px] px-3.5 py-3 flex flex-col gap-2"
          >
            <div className="text-[9.5px] uppercase tracking-cap text-paper-3">
              {m.label}
            </div>
            <div className="font-serif text-[24px] text-paper leading-none">
              {m.display_value}
            </div>
            <div className="flex items-center justify-between gap-2 mt-auto">
              <span className={`text-2xs ${deltaColor}`}>
                {m.delta_display} {m.delta_label}
              </span>
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
