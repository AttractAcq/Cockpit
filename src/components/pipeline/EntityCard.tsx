import { useNavigate } from "react-router-dom";
import { Card, ChannelBadge } from "@/components/primitives";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { Entity } from "@/types";

interface EntityCardProps {
  entity: Entity;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}

export function EntityCard({ entity, draggable, onDragStart }: EntityCardProps) {
  const navigate = useNavigate();

  const score = entity.icp_fit_score ?? entity.agent_score;

  return (
    <Card
      onClick={() => navigate(ROUTES.entity(entity.id))}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      {/* Top row: name + score */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-paper font-medium truncate">
            {entity.business_name}
          </div>
          <div className="text-2xs text-paper-3 truncate mt-0.5">
            {entity.contact_name ?? entity.niche ?? "—"} · {entity.city ?? "—"}
          </div>
        </div>
        {score != null && (
          <span
            className={`font-mono text-2xs px-1 py-0.5 rounded-[3px] flex-shrink-0 ${
              score >= 70
                ? "bg-teal-dim text-teal"
                : score >= 40
                  ? "bg-warn-dim text-warn"
                  : "text-paper-3 border border-line"
            }`}
          >
            {score > 1 ? score : score.toFixed(2)}
          </span>
        )}
      </div>

      {/* Last message preview */}
      {entity.last_message_preview && (
        <div className="text-xs text-paper-2 italic line-clamp-2 leading-snug">
          {entity.last_message_preview}
        </div>
      )}

      {/* Bottom row: channel + time */}
      <div className="flex items-center gap-2 mt-0.5">
        {entity.last_channel && <ChannelBadge channel={entity.last_channel} />}
        {entity.last_contact_at && (
          <span className="ml-auto font-mono text-2xs text-paper-3">
            {fmtAgo(entity.last_contact_at)}
          </span>
        )}
      </div>
    </Card>
  );
}
