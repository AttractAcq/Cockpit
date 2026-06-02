import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Button,
  ChannelBadge,
  EmptyState,
  Icon,
  Panel,
  Tag,
  type TagKind,
} from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import {
  fmtAgo,
  fmtPhoneMasked,
  fmtZAR,
  fmtDateLong,
} from "@/lib/format";
import {
  STAGE_LABELS,
  TIER_LABELS,
  type Asset,
  type AgentEvent,
  type Campaign,
  type Conversation,
  type Entity,
  type PipelineStage,
} from "@/types";

const stageTag: Partial<Record<PipelineStage, TagKind>> = {
  cold: "muted",
  contacted: "task",
  engaged: "reply",
  booked: "approve",
  onboarding: "decision",
  active: "reply",
  delivering: "approve",
};

export function EntityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);

  useEffect(() => {
    if (!id) return;
    void mockApi.clients.byId(id).then(setEntity);
    void mockApi.conversations.list().then((all) => {
      setConversations(all.filter((c) => c.entity_id === id));
    });
    void mockApi.campaigns.list().then((all) => {
      setCampaigns(all.filter((c) => c.entity_id === id));
    });
    void mockApi.studio.byEntity(id).then(setAssets);
    void mockApi.operations.agentEvents().then((all) => {
      setAgentEvents(all.filter((e) => e.entity_id === id));
    });
  }, [id]);

  if (!entity) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon="users"
          title="Entity not found"
          body="This record doesn't exist or was archived."
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate(ROUTES.clients)}>
              Back to clients
            </Button>
          }
        />
      </div>
    );
  }

  const tagKind = stageTag[entity.pipeline_stage] ?? "muted";
  const initials = entity.business_name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3.5">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="text-xs text-paper-3 hover:text-paper flex items-center gap-1 self-start transition-colors"
      >
        <Icon name="arrow-left" size={12} /> Back
      </button>

      {/* Header */}
      <div className="bg-ink-200 border border-line rounded-[10px] p-4 flex items-start gap-4">
        <Avatar initials={initials} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            <Tag kind={tagKind}>{STAGE_LABELS[entity.pipeline_stage]}</Tag>
            {entity.tier && (
              <Tag kind="approve">{TIER_LABELS[entity.tier]}</Tag>
            )}
            {entity.tags.map((t) => (
              <span
                key={t}
                className="font-mono text-2xs text-paper-3 border border-line px-1.5 py-0.5 rounded-[3px]"
              >
                {t}
              </span>
            ))}
          </div>
          <h1 className="font-serif text-2xl text-paper leading-tight">
            {entity.business_name}
          </h1>
          <div className="text-xs text-paper-3 mt-1">
            {entity.contact_name && <span>{entity.contact_name} · </span>}
            {entity.industry} · {entity.location}
          </div>
          <div className="flex items-center gap-3 mt-2.5 text-xs text-paper-2">
            {entity.instagram_handle && (
              <span className="flex items-center gap-1">
                <ChannelBadge channel="instagram" /> {entity.instagram_handle}
              </span>
            )}
            {entity.whatsapp_number && (
              <span className="flex items-center gap-1">
                <ChannelBadge channel="whatsapp" />
                <span className="font-mono">{fmtPhoneMasked(entity.whatsapp_number)}</span>
              </span>
            )}
            {entity.email && (
              <span className="flex items-center gap-1">
                <ChannelBadge channel="email" />
                <span className="font-mono">{entity.email}</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <Button variant="primary" size="sm">Message</Button>
          <Button variant="secondary" size="sm">Edit</Button>
          <Button variant="subtle" size="sm">
            <Icon name="more" size={13} />
          </Button>
        </div>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-4 gap-3">
        <Stat label="MRR" value={entity.mrr > 0 ? fmtZAR(entity.mrr) : "—"} />
        <Stat
          label="Pipeline value"
          value={entity.pipeline_value > 0 ? fmtZAR(entity.pipeline_value) : "—"}
        />
        <Stat
          label="ICP score"
          value={`${entity.icp_score}`}
          sub={entity.icp_score >= 80 ? "top fit" : entity.icp_score >= 65 ? "good fit" : "watch"}
          accent={entity.icp_score >= 80 ? "teal" : "paper"}
        />
        <Stat
          label="Agent score"
          value={entity.agent_score !== null ? entity.agent_score.toFixed(2) : "—"}
          sub={
            entity.agent_score !== null
              ? entity.agent_score >= 0.7
                ? "hot"
                : entity.agent_score >= 0.4
                  ? "warm"
                  : "cold"
              : ""
          }
          accent={entity.agent_score !== null && entity.agent_score >= 0.7 ? "teal" : "paper"}
        />
      </div>

      {/* Two-col layout */}
      <div className="grid grid-cols-[1fr_320px] gap-3.5 flex-1 min-h-0">
        {/* Left: timeline */}
        <div className="flex flex-col gap-3.5">
          <Panel
            title="Conversations"
            meta={`${conversations.length} thread${conversations.length === 1 ? "" : "s"}`}
          >
            {conversations.length === 0 ? (
              <div className="px-3 py-6">
                <EmptyState icon="chat" title="No conversations yet" />
              </div>
            ) : (
              conversations.map((conv, i) => (
                <button
                  key={conv.id}
                  onClick={() => navigate(ROUTES.conversation(conv.id))}
                  className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-ink-50 transition-colors ${
                    i < conversations.length - 1 ? "border-b border-line" : ""
                  }`}
                >
                  <ChannelBadge channel={conv.channel} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-paper truncate">
                      {conv.subject ?? `${conv.channel.toUpperCase()} thread`}
                    </div>
                    <div className="text-xs text-paper-3 mt-0.5 truncate">
                      {conv.last_message_preview}
                    </div>
                  </div>
                  <span className="font-mono text-2xs text-paper-3">
                    {fmtAgo(conv.last_message_at)}
                  </span>
                </button>
              ))
            )}
          </Panel>

          <Panel title="Campaigns" meta={`${campaigns.length} run`}>
            {campaigns.length === 0 ? (
              <div className="px-3 py-6">
                <EmptyState icon="campaign" title="No campaigns yet" />
              </div>
            ) : (
              campaigns.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => navigate(ROUTES.campaign(c.id))}
                  className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-ink-50 transition-colors ${
                    i < campaigns.length - 1 ? "border-b border-line" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-paper truncate">{c.name}</div>
                    <div className="text-2xs text-paper-3 mt-0.5 font-mono">
                      {fmtZAR(c.spend_total)} spent · {c.leads} leads
                    </div>
                  </div>
                  <Tag
                    kind={
                      c.status === "live"
                        ? "reply"
                        : c.status === "flagged"
                          ? "anomaly"
                          : "muted"
                    }
                  >
                    {c.status}
                  </Tag>
                </button>
              ))
            )}
          </Panel>

          <Panel title="Assets" meta={`${assets.length} file${assets.length === 1 ? "" : "s"}`}>
            {assets.length === 0 ? (
              <div className="px-3 py-6">
                <EmptyState icon="library" title="No assets yet" />
              </div>
            ) : (
              assets.map((a, i) => (
                <div
                  key={a.id}
                  className={`px-3 py-2 flex items-center gap-2.5 ${
                    i < assets.length - 1 ? "border-b border-line" : ""
                  }`}
                >
                  <Icon name="library" size={14} className="text-paper-3" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-paper truncate">{a.title}</div>
                    <div className="text-2xs text-paper-3 font-mono">{a.file_name}</div>
                  </div>
                  <Button variant="subtle" size="sm">
                    <Icon name="download" size={12} />
                  </Button>
                </div>
              ))
            )}
          </Panel>
        </div>

        {/* Right: meta */}
        <div className="flex flex-col gap-3.5">
          <Panel title="Activity">
            <div className="px-3 py-3 flex flex-col gap-2">
              {agentEvents.length === 0 ? (
                <div className="text-xs text-paper-3 text-center py-2">
                  No agent activity yet
                </div>
              ) : (
                agentEvents.slice(0, 5).map((evt) => (
                  <div
                    key={evt.id}
                    className="text-xs text-paper-2 leading-snug border-l-2 border-line pl-2.5"
                  >
                    <div className="font-mono uppercase tracking-cap text-[9.5px] text-teal">
                      {evt.action}
                    </div>
                    <div className="text-paper-2 mt-0.5">
                      {evt.description.replace(/\*\*/g, "")}
                    </div>
                    <div className="text-paper-3 font-mono text-2xs mt-0.5">
                      {fmtAgo(evt.created_at)} · {evt.agent_name}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Profile">
            <div className="px-3 py-3 flex flex-col gap-2 text-xs">
              <Row label="Source" value={entity.source.replace(/_/g, " ")} />
              <Row label="Account mgr" value={entity.account_manager_name ?? "—"} />
              <Row label="Added" value={fmtDateLong(entity.created_at)} />
              <Row label="Last update" value={fmtAgo(entity.updated_at) + " ago"} />
              <Row label="Stage since" value={fmtAgo(entity.stage_changed_at) + " ago"} />
            </div>
          </Panel>

          {entity.notes && (
            <Panel title="Notes">
              <div className="px-3 py-3 text-xs text-paper-2 leading-relaxed">
                {entity.notes}
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = "paper",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "paper" | "teal";
}) {
  const valColor = accent === "teal" ? "text-teal" : "text-paper";
  return (
    <div className="bg-ink-200 border border-line rounded-[10px] px-3 py-3">
      <div className="text-[9.5px] uppercase tracking-cap text-paper-3">{label}</div>
      <div className={`font-serif text-[22px] mt-1 leading-none ${valColor}`}>
        {value}
      </div>
      {sub && <div className="text-2xs text-paper-3 mt-1">{sub}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 capitalize">
      <span className="text-paper-3 text-2xs uppercase tracking-cap">{label}</span>
      <span className="text-paper-2 font-mono text-right">{value}</span>
    </div>
  );
}
