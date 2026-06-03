import { Tag, type TagKind, Icon, Button } from "@/components/primitives";
import { fmtAgo, fmtBytes } from "@/lib/format";
import type { Asset, AssetKind } from "@/types";

const kindLabels: Record<AssetKind, string> = {
  reel_brief: "Reel brief",
  content_brief: "Content brief",
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
  namingRegex?: RegExp;
  onApprove?: () => void;
  onReject?: () => void;
}

const statusTag: Record<Asset["status"], TagKind> = {
  draft: "muted",
  ready: "approve",
  approved: "reply",
  shipped: "reply",
  archived: "muted",
};

export function AssetCard({ asset, namingRegex, onApprove, onReject }: AssetCardProps) {
  const namingOk = !namingRegex || namingRegex.test(asset.file_name ?? "");

  return (
    <div className="bg-ink-200 border border-line rounded-[10px] overflow-hidden hover:border-line-2 hover:bg-ink-50 transition-colors cursor-pointer flex flex-col">
      <div className="aspect-video bg-ink-100 border-b border-line grid place-items-center relative">
        <Icon
          name={asset.file_type?.startsWith("video") ? "campaign" : "library"}
          size={28}
          className="text-paper-3"
        />
        {!namingOk && (
          <div className="absolute top-1.5 right-1.5 bg-warn-dim border border-warn/30 text-warn font-mono text-[9px] uppercase tracking-cap px-1 py-0.5 rounded">
            naming
          </div>
        )}
      </div>

      <div className="px-3 py-2.5 flex flex-col gap-1.5 flex-1">
        <div className="flex items-center justify-between gap-2">
          <Tag kind={statusTag[asset.status] ?? "muted"}>{asset.status}</Tag>
          <span className="text-2xs text-paper-3 font-mono">
            {kindLabels[asset.kind as AssetKind] ?? asset.kind}
          </span>
        </div>
        <div className="text-sm text-paper font-medium leading-snug line-clamp-2">{asset.title}</div>
        {asset.entity_name && (
          <div className="text-2xs text-paper-3 truncate">{asset.entity_name}</div>
        )}
        <div className="flex items-center justify-between mt-auto pt-1.5 text-2xs text-paper-3 font-mono">
          <span>{fmtBytes(asset.file_size_bytes)}</span>
          <span>{fmtAgo(asset.updated_at)}</span>
        </div>
        {asset.generated_by === "agent" && (
          <div className="text-2xs text-teal font-mono flex items-center gap-1">
            <span className="w-1 h-1 bg-teal rounded-full" /> via {asset.agent_name}
          </div>
        )}
        {(asset.status === "ready" || asset.status === "draft") && (onApprove || onReject) && (
          <div className="flex gap-1.5 pt-1 border-t border-line mt-1">
            {onApprove && <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onApprove(); }}>Approve</Button>}
            {onReject && <Button variant="subtle" size="sm" onClick={(e) => { e.stopPropagation(); onReject(); }}>Reject</Button>}
          </div>
        )}
      </div>
    </div>
  );
}
