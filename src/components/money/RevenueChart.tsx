import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel } from "@/components/primitives";
import { fmtZAR } from "@/lib/format";

// Mock 12-month MRR progression up to current month
const DATA = [
  { month: "Jun '25", mrr: 0 },
  { month: "Jul '25", mrr: 0 },
  { month: "Aug '25", mrr: 0 },
  { month: "Sep '25", mrr: 0 },
  { month: "Oct '25", mrr: 0 },
  { month: "Nov '25", mrr: 1200 },
  { month: "Dec '25", mrr: 1200 },
  { month: "Jan '26", mrr: 1600 },
  { month: "Feb '26", mrr: 2200 },
  { month: "Mar '26", mrr: 2200 },
  { month: "Apr '26", mrr: 2800 },
  { month: "May '26", mrr: 4200 },
];

export function RevenueChart() {
  return (
    <Panel title="MRR · trailing 12 months" meta={fmtZAR(DATA[DATA.length - 1].mrr) + " current"}>
      <div className="px-3 py-3 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={DATA} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00E5C3" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#00E5C3" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="month"
              stroke="#5E6B68"
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: "rgba(242,239,230,0.07)" }}
            />
            <YAxis
              stroke="#5E6B68"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(v) => `R${v / 1000}k`}
            />
            <Tooltip
              contentStyle={{
                background: "#0B1715",
                border: "1px solid rgba(242,239,230,0.12)",
                borderRadius: "6px",
                fontSize: "11px",
                color: "#F2EFE6",
              }}
              formatter={(v: number) => [fmtZAR(v), "MRR"]}
            />
            <Area
              type="monotone"
              dataKey="mrr"
              stroke="#00E5C3"
              strokeWidth={1.5}
              fill="url(#mrrFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}
