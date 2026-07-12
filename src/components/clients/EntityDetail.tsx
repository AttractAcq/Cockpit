import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
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
  PIPELINE_STAGES,
  STAGE_LABELS,
  TIER_LABELS,
  type Asset,
  type AgentEvent,
  type Campaign,
  type Conversation,
  type Entity,
  type PipelineStage,
} from "@/types";

type EditForm = {
  business_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  niche: string;
  city: string;
  stage: PipelineStage;
  notes: string;
};

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

const fieldInputClass = "w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-paper outline-none placeholder:text-paper-3 focus:border-line-2";

export function EntityDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [entity, setEntity] = useState<Entity | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [messageStatus, setMessageStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [messageError, setMessageError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editStatus, setEditStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [editError, setEditError] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void mockApi.clients.byId(id).then((e) => setEntity(e as Entity | null));
    void mockApi.conversations.list().then((all) =>
      setConversations((all as Conversation[]).filter((c) => c.entity_id === id))
    );
    void mockApi.campaigns.list().then((all) =>
      setCampaigns((all as Campaign[]).filter((c) => c.entity_id === id))
    );
    void mockApi.assets.list().then((all) =>
      setAssets((all as Asset[]).filter((a) => a.entity_id === id))
    );
    void mockApi.operations.agentEvents().then((all) =>
      setAgentEvents((all as AgentEvent[]).filter((e) => e.entity_id === id))
    );
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

  const currentEntity = entity;
  const stage = currentEntity.stage as PipelineStage;
  const tagKind = stageTag[stage] ?? "muted";
  const stageLabel = STAGE_LABELS[stage] ?? stage;
  const initials = currentEntity.business_name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0])
    .join("")
    .toUpperCase();

  const icpScore = currentEntity.icp_fit_score ?? 0;
  const entityRecord = currentEntity as Entity & {
    contact_email?: string | null;
    contact_phone?: string | null;
  };
  const contactEmail = currentEntity.email ?? entityRecord.contact_email ?? "";
  const contactPhone = currentEntity.whatsapp_number ?? entityRecord.contact_phone ?? "";
  const messageTarget = contactPhone || contactEmail;

  function openMessage() {
    setActionsOpen(false);
    if (conversations[0]) {
      navigate(ROUTES.conversation(conversations[0].id));
      return;
    }

    setMessageError(null);
    setMessageStatus("idle");
    setMessageOpen(true);
  }

  function openEdit() {
    setActionsOpen(false);
    setEditError(null);
    setEditStatus("idle");
    setEditForm({
      business_name: currentEntity.business_name,
      contact_name: currentEntity.contact_name ?? "",
      contact_phone: contactPhone,
      contact_email: contactEmail,
      niche: currentEntity.niche ?? "",
      city: currentEntity.city ?? "",
      stage,
      notes: currentEntity.notes ?? "",
    });
    setEditOpen(true);
  }

  async function sendMessage() {
    if (!messageText.trim() || messageStatus === "sending") return;
    if (!messageTarget) {
      setMessageError("Add a phone number or email before sending a message.");
      return;
    }

    setMessageStatus("sending");
    setMessageError(null);
    try {
      await mockApi.conversations.send({
        entity_id: currentEntity.id,
        to: messageTarget,
        body: messageText.trim(),
      });
      setMessageStatus("sent");
      setMessageText("");
      window.setTimeout(() => {
        setMessageOpen(false);
        setMessageStatus("idle");
      }, 900);
    } catch (error) {
      setMessageStatus("error");
      setMessageError(error instanceof Error ? error.message : "Message failed to send.");
    }
  }

  async function saveEdit() {
    if (!editForm || editStatus === "saving") return;
    if (!editForm.business_name.trim()) {
      setEditError("Business name is required.");
      return;
    }

    setEditStatus("saving");
    setEditError(null);
    try {
      const updated = await mockApi.entities.update(currentEntity.id, {
        business_name: editForm.business_name.trim(),
        contact_name: editForm.contact_name.trim() || null,
        contact_phone: editForm.contact_phone.trim() || null,
        contact_email: editForm.contact_email.trim() || null,
        niche: editForm.niche.trim() || null,
        city: editForm.city.trim() || null,
        stage: editForm.stage,
        notes: editForm.notes.trim() || null,
      }) as Record<string, unknown>;

      setEntity((current) => current ? {
        ...current,
        ...updated,
        business_name: String(updated.business_name ?? editForm.business_name),
        contact_name: (updated.contact_name as string | null) ?? null,
        whatsapp_number: ((updated.contact_phone as string | null) ?? editForm.contact_phone) || null,
        email: ((updated.contact_email as string | null) ?? editForm.contact_email) || null,
        niche: (updated.niche as string | null) ?? null,
        city: (updated.city as string | null) ?? null,
        stage: (updated.stage as PipelineStage | undefined) ?? editForm.stage,
        notes: (updated.notes as string | null) ?? null,
        updated_at: (updated.updated_at as string | undefined) ?? current.updated_at,
      } : current);
      setEditStatus("saved");
      window.setTimeout(() => {
        setEditOpen(false);
        setEditStatus("idle");
      }, 700);
    } catch (error) {
      setEditStatus("error");
      setEditError(error instanceof Error ? error.message : "Could not save changes.");
    }
  }

  async function copyEntityId() {
    setActionsOpen(false);
    try {
      await navigator.clipboard.writeText(currentEntity.id);
      setActionNote("Entity ID copied");
      window.setTimeout(() => setActionNote(null), 1800);
    } catch {
      setActionNote("Copy failed");
      window.setTimeout(() => setActionNote(null), 1800);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3.5">
      <button
        onClick={() => navigate(-1)}
        className="text-xs text-paper-3 hover:text-paper flex items-center gap-1 self-start transition-colors"
      >
        <Icon name="arrow-left" size={12} /> Back
      </button>

      {/* Header */}
      <div className="bg-ink-200 border border-line rounded-[10px] p-4 flex items-start gap-4">
        <div className="w-12 h-12 rounded-full bg-ink-100 border border-line flex items-center justify-center font-medium text-paper text-sm flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            <Tag kind={tagKind}>{stageLabel}</Tag>
            {entity.tier && <Tag kind="approve">{TIER_LABELS[entity.tier]}</Tag>}
            {(entity.tags ?? []).map((t) => (
              <span key={t} className="font-mono text-2xs text-paper-3 border border-line px-1.5 py-0.5 rounded-[3px]">
                {t}
              </span>
            ))}
          </div>
          <h1 className="font-serif text-2xl text-paper leading-tight">{entity.business_name}</h1>
          <div className="text-xs text-paper-3 mt-1">
            {entity.contact_name && <span>{entity.contact_name} · </span>}
            {entity.niche ?? "—"} · {entity.city ?? "—"}
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
        <div className="relative flex gap-1.5 flex-shrink-0">
          <Button variant="primary" size="sm" onClick={openMessage}>Message</Button>
          <Button variant="secondary" size="sm" onClick={openEdit}>Edit</Button>
          <Button
            variant="subtle"
            size="sm"
            onClick={() => setActionsOpen((open) => !open)}
            aria-label="Entity actions"
            aria-expanded={actionsOpen}
          >
            <Icon name="more" size={13} />
          </Button>
          {actionsOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-48 overflow-hidden rounded-lg border border-line bg-ink-200 shadow-2xl">
              <button
                type="button"
                onClick={openMessage}
                className="w-full px-3 py-2 text-left text-xs text-paper-2 hover:bg-ink-100 hover:text-paper"
              >
                {conversations[0] ? "Open message thread" : "New message"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionsOpen(false);
                  navigate(`${ROUTES.pipeline}?stage=${currentEntity.stage}`);
                }}
                className="w-full px-3 py-2 text-left text-xs text-paper-2 hover:bg-ink-100 hover:text-paper"
              >
                View in pipeline
              </button>
              <button
                type="button"
                onClick={copyEntityId}
                className="w-full px-3 py-2 text-left text-xs text-paper-2 hover:bg-ink-100 hover:text-paper"
              >
                Copy entity ID
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionsOpen(false);
                  navigate(ROUTES.settings);
                }}
                className="w-full px-3 py-2 text-left text-xs text-paper-2 hover:bg-ink-100 hover:text-paper"
              >
                Open settings
              </button>
            </div>
          )}
        </div>
      </div>
      {actionNote && (
        <div className="fixed right-4 bottom-12 z-50 rounded-md border border-line bg-ink-200 px-3 py-2 text-xs text-paper-2 shadow-2xl">
          {actionNote}
        </div>
      )}

      {/* Stat grid */}
      <div className="grid grid-cols-4 gap-3">
        <Stat label="MRR" value={(entity.mrr ?? 0) > 0 ? fmtZAR(entity.mrr!) : "—"} />
        <Stat label="Pipeline value" value={(entity.pipeline_value ?? 0) > 0 ? fmtZAR(entity.pipeline_value!) : "—"} />
        <Stat
          label="ICP score"
          value={`${icpScore}`}
          sub={icpScore >= 80 ? "top fit" : icpScore >= 65 ? "good fit" : "watch"}
          accent={icpScore >= 80 ? "teal" : "paper"}
        />
        <Stat
          label="Agent score"
          value={entity.agent_score !== null && entity.agent_score !== undefined ? entity.agent_score.toFixed(2) : "—"}
          sub={entity.agent_score != null ? entity.agent_score >= 0.7 ? "hot" : entity.agent_score >= 0.4 ? "warm" : "cold" : ""}
          accent={entity.agent_score != null && entity.agent_score >= 0.7 ? "teal" : "paper"}
        />
      </div>

      {/* Two-col layout */}
      <div className="grid grid-cols-[1fr_320px] gap-3.5 flex-1 min-h-0">
        <div className="flex flex-col gap-3.5">
          <Panel title="Conversations" meta={`${conversations.length} thread${conversations.length === 1 ? "" : "s"}`}>
            {conversations.length === 0 ? (
              <div className="px-3 py-6"><EmptyState icon="chat" title="No conversations yet" /></div>
            ) : (
              conversations.map((conv, i) => (
                <button
                  key={conv.id}
                  onClick={() => navigate(ROUTES.conversation(conv.id))}
                  className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-ink-50 transition-colors ${i < conversations.length - 1 ? "border-b border-line" : ""}`}
                >
                  <ChannelBadge channel={conv.channel} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-paper truncate">{conv.subject ?? `${conv.channel.toUpperCase()} thread`}</div>
                    <div className="text-xs text-paper-3 mt-0.5 truncate">{conv.last_message_preview}</div>
                  </div>
                  <span className="font-mono text-2xs text-paper-3">{fmtAgo(conv.last_message_at)}</span>
                </button>
              ))
            )}
          </Panel>

          <Panel title="Campaigns" meta={`${campaigns.length} run`}>
            {campaigns.length === 0 ? (
              <div className="px-3 py-6"><EmptyState icon="campaign" title="No campaigns yet" /></div>
            ) : (
              campaigns.map((c, i) => (
                <button
                  key={c.id}
                  onClick={() => navigate(ROUTES.campaign(c.id))}
                  className={`w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-ink-50 transition-colors ${i < campaigns.length - 1 ? "border-b border-line" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-paper truncate">{c.name}</div>
                    <div className="text-2xs text-paper-3 mt-0.5 font-mono">{fmtZAR(c.spend_total ?? 0)} spent · {c.leads ?? 0} leads</div>
                  </div>
                  <Tag kind={c.status === "live" ? "reply" : c.status === "flagged" ? "anomaly" : "muted"}>{c.status}</Tag>
                </button>
              ))
            )}
          </Panel>

          <Panel title="Assets" meta={`${assets.length} file${assets.length === 1 ? "" : "s"}`}>
            {assets.length === 0 ? (
              <div className="px-3 py-6"><EmptyState icon="library" title="No assets yet" /></div>
            ) : (
              assets.map((a, i) => (
                <div key={a.id} className={`px-3 py-2 flex items-center gap-2.5 ${i < assets.length - 1 ? "border-b border-line" : ""}`}>
                  <Icon name="library" size={14} className="text-paper-3" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-paper truncate">{a.title}</div>
                    <div className="text-2xs text-paper-3 font-mono">{a.file_name}</div>
                  </div>
                  <Button variant="subtle" size="sm"><Icon name="download" size={12} /></Button>
                </div>
              ))
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-3.5">
          <Panel title="Activity">
            <div className="px-3 py-3 flex flex-col gap-2">
              {agentEvents.length === 0 ? (
                <div className="text-xs text-paper-3 text-center py-2">No agent activity yet</div>
              ) : (
                agentEvents.slice(0, 5).map((evt) => (
                  <div key={evt.id} className="text-xs text-paper-2 leading-snug border-l-2 border-line pl-2.5">
                    <div className="font-mono uppercase tracking-cap text-[9.5px] text-teal">{evt.action}</div>
                    <div className="text-paper-2 mt-0.5">{(evt.description ?? "").replace(/\*\*/g, "")}</div>
                    <div className="text-paper-3 font-mono text-2xs mt-0.5">{fmtAgo(evt.created_at)} · {evt.agent_name}</div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel title="Profile">
            <div className="px-3 py-3 flex flex-col gap-2 text-xs">
              <Row label="Source" value={entity.source?.replace(/_/g, " ") ?? "—"} />
              <Row label="Account mgr" value={entity.account_manager_name ?? "—"} />
              <Row label="Added" value={fmtDateLong(entity.created_at)} />
              <Row label="Last update" value={fmtAgo(entity.updated_at) + " ago"} />
              {entity.stage_changed_at && (
                <Row label="Stage since" value={fmtAgo(entity.stage_changed_at) + " ago"} />
              )}
            </div>
          </Panel>

          {entity.notes && (
            <Panel title="Notes">
              <div className="px-3 py-3 text-xs text-paper-2 leading-relaxed">{entity.notes}</div>
            </Panel>
          )}
        </div>
      </div>

      {messageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className="w-full max-w-[520px] rounded-[10px] border border-line bg-ink-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <div className="text-sm font-medium text-paper">Message {currentEntity.business_name}</div>
                <div className="text-2xs text-paper-3 font-mono">
                  {messageTarget || "No phone or email on this record"}
                </div>
              </div>
              <Button variant="subtle" size="sm" onClick={() => setMessageOpen(false)}>
                <Icon name="x" size={13} />
              </Button>
            </div>
            <div className="px-4 py-3 flex flex-col gap-3">
              {messageError && (
                <div className="rounded-md border border-neg/30 bg-neg-dim px-3 py-2 text-xs text-neg">
                  {messageError}
                </div>
              )}
              {messageStatus === "sent" && (
                <div className="rounded-md border border-teal/30 bg-teal-dim px-3 py-2 text-xs text-teal">
                  Message queued.
                </div>
              )}
              <textarea
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={5}
                placeholder="Type a message..."
                className="w-full resize-none rounded-lg border border-line bg-ink px-3 py-2 text-sm text-paper outline-none placeholder:text-paper-3 focus:border-line-2"
              />
              <div className="flex items-center justify-between">
                <span className="text-2xs text-paper-3">Cmd/Ctrl + Enter to send</span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setMessageOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void sendMessage()}
                    disabled={messageStatus === "sending" || !messageText.trim()}
                    className={messageStatus === "sending" || !messageText.trim() ? "opacity-50 cursor-not-allowed" : ""}
                  >
                    {messageStatus === "sending" ? "Sending..." : "Send"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {editOpen && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
          <div className="w-full max-w-[680px] rounded-[10px] border border-line bg-ink-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-sm font-medium text-paper">Edit client profile</div>
              <Button variant="subtle" size="sm" onClick={() => setEditOpen(false)}>
                <Icon name="x" size={13} />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 py-4">
              <Field label="Business name">
                <input
                  value={editForm.business_name}
                  onChange={(event) => setEditForm({ ...editForm, business_name: event.target.value })}
                  className={fieldInputClass}
                />
              </Field>
              <Field label="Contact name">
                <input
                  value={editForm.contact_name}
                  onChange={(event) => setEditForm({ ...editForm, contact_name: event.target.value })}
                  className={fieldInputClass}
                />
              </Field>
              <Field label="Phone">
                <input
                  value={editForm.contact_phone}
                  onChange={(event) => setEditForm({ ...editForm, contact_phone: event.target.value })}
                  className={fieldInputClass}
                />
              </Field>
              <Field label="Email">
                <input
                  value={editForm.contact_email}
                  onChange={(event) => setEditForm({ ...editForm, contact_email: event.target.value })}
                  className={fieldInputClass}
                />
              </Field>
              <Field label="Niche">
                <input
                  value={editForm.niche}
                  onChange={(event) => setEditForm({ ...editForm, niche: event.target.value })}
                  className={fieldInputClass}
                />
              </Field>
              <Field label="City">
                <input
                  value={editForm.city}
                  onChange={(event) => setEditForm({ ...editForm, city: event.target.value })}
                  className={fieldInputClass}
                />
              </Field>
              <Field label="Stage">
                <select
                  value={editForm.stage}
                  onChange={(event) => setEditForm({ ...editForm, stage: event.target.value as PipelineStage })}
                  className={fieldInputClass}
                >
                  {PIPELINE_STAGES.map((pipelineStage) => (
                    <option key={pipelineStage} value={pipelineStage}>{STAGE_LABELS[pipelineStage]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Notes" className="col-span-2">
                <textarea
                  value={editForm.notes}
                  onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })}
                  rows={4}
                  className={`${fieldInputClass} resize-none`}
                />
              </Field>
            </div>
            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <div className="text-xs">
                {editError && <span className="text-neg">{editError}</span>}
                {editStatus === "saved" && <span className="text-teal">Saved.</span>}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void saveEdit()}
                  disabled={editStatus === "saving"}
                  className={editStatus === "saving" ? "opacity-50 cursor-not-allowed" : ""}
                >
                  {editStatus === "saving" ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, accent = "paper" }: { label: string; value: string; sub?: string; accent?: "paper" | "teal" }) {
  const valColor = accent === "teal" ? "text-teal" : "text-paper";
  return (
    <div className="bg-ink-200 border border-line rounded-[10px] px-3 py-3">
      <div className="text-[9.5px] uppercase tracking-cap text-paper-3">{label}</div>
      <div className={`font-serif text-[22px] mt-1 leading-none ${valColor}`}>{value}</div>
      {sub && <div className="text-2xs text-paper-3 mt-1">{sub}</div>}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-paper-3 text-2xs uppercase tracking-cap">{label}</span>
      <span className="text-paper-2 font-mono text-right">{value}</span>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-2xs uppercase tracking-cap text-paper-3">{label}</span>
      {children}
    </label>
  );
}
