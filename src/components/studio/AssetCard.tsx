import { Tag, type TagKind, Icon } from "@/components/primitives";
import { fmtAgo, fmtBytes } from "@/lib/format";
import type { Asset, AssetKind } from "@/types";

const kindLabels: Record<AssetKind, string> = {
  reel_brief: "Reel brief",
  mjr_report: "MJR report",
  ad_creative: "Ad creative",
  pitch_deck: "Deck",
  brand_guide: "Brand guide",
  onboarding_doc: "Onboarding",
  trust_doc: "Trust doc",
  other: "Other",
};

interface AssetCardProps {
  asset: Asset;
}

const statusTag: Record<Asset["status"], TagKind> = {
  draft: "muted",
  ready: "approve",
  shipped: "reply",
  archived: "muted",
};

export function AssetCard({ asset }: AssetCardProps) {
  return (
    <div className="bg-ink-200 border border-line rounded-[10px] overflow-hidden hover:border-line-2 hover:bg-ink-50 transition-colors cursor-pointer flex flex-col">
      {/* Thumbnail */}
      <div className="aspect-video bg-ink-100 border-b border-line grid place-items-center">
        <Icon
          name={asset.file_type.startsWith("video") ? "campaign" : "library"}
          size={28}
          className="text-paper-3"
        />
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center justify-between gap-2">
          <Tag kind={statusTag[asset.status]}>{asset.status}</Tag>
          <span className="text-2xs text-paper-3 font-mono">
            {kindLabels[asset.kind]}
          </span>
        </div>
        <div className="text-sm text-paper font-medium leading-snug line-clamp-2">
          {asset.title}
        </div>
        {asset.entity_name && (
          <div className="text-2xs text-paper-3 truncate">{asset.entity_name}</div>
        )}
        <div className="flex items-center justify-between mt-auto pt-1.5 text-2xs text-paper-3 font-mono">
          <span>{fmtBytes(asset.file_size_bytes)}</span>
          <span>{fmtAgo(asset.updated_at)}</span>
        </div>
        {asset.generated_by === "agent" && (
          <div className="text-2xs text-teal font-mono flex items-center gap-1">
            <span className="w-1 h-1 bg-teal rounded-full" />
            via {asset.agent_name}
          </div>
        )}
      </div>
    </div>
  );
}
