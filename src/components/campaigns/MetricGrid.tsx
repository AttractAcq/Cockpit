import type { ReactNode } from "react";

export interface MetricCell {
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "flat";
  trend_is_good?: boolean;
}

interface MetricGridProps {
  cells: MetricCell[];
  cols?: 3 | 4 | 5;
}

export function MetricGrid({ cells, cols = 4 }: MetricGridProps) {
  const colClass = {
    3: "grid-cols-3",
    4: "grid-cols-4",
    5: "grid-cols-5",
  }[cols];

  return (
    <div className={`grid ${colClass} border border-line rounded-[10px] overflow-hidden bg-ink-200`}>
      {cells.map((c, i) => {
        const trendColor =
          !c.trend || c.trend === "flat"
            ? "text-paper-3"
            : c.trend_is_good
              ? "text-teal"
              : "text-warn";
        return (
          <div
            key={c.label}
            className={`px-3 py-3 flex flex-col gap-1 ${i < cells.length - 1 ? "border-r border-line" : ""}`}
          >
            <span className="text-[9.5px] uppercase tracking-cap text-paper-3">
              {c.label}
            </span>
            <span className="font-serif text-[20px] text-paper leading-none">
              {c.value}
            </span>
            {c.sub && <span className={`text-2xs ${trendColor}`}>{c.sub}</span>}
          </div>
        );
      })}
    </div>
  );
}
