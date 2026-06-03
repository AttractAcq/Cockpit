import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChannelBadge, Tabs, Tag, type TagKind } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtAgo, fmtZAR } from "@/lib/format";
import { STAGE_LABELS, TIER_LABELS, type Entity, type PipelineStage } from "@/types";

const stageTag: Partial<Record<PipelineStage, TagKind>> = {
  source: "muted",
  cold: "muted",
  contacted: "task",
  engaged: "reply",
  booked: "approve",
  onboarding: "decision",
  active: "reply",
  delivering: "approve",
};

const DEMO_ENTITIES: Entity[] = [
  { id: "d-elist1", business_name: "Tile & Grout Studio", kind: "client", stage: "active", contact_name: "Janine Roberts", niche: "Tiling", city: "Sea Point", icp_fit_score: 79, agent_score: null, source: "apify_maps", last_channel: "email", last_message_preview: "Approved the creative — go ahead and launch.", last_contact_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(), created_at: "", updated_at: "", notes: null, tier: "proof_brand", mrr: 4200 },
  { id: "d-elist2", business_name: "Newlands Window Cleaning", kind: "client", stage: "delivering", contact_name: "Andre Pieterse", niche: "Window cleaning", city: "Newlands", icp_fit_score: 75, agent_score: null, source: "referral", last_channel: "whatsapp", last_message_preview: "Got 2 leads today, thanks!", last_contact_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(), created_at: "", updated_at: "", notes: null, tier: "proof_sprint", mrr: 8500 },
  { id: "d-elist3", business_name: "Roofworx CT", kind: "prospect", stage: "engaged", contact_name: "Mike Daniels", niche: "Roofing", city: "Tokai", icp_fit_score: 92, agent_score: 0.84, source: "inbound_dm", last_channel: "instagram", last_message_preview: "Yeah send me the report…", last_contact_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(), created_at: "", updated_at: "", notes: null, tier: null },
];

export function EntityList() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [tab, setTab] = useState("all");
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.entities.list()
      .then((rows) => {
        if (rows.length === 0) { setEntities(DEMO_ENTITIES); setIsDemo(true); }
        else { setEntities(rows as Entity[]); setIsDemo(false); }
      })
      .catch(() => { setEntities(DEMO_ENTITIES); setIsDemo(true); });
  }, []);

  const clientStages: PipelineStage[] = ["onboarding", "active", "delivering"];
  const prospectStages: PipelineStage[] = ["source", "cold", "contacted", "engaged", "booked"];

  const filtered = entities.filter((e) => {
    if (tab === "all") return true;
    if (tab === "clients") return e.kind === "client" || clientStages.includes(e.stage);
    if (tab === "prospects") return e.kind === "prospect" || prospectStages.includes(e.stage);
    return true;
  });

  const counts = {
    all: entities.length,
    clients: entities.filter((e) => e.kind === "client" || clientStages.includes(e.stage)).length,
    prospects: entities.filter((e) => e.kind === "prospect" || prospectStages.includes(e.stage)).length,
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 px-4 py-3">
      <div className="flex items-center justify-between mb-1">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "all", label: "All", count: counts.all },
            { id: "clients", label: "Clients", count: counts.clients },
            { id: "prospects", label: "Prospects", count: counts.prospects },
          ]}
        />
        {isDemo && (
          <span className="text-[10px] font-mono uppercase tracking-cap text-paper-3 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-warn" /> demo
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto mt-3 bg-ink-200 border border-line rounded-[10px]">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-3.5 py-2.5 border-b border-line text-2xs uppercase tracking-cap text-paper-3 font-medium sticky top-0 bg-ink-200">
          <span>Business</span>
          <span>Stage</span>
          <span>Tier</span>
          <span>MRR</span>
          <span>ICP</span>
          <span>Last touch</span>
        </div>

        {filtered.map((e) => {
          const tagKind = stageTag[e.stage] ?? "muted";
          const stageLabel = STAGE_LABELS[e.stage as PipelineStage] ?? e.stage;
          return (
            <button
              key={e.id}
              onClick={() => navigate(ROUTES.entity(e.id))}
              className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-3.5 py-2.5 border-b border-line text-left hover:bg-ink-50 transition-colors items-center"
            >
              <div className="min-w-0">
                <div className="text-sm text-paper truncate">{e.business_name}</div>
                <div className="text-2xs text-paper-3 truncate mt-0.5">
                  {e.contact_name ?? e.niche ?? "—"} · {e.city ?? "—"}
                </div>
              </div>
              <div>
                <Tag kind={tagKind}>{stageLabel}</Tag>
              </div>
              <div className="text-xs text-paper-2">
                {e.tier ? TIER_LABELS[e.tier] : "—"}
              </div>
              <div className="font-mono text-xs text-paper">
                {(e.mrr ?? 0) > 0 ? fmtZAR(e.mrr!) : "—"}
              </div>
              <div className="font-mono text-xs text-paper-2">
                {e.icp_fit_score != null ? `${e.icp_fit_score}` : "—"}
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
