import { SectionHeader, Tabs, Button, Card, Tag, EmptyState } from "@/components/primitives";
import { TriageCard } from "./TriageCard";
import { mockApi } from "@/lib/mock";
import { useRealtimeList } from "@/hooks/useRealtime";
import type { TriageItem } from "@/types";
import { useState } from "react";

// Demo triage items shown when DB is empty
const DEMO_ITEMS: TriageItem[] = [
  { id: "d1", kind: "reply", status: "open", who: "Mike Daniels", who_subtitle: "Roofworx CT · IG DM", body: '"Yeah send me the report — what kind of leads are you talking?"', body_meta: "Asked for MJR after seeing the joinery reel.", entity_id: null, entity_name: "Roofworx CT", related_resource_kind: "conversation", related_resource_id: null, actions: [{ id: "draft_reply", label: "Draft reply", primary: true, destructive: false }, { id: "open_thread", label: "Open thread", primary: false, destructive: false }], agent_note: "OpenClaw scored: hot · 0.84", agent_score: 0.84, auto_flagged: false, priority: 95, created_at: new Date(Date.now() - 1000 * 60 * 20).toISOString(), due_at: null },
  { id: "d2", kind: "decision", status: "open", who: "Joinery Test 02", who_subtitle: "Meta ad set · running 6d", body: "CPA drifted from R148 → R207 (+40%) over last 48h. Likely creative fatigue.", body_meta: "Recommend: pause ad #3, push hook B winner.", entity_id: null, entity_name: "Tile & Grout Studio", related_resource_kind: "campaign", related_resource_id: null, actions: [{ id: "approve_pause", label: "Approve pause", primary: true, destructive: false }], agent_note: "Auto-flagged at 35% drift", agent_score: null, auto_flagged: true, priority: 88, created_at: new Date(Date.now() - 1000 * 60 * 40).toISOString(), due_at: null },
];

export function TriageQueue() {
  const [tab, setTab] = useState("triage");
  const { rows: liveItems, loading } = useRealtimeList<TriageItem>("triage_items", mockApi.triage.list);

  const items = loading ? [] : liveItems.length > 0 ? liveItems : DEMO_ITEMS;
  const isDemo = !loading && liveItems.length === 0;

  const needsAction = items.filter((i) => i.priority >= 65);
  const watching = items.filter((i) => i.priority < 65);

  async function handleResolve(id: string) {
    if (isDemo) return;
    await mockApi.triage.resolve(id).catch(() => {});
  }

  return (
    <div className="flex flex-col gap-3.5">
      {isDemo && (
        <div className="text-[10px] font-mono uppercase tracking-cap text-paper-3 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-warn" /> demo data
        </div>
      )}
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "triage", label: "Triage", count: items.length },
          { id: "mine", label: "Mine", count: 0 },
          { id: "snoozed", label: "Snoozed", count: 0 },
          { id: "done", label: "Done today", count: 0 },
        ]}
      />

      {tab === "triage" && items.length === 0 && !loading && (
        <EmptyState
          icon="check"
          title="Inbox zero"
          body="Nothing needs you right now. Sequences and automations are running cleanly."
        />
      )}

      {tab === "triage" && needsAction.length > 0 && (
        <>
          <SectionHeader
            title="Needs you now"
            count={needsAction.length}
            meta="sorted by: priority"
            actions={<Button variant="secondary" size="sm">Filter</Button>}
          />
          {needsAction.map((item) => (
            <TriageCard key={item.id} item={item} onResolve={() => handleResolve(item.id)} />
          ))}
        </>
      )}

      {tab === "triage" && watching.length > 0 && (
        <>
          <SectionHeader
            title="Watching"
            count={watching.length}
            actions={<Button variant="secondary" size="sm">Show all</Button>}
          />
          {watching.map((item) => (
            <Card key={item.id} dashed>
              <div className="flex items-center gap-2.5">
                <Tag kind="muted">{item.kind === "task" ? "Sequence" : "Watching"}</Tag>
                <span className="text-sm text-paper-2">
                  {item.who}
                  {item.who_subtitle && (
                    <span className="text-paper-3 text-xs ml-1.5">{item.who_subtitle}</span>
                  )}
                </span>
                <span className="ml-auto font-mono text-2xs text-paper-3">no action</span>
              </div>
            </Card>
          ))}
        </>
      )}

      {tab === "mine" && <EmptyState icon="users" title="Items assigned to you" body="Filtered view — items you own personally." />}
      {tab === "snoozed" && <EmptyState icon="clock" title="Snoozed items" body="Items you've snoozed will reappear here at their due time." />}
      {tab === "done" && <EmptyState icon="check" title="Completed today" body="Items cleared from your queue in the last 24h." />}
    </div>
  );
}
