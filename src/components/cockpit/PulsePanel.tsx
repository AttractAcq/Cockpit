import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Panel, Sparkline } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import type { PulseMetric } from "@/types";

const DEMO_METRICS: PulseMetric[] = [
  { key: "mrr", label: "MRR", value: 4200, display_value: "R 4,200", delta_value: 1200, delta_display: "+R1,200", delta_label: "mo", trend: "up", trend_is_good: true, sparkline: [1200, 1600, 2200, 2800, 4200, 4200, 4200] },
  { key: "pipeline", label: "Pipeline", value: 34500, display_value: "R 34.5k", delta_value: 8000, delta_display: "+R 8k", delta_label: "wk", trend: "up", trend_is_good: true, sparkline: [22000, 24500, 26000, 28500, 30000, 32000, 34500] },
  { key: "spend_mtd", label: "Spend MTD", value: 640, display_value: "R 640", delta_value: -120, delta_display: "-R 120", delta_label: "vs plan", trend: "down", trend_is_good: true, sparkline: [120, 200, 280, 360, 440, 540, 640] },
  { key: "reply_rate", label: "Reply rate", value: 18, display_value: "18%", delta_value: 4, delta_display: "+4pp", delta_label: "n=58", trend: "up", trend_is_good: true, sparkline: [12, 10, 11, 13, 14, 16, 18] },
];

export function PulsePanel() {
  const [metrics, setMetrics] = useState<PulseMetric[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.pulse.metrics()
      .then((m) => {
        if (m.length === 0) { setMetrics(DEMO_METRICS); setIsDemo(true); }
        else { setMetrics(m.slice(0, 4)); setIsDemo(false); }
      })
      .catch(() => { setMetrics(DEMO_METRICS); setIsDemo(true); });
  }, []);

  return (
    <Panel title="Pulse" meta={`7-day${isDemo ? " · demo" : ""}`}>
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
