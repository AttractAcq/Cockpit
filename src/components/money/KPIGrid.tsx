import { useEffect, useState } from "react";
import { Sparkline } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import type { PulseMetric } from "@/types";

const DEMO: PulseMetric[] = [
  { key: "mrr", label: "MRR", value: 4200, display_value: "R 4,200", delta_value: 1200, delta_display: "+R1,200", delta_label: "mo", trend: "up", trend_is_good: true, sparkline: [1200, 1600, 2200, 2800, 4200, 4200, 4200] },
  { key: "pipeline", label: "Pipeline", value: 34500, display_value: "R 34.5k", delta_value: 8000, delta_display: "+R 8k", delta_label: "wk", trend: "up", trend_is_good: true, sparkline: [22000, 24500, 26000, 28500, 30000, 32000, 34500] },
  { key: "spend_mtd", label: "Spend MTD", value: 640, display_value: "R 640", delta_value: -120, delta_display: "-R 120", delta_label: "vs plan", trend: "down", trend_is_good: true, sparkline: [120, 200, 280, 360, 440, 540, 640] },
  { key: "reply_rate", label: "Reply rate", value: 18, display_value: "18%", delta_value: 4, delta_display: "+4pp", delta_label: "n=58", trend: "up", trend_is_good: true, sparkline: [12, 10, 11, 13, 14, 16, 18] },
  { key: "cpa_blended", label: "CPA blended", value: 178, display_value: "R 178", delta_value: 24, delta_display: "+R 24", delta_label: "wk", trend: "up", trend_is_good: false, sparkline: [148, 152, 158, 164, 170, 174, 178] },
];

export function KPIGrid() {
  const [metrics, setMetrics] = useState<PulseMetric[]>(DEMO);
  const [isDemo, setIsDemo] = useState(true);

  useEffect(() => {
    mockApi.pulse.metrics()
      .then((m) => {
        if (m.length === 0) { setMetrics(DEMO); setIsDemo(true); }
        else { setMetrics(m); setIsDemo(false); }
      })
      .catch(() => { setMetrics(DEMO); setIsDemo(true); });
  }, []);

  return (
    <div className="grid grid-cols-5 gap-3">
      {metrics.map((m) => {
        const deltaColor = m.trend === "flat" ? "text-paper-3" : m.trend_is_good ? "text-teal" : "text-warn";
        const sparkColor: "teal" | "warn" = m.trend === "flat" ? "teal" : m.trend_is_good ? "teal" : "warn";
        return (
          <div
            key={m.key}
            className="bg-ink-200 border border-line rounded-[10px] px-3.5 py-3 flex flex-col gap-2"
          >
            <div className="text-[9.5px] uppercase tracking-cap text-paper-3">
              {m.label}{isDemo ? " ·demo" : ""}
            </div>
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
