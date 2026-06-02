import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChannelBadge, Tabs, Tag, type TagKind } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtAgo, fmtZAR } from "@/lib/format";
import { STAGE_LABELS, TIER_LABELS, type Entity, type PipelineStage } from "@/types";

const stageTag: Partial<Record<PipelineStage, TagKind>> = {
  cold: "muted",
  contacted: "task",
  engaged: "reply",
  booked: "approve",
  onboarding: "decision",
  active: "reply",
  delivering: "approve",
  churned: "muted",
};

export function EntityList() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [tab, setTab] = useState("all");
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.clients.list().then(setEntities);
  }, []);

  const clientStages: PipelineStage[] = ["onboarding", "active", "delivering"];
  const prospectStages: PipelineStage[] = ["cold", "contacted", "engaged", "booked"];

  const filtered = entities.filter((e) => {
    if (tab === "all") return true;
    if (tab === "clients") return clientStages.includes(e.pipeline_stage);
    if (tab === "prospects") return prospectStages.includes(e.pipeline_stage);
    if (tab === "churned") return e.pipeline_stage === "churned";
    return true;
  });

  const counts = {
    all: entities.length,
    clients: entities.filter((e) => clientStages.includes(e.pipeline_stage)).length,
    prospects: entities.filter((e) => prospectStages.includes(e.pipeline_stage)).length,
    churned: entities.filter((e) => e.pipeline_stage === "churned").length,
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 px-4 py-3">
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "all", label: "All", count: counts.all },
          { id: "clients", label: "Clients", count: counts.clients },
          { id: "prospects", label: "Prospects", count: counts.prospects },
          { id: "churned", label: "Churned", count: counts.churned },
        ]}
      />

      <div className="flex-1 min-h-0 overflow-y-auto mt-3 bg-ink-200 border border-line rounded-[10px]">
        {/* Header row */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-3.5 py-2.5 border-b border-line text-2xs uppercase tracking-cap text-paper-3 font-medium sticky top-0 bg-ink-200">
          <span>Business</span>
          <span>Stage</span>
          <span>Tier</span>
          <span>MRR</span>
          <span>Pipeline</span>
          <span>Last touch</span>
        </div>

        {filtered.map((e) => {
          const tagKind = stageTag[e.pipeline_stage] ?? "muted";
          return (
            <button
              key={e.id}
              onClick={() => navigate(ROUTES.entity(e.id))}
              className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-3.5 py-2.5 border-b border-line text-left hover:bg-ink-50 transition-colors items-center"
            >
              <div className="min-w-0">
                <div className="text-sm text-paper truncate">{e.business_name}</div>
                <div className="text-2xs text-paper-3 truncate mt-0.5">
                  {e.contact_name ?? e.industry} · {e.location}
                </div>
              </div>
              <div>
                <Tag kind={tagKind}>{STAGE_LABELS[e.pipeline_stage]}</Tag>
              </div>
              <div className="text-xs text-paper-2">
                {e.tier ? TIER_LABELS[e.tier] : "—"}
              </div>
              <div className="font-mono text-xs text-paper">
                {e.mrr > 0 ? fmtZAR(e.mrr) : "—"}
              </div>
              <div className="font-mono text-xs text-paper-2">
                {e.pipeline_value > 0 ? fmtZAR(e.pipeline_value) : "—"}
              </div>
              <div className="flex items-center gap-1.5">
                {e.last_channel && <ChannelBadge channel={e.last_channel} />}
                <span className="font-mono text-2xs text-paper-3">
                  {e.last_contact_at ? fmtAgo(e.last_contact_at) : "never"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
