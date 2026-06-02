import { useEffect, useState } from "react";
import { Button, EmptyState, Icon, Tabs } from "@/components/primitives";
import { AssetCard } from "./AssetCard";
import { mockApi } from "@/lib/mock";
import type { Asset, AssetKind } from "@/types";

export function AssetGrid() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tab, setTab] = useState<AssetKind | "all">("all");

  useEffect(() => {
    mockApi.studio.list().then(setAssets);
  }, []);

  const filtered = tab === "all" ? assets : assets.filter((a) => a.kind === tab);

  const counts: Record<string, number> = {
    all: assets.length,
  };
  for (const a of assets) {
    counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <Tabs
          active={tab}
          onChange={(v) => setTab(v as AssetKind | "all")}
          tabs={[
            { id: "all", label: "All", count: counts.all },
            { id: "mjr_report", label: "MJRs", count: counts.mjr_report ?? 0 },
            { id: "reel_brief", label: "Reels", count: counts.reel_brief ?? 0 },
            { id: "ad_creative", label: "Creatives", count: counts.ad_creative ?? 0 },
            { id: "onboarding_doc", label: "Onboarding", count: counts.onboarding_doc ?? 0 },
            { id: "pitch_deck", label: "Decks", count: counts.pitch_deck ?? 0 },
            { id: "brand_guide", label: "Brand", count: counts.brand_guide ?? 0 },
          ]}
        />
        <Button variant="primary" size="sm">
          <Icon name="plus" size={11} className="inline mr-1" />
          New asset
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyState
            icon="library"
            title="No assets in this category"
            body="Generate one with the agent or upload manually."
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {filtered.map((a) => (
              <AssetCard key={a.id} asset={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
