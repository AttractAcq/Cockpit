import { CampaignList, CampaignDetail } from "@/components/campaigns";
import { api } from "@/lib/api";
import { useRealtimeList } from "@/hooks/useRealtime";
import type { Campaign } from "@/types";

export function CampaignsPage() {
  const { rows, loading, error } = useRealtimeList<Campaign>(
    "campaigns",
    api.campaigns.list as () => Promise<Campaign[]>,
  );

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex">
      <CampaignList campaigns={rows} loading={loading} error={error} />
      <CampaignDetail />
    </div>
  );
}
