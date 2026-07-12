import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChannelBadge, EmptyState, Tabs, Icon } from "@/components/primitives";
import { api } from "@/lib/api";
import { useRealtimeList } from "@/hooks/useRealtime";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { Conversation } from "@/types";

function SkeletonRow() {
  return (
    <div className="w-full px-3 py-2.5 flex items-start gap-2.5 border-b border-line animate-pulse">
      <div className="w-[18px] h-[18px] rounded bg-ink-100 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1.5">
          <div className="h-3.5 w-28 bg-ink-100 rounded" />
          <div className="h-3 w-10 bg-ink-100 rounded" />
        </div>
        <div className="h-3 w-44 bg-ink-100 rounded" />
      </div>
    </div>
  );
}

export function ConversationList() {
  const { rows: conversations, loading, error } = useRealtimeList<Conversation>(
    "conversations",
    api.conversations.list as () => Promise<Conversation[]>,
  );
  const [tab, setTab] = useState("all");
  const navigate = useNavigate();
  const { id: activeId } = useParams();

  const filtered = conversations.filter((c) => {
    if (tab === "all") return true;
    if (tab === "unread") return (c.unread_count || 0) > 0;
    if (tab === "instagram") return c.channel === "instagram";
    if (tab === "whatsapp") return c.channel === "whatsapp";
    if (tab === "email") return c.channel === "email";
    return true;
  });

  const unreadCount = conversations.reduce((acc, c) => acc + ((c.unread_count || 0) > 0 ? 1 : 0), 0);

  return (
    <div className="w-[340px] border-r border-line flex flex-col bg-ink flex-shrink-0">
      <div className="p-3 border-b border-line">
        <div className="flex items-center gap-2 bg-ink-200 border border-line rounded-lg px-2.5 py-1.5 text-paper-3 text-xs">
          <Icon name="search" size={13} />
          <input
            className="bg-transparent border-none outline-none text-paper placeholder:text-paper-3 flex-1 min-w-0"
            placeholder="Search conversations…"
          />
        </div>
      </div>

      <div className="px-3">
        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { id: "all", label: "All", count: conversations.length },
            { id: "unread", label: "Unread", count: unreadCount },
            { id: "instagram", label: "IG" },
            { id: "whatsapp", label: "WA" },
            { id: "email", label: "Email" },
          ]}
        />
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-neg bg-neg-dim border-b border-neg/30">
          Inbox load failed: {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && !error && (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        )}

        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            icon="chat"
            title={tab === "all" ? "No conversations yet" : `No ${tab} threads`}
            body={
              tab === "all"
                ? "Inbound WhatsApp and IG DM threads will appear here once the webhooks receive messages."
                : undefined
            }
          />
        )}

        {!loading && filtered.map((conv) => {
          const isActive = conv.id === activeId;
          const isUnread = (conv.unread_count || 0) > 0 && conv.last_message_from === "them";
          return (
            <button
              key={conv.id}
              onClick={() => navigate(ROUTES.conversation(conv.id))}
              className={`w-full px-3 py-2.5 flex items-start gap-2.5 text-left border-b border-line transition-colors ${
                isActive ? "bg-ink-100" : "hover:bg-ink-50"
              }`}
            >
              <ChannelBadge channel={conv.channel} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm truncate flex-1 ${isUnread ? "text-paper font-medium" : "text-paper-2"}`}>
                    {conv.entity_name ?? "Unknown"}
                  </span>
                  <span className="font-mono text-2xs text-paper-3 flex-shrink-0">
                    {conv.last_message_at ? fmtAgo(conv.last_message_at) : ""}
                  </span>
                </div>
                {conv.subject && (
                  <div className="text-xs text-paper-2 truncate mt-0.5">{conv.subject}</div>
                )}
                <div className={`text-xs truncate mt-0.5 flex items-center gap-1.5 ${isUnread ? "text-paper-2" : "text-paper-3"}`}>
                  {isUnread && <span className="w-1.5 h-1.5 bg-teal rounded-full flex-shrink-0" />}
                  <span className="truncate">
                    {conv.last_message_from === "us" && <span className="text-paper-3">You: </span>}
                    {conv.last_message_preview}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
