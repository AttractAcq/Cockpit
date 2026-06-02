import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, EmptyState, Panel, Tag, type TagKind, SectionHeader } from "@/components/primitives";
import { MetricGrid } from "./MetricGrid";
import { mockApi } from "@/lib/mock";
import { fmtZAR, fmtPercent, fmtNumber } from "@/lib/format";
import type { Campaign, CampaignStatus } from "@/types";

const statusTag: Record<CampaignStatus, { kind: TagKind; label: string }> = {
  live: { kind: "reply", label: "Live" },
  draft: { kind: "muted", label: "Draft" },
  paused: { kind: "task", label: "Paused" },
  flagged: { kind: "anomaly", label: "Flagged" },
  ended: { kind: "muted", label: "Ended" },
};

export function CampaignDetail() {
  const { id } = useParams();
  const [campaign, setCampaign] = useState<Campaign | null>(null);

  useEffect(() => {
    if (!id) {
      setCampaign(null);
      return;
    }
    void mockApi.campaigns.byId(id).then(setCampaign);
  }, [id]);

  if (!id) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon="campaign"
          title="Pick a campaign"
          body="Select an ad campaign to see spend, CPA trend, and creative performance."
        />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex-1 flex items-center justify-center text-paper-3 text-sm">
        Loading…
      </div>
    );
  }

  const status = statusTag[campaign.status];

  // Combine spend + cpa into chart data
  const chartData = campaign.spend_trend_7d.map((spend, i) => ({
    day: `D${i + 1}`,
    spend,
    cpa: campaign.cpa_trend_7d[i],
  }));

  const cells = [
    {
      label: "Spend total",
      value: fmtZAR(campaign.spend_total),
      sub: `${fmtZAR(campaign.spend_today)} today`,
    },
    {
      label: "Daily budget",
      value: fmtZAR(campaign.budget_daily),
      sub: "set",
    },
    {
      label: "Impressions",
      value: fmtNumber(campaign.impressions, 0),
      sub: `${fmtPercent(campaign.ctr, 1)} CTR`,
    },
    {
      label: "Leads",
      value: campaign.leads.toString(),
      sub: campaign.cpl ? `${fmtZAR(campaign.cpl)} CPL` : "—",
    },
  ];

  return (
    <div className="flex-1 min-w-0 overflow-y-auto px-4 py-3 flex flex-col gap-3.5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Tag kind={status.kind}>{status.label}</Tag>
        <div className="flex-1 min-w-0">
          <div className="text-base text-paper font-medium truncate">
            {campaign.name}
          </div>
          {campaign.entity_name && (
            <div className="text-xs text-paper-3 mt-0.5">{campaign.entity_name}</div>
          )}
        </div>
        <div className="flex gap-1.5">
          {campaign.status === "live" && (
            <Button variant="secondary" size="sm">Pause</Button>
          )}
          {campaign.status === "paused" && (
            <Button variant="primary" size="sm">Resume</Button>
          )}
          {campaign.status === "flagged" && (
            <>
              <Button variant="primary" size="sm">Approve fix</Button>
              <Button variant="secondary" size="sm">Investigate</Button>
            </>
          )}
          <Button variant="subtle" size="sm">Edit</Button>
        </div>
      </div>

      {/* Flag banner */}
      {campaign.flag_reason && (
        <div className="bg-warn-dim border border-warn rounded-lg px-3 py-2.5 flex items-start gap-2.5">
          <span className="text-warn text-xs font-mono uppercase tracking-cap mt-0.5">
            Flagged
          </span>
          <div className="text-sm text-paper flex-1">{campaign.flag_reason}</div>
        </div>
      )}

      {/* Metric grid */}
      <MetricGrid cells={cells} />

      {/* CPA + Spend chart */}
      <Panel title="7-day trend" meta="spend (R) · cpa (R)">
        <div className="px-3 py-3 h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <XAxis
                dataKey="day"
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
                width={36}
              />
              <Tooltip
                contentStyle={{
                  background: "#0B1715",
                  border: "1px solid rgba(242,239,230,0.12)",
                  borderRadius: "6px",
                  fontSize: "11px",
                  color: "#F2EFE6",
                }}
              />
              <Line
                type="monotone"
                dataKey="spend"
                stroke="#00E5C3"
                strokeWidth={1.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="cpa"
                stroke={campaign.status === "flagged" ? "#F2C14E" : "#9AA6A2"}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* Creatives */}
      <Panel title="Creatives" meta={`${campaign.creative_count} active`}>
        {campaign.creative_count === 0 ? (
          <div className="px-3 py-6">
            <EmptyState
              icon="library"
              title="No creatives yet"
              body="Add ad creatives from the Studio to start running this campaign."
            />
          </div>
        ) : (
          <div className="px-3 py-3 grid grid-cols-3 gap-3">
            {Array.from({ length: campaign.creative_count }).map((_, i) => (
              <div
                key={i}
                className="aspect-[9/16] bg-ink-100 border border-line rounded-md flex items-end p-2"
              >
                <div className="text-2xs font-mono text-paper-3">
                  {i === 1 && campaign.status !== "flagged" ? "🏆 winner" : `ad #${i + 1}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
