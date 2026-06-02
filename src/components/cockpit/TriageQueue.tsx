import { useEffect, useState } from "react";
import { SectionHeader, Tabs, Button, Card, Tag, EmptyState } from "@/components/primitives";
import { TriageCard } from "./TriageCard";
import { mockApi } from "@/lib/mock";
import type { TriageItem } from "@/types";

export function TriageQueue() {
  const [items, setItems] = useState<TriageItem[]>([]);
  const [tab, setTab] = useState("triage");

  useEffect(() => {
    mockApi.triage.list().then(setItems);
  }, []);

  const needsAction = items.filter((i) => i.priority >= 65);
  const watching = items.filter((i) => i.priority < 65);

  return (
    <div className="flex flex-col gap-3.5">
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "triage", label: "Triage", count: items.length },
          { id: "mine", label: "Mine", count: 3 },
          { id: "snoozed", label: "Snoozed", count: 2 },
          { id: "done", label: "Done today", count: 7 },
        ]}
      />

      {tab === "triage" && items.length === 0 && (
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
            <TriageCard key={item.id} item={item} />
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

      {tab === "mine" && (
        <EmptyState
          icon="users"
          title="Items assigned to you"
          body="Filtered view — items you own personally."
        />
      )}
      {tab === "snoozed" && (
        <EmptyState
          icon="clock"
          title="Snoozed items"
          body="Items you've snoozed will reappear here at their due time."
        />
      )}
      {tab === "done" && (
        <EmptyState
          icon="check"
          title="Completed today"
          body="Items cleared from your queue in the last 24h."
        />
      )}
    </div>
  );
}
