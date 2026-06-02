import { useNavigate } from "react-router-dom";
import { Card, ChannelBadge } from "@/components/primitives";
import { ROUTES } from "@/lib/constants";
import { fmtAgo, fmtZARCompact } from "@/lib/format";
import type { Entity } from "@/types";

interface EntityCardProps {
  entity: Entity;
}

export function EntityCard({ entity }: EntityCardProps) {
  const navigate = useNavigate();

  return (
    <Card onClick={() => navigate(ROUTES.entity(entity.id))}>
      {/* Top row: name + score */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-paper font-medium truncate">
            {entity.business_name}
          </div>
          <div className="text-2xs text-paper-3 truncate mt-0.5">
            {entity.contact_name ?? entity.industry} · {entity.location}
          </div>
        </div>
        {entity.agent_score !== null && (
          <span
            className={`font-mono text-2xs px-1 py-0.5 rounded-[3px] flex-shrink-0 ${
              entity.agent_score >= 0.7
                ? "bg-teal-dim text-teal"
                : entity.agent_score >= 0.4
                  ? "bg-warn-dim text-warn"
                  : "text-paper-3 border border-line"
            }`}
          >
            {entity.agent_score.toFixed(2)}
          </span>
        )}
      </div>

      {/* Last message preview */}
      {entity.last_message_preview && (
        <div className="text-xs text-paper-2 italic line-clamp-2 leading-snug">
          {entity.last_message_preview}
        </div>
      )}

      {/* Bottom row: channel + value + time */}
      <div className="flex items-center gap-2 mt-0.5">
        {entity.last_channel && <ChannelBadge channel={entity.last_channel} />}
        {entity.pipeline_value > 0 && (
          <span className="font-mono text-2xs text-paper-2">
            {fmtZARCompact(entity.pipeline_value)}
          </span>
        )}
        {entity.last_contact_at && (
          <span className="ml-auto font-mono text-2xs text-paper-3">
            {fmtAgo(entity.last_contact_at)}
          </span>
        )}
      </div>
    </Card>
  );
}
