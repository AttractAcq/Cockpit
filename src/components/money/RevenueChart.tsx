import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { fmtZAR } from "@/lib/format";

interface ChartPoint { month: string; mrr: number }

const DEMO_DATA: ChartPoint[] = [
  { month: "Nov '25", mrr: 1200 },
  { month: "Dec '25", mrr: 1200 },
  { month: "Jan '26", mrr: 1600 },
  { month: "Feb '26", mrr: 2200 },
  { month: "Mar '26", mrr: 2200 },
  { month: "Apr '26", mrr: 2800 },
  { month: "May '26", mrr: 4200 },
  { month: "Jun '26", mrr: 4200 },
];

export function RevenueChart() {
  const [data, setData] = useState<ChartPoint[]>(DEMO_DATA);
  const [isDemo, setIsDemo] = useState(true);

  useEffect(() => {
    mockApi.money.mrr()
      .then((rows) => {
        if (rows.length === 0) { setData(DEMO_DATA); setIsDemo(true); return; }
        // mrr_snapshots: { snapshot_date, mrr_cents }
        const points = (rows as Array<{ snapshot_date: string; mrr_cents: number }>)
          .slice(0, 12)
          .reverse()
          .map((r) => ({
            month: new Date(r.snapshot_date).toLocaleDateString("en-ZA", { month: "short", year: "2-digit" }),
            mrr: Math.round(r.mrr_cents / 100),
          }));
        setData(points);
        setIsDemo(false);
      })
      .catch(() => { setData(DEMO_DATA); setIsDemo(true); });
  }, []);

  const current = data[data.length - 1]?.mrr ?? 0;

  return (
    <Panel
      title={`MRR · trailing 12 months${isDemo ? " · demo" : ""}`}
      meta={fmtZAR(current) + " current"}
    >
      <div className="px-3 py-3 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00E5C3" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#00E5C3" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" stroke="#5E6B68" fontSize={10} tickLine={false} axisLine={{ stroke: "rgba(242,239,230,0.07)" }} />
            <YAxis stroke="#5E6B68" fontSize={10} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => `R${v >= 1000 ? v / 1000 + "k" : v}`} />
            <Tooltip
              contentStyle={{ background: "#0B1715", border: "1px solid rgba(242,239,230,0.12)", borderRadius: "6px", fontSize: "11px", color: "#F2EFE6" }}
              formatter={(v: number) => [fmtZAR(v), "MRR"]}
            />
            <Area type="monotone" dataKey="mrr" stroke="#00E5C3" strokeWidth={1.5} fill="url(#mrrFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
