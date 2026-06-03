import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Panel, StatusDot, Icon } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { Automation } from "@/types";

const DEMO: Automation[] = [
  { id: "d-op1", name: "Outreach sequence · Joinery Wave 03", kind: "outreach_sequence", status: "live", status_pill: "WA + IG", detail: "step 2 of 4", primary_stat_label: "sent", primary_stat_value: "12", secondary_stats: "3 replied · 1 booked", resource_kind: "sequence", resource_id: null, started_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), last_action_at: new Date(Date.now() - 1000 * 60 * 30).toISOString() },
  { id: "d-op2", name: "Meta ad · Joinery Test 02", kind: "ad_campaign", status: "live", status_pill: "live", detail: "6d running · creative B winning", primary_stat_label: "spent", primary_stat_value: "R 348", secondary_stats: "CTR 1.4% · CPA R 207", resource_kind: "campaign", resource_id: null, started_at: new Date(Date.now() - 1000 * 60 * 60 * 144).toISOString(), last_action_at: new Date(Date.now() - 1000 * 60 * 10).toISOString() },
  { id: "d-op3", name: "Meta ad · Roofing Retarget", kind: "ad_campaign", status: "warn", status_pill: "flagged", detail: "CPA drift +40% · awaiting decision", primary_stat_label: "spent", primary_stat_value: "R 292", secondary_stats: "2 leads · CPL R 146", resource_kind: "campaign", resource_id: null, started_at: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(), last_action_at: new Date(Date.now() - 1000 * 60 * 40).toISOString() },
];

export function AutomationList() {
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
  const warn = items.filter((i) => i.status === "warn").length;

  return (
    <Panel
      title="Automations"
      meta={<span>{live} live{warn ? ` · ${warn} need review` : ""}{isDemo ? " · demo" : ""}</span>}
    >
      {items.map((item, i) => (
        <div
          key={item.id}
          className={`px-3 py-3 flex items-center gap-3 ${i < items.length - 1 ? "border-b border-line" : ""}`}
        >
          <StatusDot status={item.status} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-paper truncate">{item.name}</span>
              {item.status_pill && (
                <span className={`font-mono text-[9px] uppercase tracking-cap px-1.5 py-px rounded-[3px] ${
                  item.status === "warn" ? "text-warn border border-warn-dim" : "bg-ink-100 text-paper-3 border border-line"
                }`}>
                  {item.status_pill}
                </span>
              )}
            </div>
            <div className="text-xs text-paper-3 mt-0.5 font-mono">
              {item.detail} · last {fmtAgo(item.last_action_at)} ago
            </div>
          </div>
          <div className="font-mono text-xs text-paper-2 text-right leading-tight">
            <div><b className="text-paper">{item.primary_stat_value}</b> {item.primary_stat_label}</div>
            <div className="text-paper-3 text-2xs">{item.secondary_stats}</div>
          </div>
          <div className="flex gap-1">
            <Button
              variant="subtle"
              size="sm"
              onClick={() =>
                item.resource_kind === "campaign" && item.resource_id
                  ? navigate(ROUTES.campaign(item.resource_id))
                  : undefined
              }
            >
              <Icon name="external" size={11} />
            </Button>
            {item.status === "live" && <Button variant="subtle" size="sm">Pause</Button>}
            {item.status === "paused" && <Button variant="primary" size="sm">Resume</Button>}
          </div>
        </div>
      ))}
    </Panel>
  );
}
