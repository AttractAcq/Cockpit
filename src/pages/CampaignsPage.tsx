import { useEffect, useState } from "react";
import { CampaignList, CampaignDetail } from "@/components/campaigns";
import { mockApi } from "@/lib/mock";
import type { Campaign } from "@/types";

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    mockApi.campaigns.list().then(setCampaigns);
  }, []);

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex">
      <CampaignList campaigns={campaigns} />
      <CampaignDetail />
    </div>
  );
}
