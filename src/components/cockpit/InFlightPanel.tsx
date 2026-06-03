import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Panel, StatusDot } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import type { Automation } from "@/types";

const DEMO: Automation[] = [
  { id: "d-a1", name: "Outreach sequence", kind: "outreach_sequence", status: "live", status_pill: "WA + IG", detail: "Joinery Wave 03 · step 2 of 4", primary_stat_label: "sent", primary_stat_value: "12", secondary_stats: "3 replied · 1 booked", resource_kind: "sequence", resource_id: null, started_at: "", last_action_at: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
  { id: "d-a2", name: "Meta ad · Joinery Test 02", kind: "ad_campaign", status: "live", status_pill: "live", detail: "6d running · creative B winning", primary_stat_label: "spent", primary_stat_value: "R 348", secondary_stats: "CTR 1.4% · CPA R 207", resource_kind: "campaign", resource_id: null, started_at: "", last_action_at: new Date(Date.now() - 1000 * 60 * 10).toISOString() },
  { id: "d-a3", name: "Meta ad · Roofing Retarget", kind: "ad_campaign", status: "warn", status_pill: "flagged", detail: "CPA drift +40% · awaiting decision", primary_stat_label: "spent", primary_stat_value: "R 292", secondary_stats: "2 leads · CPL R 146", resource_kind: "campaign", resource_id: null, started_at: "", last_action_at: new Date(Date.now() - 1000 * 60 * 40).toISOString() },
  { id: "d-a4", name: "OpenClaw agent", kind: "agent", status: "idle", status_pill: "idle", detail: "last action 14m · MJR drafted", primary_stat_label: "actions today", primary_stat_value: "23", secondary_stats: "today", resource_kind: "agent", resource_id: null, started_at: "", last_action_at: new Date(Date.now() - 1000 * 60 * 14).toISOString() },
];

export function InFlightPanel() {
  const [items, setItems] = useState<Automation[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.operations.automations()
      .then((rows) => {
        if (rows.length === 0) { setItems(DEMO); setIsDemo(true); }
        else { setItems(rows as Automation[]); setIsDemo(false); }
      })
      .catch(() => { setItems(DEMO); setIsDemo(true); });
  }, []);

  const live = items.filter((i) => i.status === "live").length;
  const paused = items.filter((i) => i.status === "paused").length;

  return (
    <Panel
      title="In flight"
      meta={`${live} running${paused ? ` · ${paused} paused` : ""}${isDemo ? " · demo" : ""}`}
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          onClick={() =>
            item.resource_kind === "campaign" && item.resource_id
              ? navigate(ROUTES.campaign(item.resource_id))
              : navigate(ROUTES.operations)
          }
          className={`w-full px-3 py-2.5 flex items-center gap-2.5 hover:bg-ink-50 cursor-pointer text-left transition-colors ${
            i < items.length - 1 ? "border-b border-line" : ""
          }`}
        >
          <StatusDot status={item.status} />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-paper flex items-center gap-1.5">
              <span className="truncate">{item.name}</span>
              {item.status_pill && (
                <span className={`font-mono text-[9px] uppercase tracking-cap px-1.5 py-px rounded-[3px] ${
                  item.status === "warn"
                    ? "text-warn border border-warn-dim"
                    : "bg-ink-100 text-paper-3 border border-line"
                }`}>
                  {item.status_pill}
                </span>
              )}
            </div>
            <div className="text-xs text-paper-3 mt-0.5 font-mono truncate">{item.detail}</div>
          </div>
          <div className="font-mono text-2xs text-paper-2 text-right leading-tight flex-shrink-0">
            <div><b className="text-paper font-medium">{item.primary_stat_value}</b> {item.primary_stat_label}</div>
            <div className="text-paper-3">{item.secondary_stats}</div>
          </div>
        </button>
      ))}
    </Panel>
  );
}
