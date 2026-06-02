import { useNavigate, useParams } from "react-router-dom";
import { Sparkline, Tag, type TagKind } from "@/components/primitives";
import { ROUTES } from "@/lib/constants";
import { fmtZAR, fmtPercent } from "@/lib/format";
import type { Campaign, CampaignStatus } from "@/types";

const statusTag: Record<CampaignStatus, { kind: TagKind; label: string }> = {
  live: { kind: "reply", label: "Live" },
  draft: { kind: "muted", label: "Draft" },
  paused: { kind: "task", label: "Paused" },
  flagged: { kind: "anomaly", label: "Flagged" },
  ended: { kind: "muted", label: "Ended" },
};

interface CampaignListProps {
  campaigns: Campaign[];
}

export function CampaignList({ campaigns }: CampaignListProps) {
  const { id: activeId } = useParams();
  const navigate = useNavigate();

  return (
    <div className="w-[420px] border-r border-line flex flex-col bg-ink flex-shrink-0 overflow-y-auto">
      {campaigns.map((c) => {
        const isActive = c.id === activeId;
        const status = statusTag[c.status];
        const cpaSpark: "teal" | "warn" =
          c.status === "flagged" ? "warn" : "teal";

        return (
          <button
            key={c.id}
            onClick={() => navigate(ROUTES.campaign(c.id))}
            className={`px-3.5 py-3 text-left border-b border-line transition-colors ${
              isActive ? "bg-ink-100" : "hover:bg-ink-50"
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Tag kind={status.kind}>{status.label}</Tag>
              {c.entity_name && (
                <span className="text-2xs text-paper-3 font-mono truncate">
                  {c.entity_name}
                </span>
              )}
            </div>
            <div className="text-sm text-paper font-medium leading-snug truncate">
              {c.name}
            </div>
            <div className="grid grid-cols-3 gap-3 mt-2.5">
              <div>
                <div className="text-[9px] uppercase tracking-cap text-paper-3">
                  Spend
                </div>
                <div className="text-xs text-paper font-mono mt-0.5">
                  {fmtZAR(c.spend_total)}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-cap text-paper-3">
                  CTR
                </div>
                <div className="text-xs text-paper font-mono mt-0.5">
                  {fmtPercent(c.ctr, 1)}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-cap text-paper-3">
                  CPA
                </div>
                <div
                  className={`text-xs font-mono mt-0.5 ${c.status === "flagged" ? "text-warn" : "text-paper"}`}
                >
                  {c.cpa ? fmtZAR(c.cpa) : "—"}
                </div>
              </div>
            </div>
            {c.cpa_trend_7d.some((v) => v > 0) && (
              <div className="mt-2 h-3">
                <Sparkline values={c.cpa_trend_7d} color={cpaSpark} height={12} />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
