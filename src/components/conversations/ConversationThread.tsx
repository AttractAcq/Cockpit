import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, ChannelBadge, EmptyState, Icon, Tag } from "@/components/primitives";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtDateLong } from "@/lib/format";
import type { Conversation, Message } from "@/types";

export function ConversationThread() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [agentDraft, setAgentDraft] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setConversation(null);
      setMessages([]);
      setAgentDraft(null);
      return;
    }
    void mockApi.conversations.byId(id).then((conv) => setConversation(conv as Conversation | null));
    void mockApi.conversations.messages(id).then((msgs) => setMessages(msgs as Message[]));

    // Pull agent draft suggestion from open triage items for this conversation
    mockApi.triage.list().then((items) => {
      const related = (items as Array<{ related_resource_id: string | null; body_meta: string | null }>).find(
        (t) => t.related_resource_id === id
      );
      setAgentDraft(related?.body_meta ?? null);
    }).catch(() => {});
  }, [id]);

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

  if (!conversation) {
    return (
      <div className="flex-1 flex items-center justify-center text-paper-3 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="h-14 border-b border-line flex items-center px-4 gap-3 flex-shrink-0">
        <ChannelBadge channel={conversation.channel} size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-paper font-medium truncate">{conversation.entity_name}</div>
          <div className="text-2xs text-paper-3 font-mono">
            {conversation.subject ?? `${conversation.channel.toUpperCase()} thread`}
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => conversation.entity_id && navigate(ROUTES.entity(conversation.entity_id))}
        >
          <Icon name="external" size={11} className="inline mr-1" />
          Open entity
        </Button>
        <Button variant="subtle" size="sm"><Icon name="more" size={13} /></Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {messages.length === 0 ? (
          <EmptyState icon="chat" title="No messages yet" body="This thread has no messages on record." />
        ) : (
          <>
            <div className="self-center text-2xs text-paper-3 font-mono">
              {fmtDateLong(messages[0].sent_at)}
            </div>
            {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
          </>
        )}
      </div>

      {/* Agent suggestion ribbon */}
      <div className="mx-4 mb-2 bg-teal-dim border border-[rgba(0,229,195,0.25)] rounded-lg px-3 py-2 flex items-start gap-2.5">
        <Tag kind="approve">Agent draft</Tag>
        <div className="text-xs text-paper-2 italic flex-1">
          {agentDraft ?? '"Yes — both residential and industrial. Quick check: which is most of your pipeline today?"'}
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <Button variant="primary" size="sm">Use</Button>
          <Button variant="subtle" size="sm">Edit</Button>
        </div>
      </div>

      <Composer />
    </div>
  );
}
