import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Panel, StatusDot } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import type { Automation } from "@/types";

export function InFlightPanel() {
  const [items, setItems] = useState<Automation[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.operations.automations().then(setItems);
  }, []);

  const live = items.filter((i) => i.status === "live").length;
  const paused = items.filter((i) => i.status === "paused").length;

  const handleClick = (item: Automation) => {
    if (item.resource_kind === "campaign" && item.resource_id) {
      navigate(ROUTES.campaign(item.resource_id));
    } else {
      navigate(ROUTES.operations);
    }
  };

  return (
    <Panel
      title="In flight"
      meta={`${live} running${paused ? ` · ${paused} paused` : ""}`}
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          onClick={() => handleClick(item)}
          className={`w-full px-3 py-2.5 flex items-center gap-2.5 hover:bg-ink-50 cursor-pointer text-left transition-colors ${
            i < items.length - 1 ? "border-b border-line" : ""
          }`}
        >
          <StatusDot status={item.status} />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-paper flex items-center gap-1.5">
              <span className="truncate">{item.name}</span>
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
            <div className="text-xs text-paper-3 mt-0.5 font-mono truncate">
              {item.detail}
            </div>
          </div>
          <div className="font-mono text-2xs text-paper-2 text-right leading-tight flex-shrink-0">
            <div>
              <b className="text-paper font-medium">{item.primary_stat_value}</b>{" "}
              {item.primary_stat_label}
            </div>
            <div className="text-paper-3">{item.secondary_stats}</div>
          </div>
        </button>
      ))}
    </Panel>
  );
}
