import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Panel, StatusDot, Icon } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { Automation } from "@/types";

export function AutomationList() {
  const [items, setItems] = useState<Automation[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.operations.automations().then(setItems);
  }, []);

  const live = items.filter((i) => i.status === "live").length;
  const warn = items.filter((i) => i.status === "warn").length;

  return (
    <Panel
      title="Automations"
      meta={
        <span>
          {live} live{warn ? ` · ${warn} need review` : ""}
        </span>
      }
    >
      {items.map((item, i) => (
        <div
          key={item.id}
          className={`px-3 py-3 flex items-center gap-3 ${
            i < items.length - 1 ? "border-b border-line" : ""
          }`}
        >
          <StatusDot status={item.status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-paper truncate">{item.name}</span>
              {item.status_pill && (
                <span
                  className={`font-mono text-[9px] uppercase tracking-cap px-1.5 py-px rounded-[3px] ${
                    item.status === "warn"
                      ? "text-warn border border-warn-dim"
                      : "bg-ink-100 text-paper-3 border border-line"
                  }`}
                >
                  {item.status_pill}
                </span>
              )}
            </div>
            <div className="text-xs text-paper-3 mt-0.5 font-mono">
              {item.detail} · last action {fmtAgo(item.last_action_at)} ago
            </div>
          </div>
          <div className="font-mono text-xs text-paper-2 text-right leading-tight">
            <div>
              <b className="text-paper">{item.primary_stat_value}</b> {item.primary_stat_label}
            </div>
            <div className="text-paper-3 text-2xs">{item.secondary_stats}</div>
          </div>
          <div className="flex gap-1">
            <Button
              variant="subtle"
              size="sm"
              onClick={() =>
                item.resource_kind === "campaign" && item.resource_id
                  ? navigate(ROUTES.campaign(item.resource_id))
                  : null
              }
            >
              <Icon name="external" size={11} />
            </Button>
            {item.status === "live" && (
              <Button variant="subtle" size="sm">Pause</Button>
            )}
            {item.status === "paused" && (
              <Button variant="primary" size="sm">Resume</Button>
            )}
          </div>
        </div>
      ))}
    </Panel>
  );
}
