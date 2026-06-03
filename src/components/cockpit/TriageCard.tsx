import { useNavigate } from "react-router-dom";
import { Card, Tag, Button, Icon, type TagKind } from "@/components/primitives";
import { ROUTES } from "@/lib/constants";
import { fmtAgo, fmtIn } from "@/lib/format";
import type { TriageItem, TriageKind } from "@/types";

interface TriageCardProps {
  item: TriageItem;
  onResolve?: () => void;
}

const kindToTag: Record<TriageKind, { tag: TagKind; label: string; icon: "reply-arrow" | "alert-circle" | "check-square" | "clock" | "warning" }> = {
  reply: { tag: "reply", label: "Reply", icon: "reply-arrow" },
  decision: { tag: "decision", label: "Decision", icon: "alert-circle" },
  approve: { tag: "approve", label: "Approve", icon: "check-square" },
  task: { tag: "task", label: "Task", icon: "clock" },
  anomaly: { tag: "anomaly", label: "Anomaly", icon: "warning" },
};

export function TriageCard({ item, onResolve }: TriageCardProps) {
  const navigate = useNavigate();
  const cfg = kindToTag[item.kind];

  const timeLabel = item.due_at
    ? `${fmtIn(item.due_at)} · ${new Date(item.due_at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false })}`
    : `${fmtAgo(item.created_at)} ago`;

  const handlePrimary = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.related_resource_kind === "conversation" && item.related_resource_id) {
      navigate(ROUTES.conversation(item.related_resource_id));
    } else if (item.related_resource_kind === "campaign" && item.related_resource_id) {
      navigate(ROUTES.campaign(item.related_resource_id));
    } else if (item.entity_id) {
      navigate(ROUTES.entity(item.entity_id));
    }
  };

  return (
    <Card onClick={() => item.entity_id && navigate(ROUTES.entity(item.entity_id))}>
      <div className="flex items-center gap-2.5">
        <Tag kind={cfg.tag}>
          <Icon name={cfg.icon} size={10} /> {cfg.label}
        </Tag>
        <span className="text-base text-paper font-medium">
          {item.who}
          {item.who_subtitle && (
            <span className="text-paper-3 font-normal text-xs ml-1.5">
              {item.who_subtitle}
            </span>
          )}
        </span>
        <span className="ml-auto font-mono text-2xs text-paper-3">{timeLabel}</span>
      </div>

      <div className="text-sm text-paper-2 leading-relaxed">
        <span className={item.kind === "reply" ? "text-paper italic" : ""}>{item.body}</span>
        {item.body_meta && (
          <> <span className="text-paper-3">· {item.body_meta}</span></>
        )}
      </div>

      <div className="flex items-center gap-1.5 mt-0.5">
        {item.actions.map((a) => (
          <Button
            key={a.id}
            variant={a.primary ? "primary" : a.id === "snooze" || a.id === "let_ride" || a.id === "regenerate" ? "subtle" : "secondary"}
            size="sm"
            onClick={a.primary ? handlePrimary : (e) => e.stopPropagation()}
          >
            {a.label}
          </Button>
        ))}
        {onResolve && (
          <Button
            variant="subtle"
            size="sm"
            onClick={(e) => { e.stopPropagation(); onResolve(); }}
          >
            Resolve
          </Button>
        )}
        {item.agent_note && (
          <span className="ml-auto font-mono text-2xs text-paper-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-teal shadow-teal-glow" />
            {item.agent_note}
          </span>
        )}
      </div>
    </Card>
  );
}
