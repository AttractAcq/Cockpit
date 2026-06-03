import { useEffect, useState } from "react";
import { CampaignList, CampaignDetail } from "@/components/campaigns";
import { mockApi } from "@/lib/mock";
import type { Campaign } from "@/types";

const DEMO: Campaign[] = [
  { id: "d-cmp1", meta_campaign_id: null, entity_id: null, entity_name: "Tile & Grout Studio", name: "Joinery Test 02 · Hook B winner", objective: "leads", status: "live", budget_daily: 100, spend_total: 348, spend_today: 48, impressions: 12400, clicks: 174, ctr: 1.4, leads: 4, cpa: 87, cpc: 2, cpl: 87, spend_trend_7d: [40, 42, 50, 55, 58, 52, 48], cpa_trend_7d: [148, 155, 160, 170, 180, 195, 207], started_at: new Date(Date.now() - 1000 * 60 * 60 * 144).toISOString(), ended_at: null, flagged_at: null, flag_reason: null, creative_count: 3, created_at: "", updated_at: "" },
  { id: "d-cmp2", meta_campaign_id: null, entity_id: null, entity_name: "Tile & Grout Studio", name: "Roofing Retarget · CPA drift", objective: "leads", status: "flagged", budget_daily: 80, spend_total: 292, spend_today: 32, impressions: 9800, clicks: 126, ctr: 1.3, leads: 2, cpa: 146, cpc: 2.3, cpl: 146, spend_trend_7d: [30, 35, 40, 42, 45, 40, 32], cpa_trend_7d: [120, 125, 132, 138, 145, 148, 207], started_at: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(), ended_at: null, flagged_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), flag_reason: "CPA drift +40%", creative_count: 2, created_at: "", updated_at: "" },
];

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    mockApi.campaigns.list()
      .then((rows) => {
        if (rows.length === 0) { setCampaigns(DEMO); setIsDemo(true); }
        else { setCampaigns(rows as Campaign[]); setIsDemo(false); }
      })
      .catch(() => { setCampaigns(DEMO); setIsDemo(true); });
  }, []);

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      {isDemo && (
        <div className="px-4 py-1 text-[10px] font-mono uppercase tracking-cap text-paper-3 border-b border-line flex items-center gap-1.5 bg-ink-200/40">
          <span className="w-1.5 h-1.5 rounded-full bg-warn" /> demo data · connect Meta Ads and Supabase to see live campaigns
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        <CampaignList campaigns={campaigns} />
        <CampaignDetail />
      </div>
    </div>
  );
}
