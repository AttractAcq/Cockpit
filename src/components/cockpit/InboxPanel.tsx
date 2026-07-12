import { useNavigate } from "react-router-dom";
import { EmptyState, Panel, ChannelBadge } from "@/components/primitives";
import { api } from "@/lib/api";
import { useRealtimeList } from "@/hooks/useRealtime";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { Conversation } from "@/types";

export function InboxPanel() {
  const navigate = useNavigate();
  const { rows: live, loading, error } = useRealtimeList<Conversation>("conversations", api.conversations.list);

  const items = loading ? [] : live.slice(0, 5);
  const unread = items.reduce((acc, c) => acc + (c.unread_count || 0), 0);

  return (
    <Panel title="Inbox" meta={`${unread} unread · ${items.length} total`}>
      {error && (
        <div className="px-3 py-3 text-xs text-neg bg-neg-dim border-b border-neg/30">
          Inbox read failed: {error}
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <EmptyState icon="chat" title="No conversations" body="Live inbound threads will appear here." />
      )}
      {items.map((conv, i) => {
        const isUnread = (conv.unread_count || 0) > 0 && conv.last_message_from === "them";
        return (
          <button
            key={conv.id}
            onClick={() => navigate(ROUTES.conversation(conv.id))}
            className={`w-full px-3 py-2 flex items-center gap-2.5 hover:bg-ink-50 cursor-pointer text-left transition-colors ${
              i < items.length - 1 ? "border-b border-line" : ""
            }`}
          >
            <ChannelBadge channel={conv.channel} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`text-sm truncate ${isUnread ? "text-paper font-medium" : "text-paper-2"}`}>
                  {conv.entity_name}
                </span>
                {isUnread && <span className="w-1.5 h-1.5 bg-teal rounded-full flex-shrink-0" />}
              </div>
              <div className="text-xs text-paper-3 mt-0.5 truncate">
                {conv.last_message_from === "us" && <span className="text-paper-3">You: </span>}
                {conv.last_message_preview}
              </div>
            </div>
            <span className="font-mono text-2xs text-paper-3 flex-shrink-0">
              {conv.last_message_at ? fmtAgo(conv.last_message_at) : ""}
            </span>
          </button>
        );
      })}
    </Panel>
  );
}
