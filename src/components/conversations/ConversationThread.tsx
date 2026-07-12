import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, ChannelBadge, EmptyState, Icon, Tag } from "@/components/primitives";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { ROUTES } from "@/lib/constants";
import { fmtDateLong } from "@/lib/format";
import type { Conversation, Message } from "@/types";

type SendState = "idle" | "sending" | "sent" | "error";

export function ConversationThread() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);

  const [agentDraft, setAgentDraft] = useState<string | null>(null);
  const [sendState, setSendState] = useState<SendState>("idle");

  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch conversation header + messages; subscribe to live message changes
  useEffect(() => {
    if (!id) {
      setConversation(null);
      setMessages([]);
      setAgentDraft(null);
      setConvError(null);
      return;
    }

    // Conversation header
    setConvLoading(true);
    setConvError(null);
    api.conversations.byId(id)
      .then((conv) => setConversation(conv as Conversation | null))
      .catch((err) => setConvError(err instanceof Error ? err.message : String(err)))
      .finally(() => setConvLoading(false));

    // Messages — initial load
    setMsgsLoading(true);
    api.conversations.messages(id)
      .then((msgs) => setMessages(msgs as Message[]))
      .catch(() => {})
      .finally(() => setMsgsLoading(false));

    // Realtime: re-fetch messages for this conversation on any messages change
    const channel = supabase
      .channel(`rt:messages:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, () => {
        api.conversations.messages(id)
          .then((msgs) => setMessages(msgs as Message[]))
          .catch(() => {});
      })
      .subscribe();

    // Agent draft: check triage for a body_meta linked to this conversation
    api.triage.list()
      .then((items) => {
        const related = (items as Array<{ related_resource_id: string | null; body_meta: string | null }>)
          .find((t) => t.related_resource_id === id);
        setAgentDraft(related?.body_meta ?? null);
      })
      .catch(() => {});

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (text: string) => {
    if (!conversation?.entity_id) return;
    setSendState("sending");
    try {
      await api.conversations.send({
        entity_id: conversation.entity_id,
        conversation_id: conversation.id,
        to: conversation.entity_id,
        body: text,
      });
      setSendState("sent");
      setTimeout(() => setSendState("idle"), 2000);
    } catch {
      setSendState("error");
      setTimeout(() => setSendState("idle"), 4000);
    }
  };

  if (!id) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon="chat"
          title="Pick a conversation"
          body="Select a thread from the list to view messages, AI suggestions and reply options."
        />
      </div>
    );
  }

  if (convLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-paper-3 text-sm">
        Loading…
      </div>
    );
  }

  if (convError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon="chat"
          title="Failed to load conversation"
          body={convError}
        />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <EmptyState
          icon="chat"
          title="Conversation not found"
          body="This thread may have been removed or the ID is incorrect."
        />
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      {/* Thread header */}
      <div className="h-14 border-b border-line flex items-center px-4 gap-3 flex-shrink-0">
        <ChannelBadge channel={conversation.channel} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-paper font-medium truncate">
            {conversation.entity_name ?? "Unknown"}
          </div>
          <div className="text-2xs text-paper-3 font-mono">
            {conversation.subject ?? `${conversation.channel.toUpperCase()} thread`}
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => conversation.entity_id && navigate(ROUTES.entity(conversation.entity_id))}
          disabled={!conversation.entity_id}
        >
          <Icon name="external" size={11} className="inline mr-1" />
          Open entity
        </Button>
        <Button variant="subtle" size="sm"><Icon name="more" size={13} /></Button>
      </div>

      {/* Message thread */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {msgsLoading && messages.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-paper-3 text-xs font-mono">
            Loading messages…
          </div>
        )}
        {!msgsLoading && messages.length === 0 && (
          <EmptyState
            icon="chat"
            title="No messages yet"
            body="This thread has no messages on record."
          />
        )}
        {messages.length > 0 && (
          <>
            <div className="self-center text-2xs text-paper-3 font-mono">
              {fmtDateLong(messages[0].sent_at)}
            </div>
            {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Agent draft ribbon — only shown when a real draft is available */}
      {agentDraft && (
        <div className="mx-4 mb-2 bg-teal-dim border border-[rgba(0,229,195,0.25)] rounded-lg px-3 py-2 flex items-start gap-2.5">
          <Tag kind="approve">Agent draft</Tag>
          <div className="text-xs text-paper-2 italic flex-1">{agentDraft}</div>
          <div className="flex gap-1.5 flex-shrink-0">
            <Button variant="primary" size="sm">Use</Button>
            <Button variant="subtle" size="sm">Edit</Button>
          </div>
        </div>
      )}

      {/* Composer — send is BLOCKED until 360dialog is approved */}
      <Composer
        onSend={handleSend}
        sendState={sendState}
        blocked
        blockedReason="BLOCKED — external · send activates once 360dialog is approved for this account."
      />
    </div>
  );
}
