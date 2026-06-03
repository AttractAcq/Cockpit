import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChannelBadge, Tabs, Icon } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { Conversation } from "@/types";

const DEMO: Conversation[] = [
  { id: "d-c1", entity_id: null, entity_name: "Mike · Roofworx CT", channel: "instagram", subject: null, unread_count: 1, last_message_at: new Date(Date.now() - 1000 * 60 * 20).toISOString(), last_message_preview: "Yeah send me the report…", last_message_from: "them", is_pinned: true, created_at: "" },
  { id: "d-c2", entity_id: null, entity_name: "Vasco · Vasco Joinery", channel: "whatsapp", subject: null, unread_count: 1, last_message_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(), last_message_preview: "Sharp, I'll have a look tonight 🙏", last_message_from: "them", is_pinned: false, created_at: "" },
  { id: "d-c3", entity_id: null, entity_name: "Lindiwe · Pool Pros SA", channel: "instagram", subject: null, unread_count: 1, last_message_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(), last_message_preview: "Hi, saw your reel — do you work with pool repair…", last_message_from: "them", is_pinned: false, created_at: "" },
  { id: "d-c4", entity_id: null, entity_name: "Cape Coast Joinery", channel: "whatsapp", subject: null, unread_count: 0, last_message_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(), last_message_preview: "Looking forward to today!", last_message_from: "them", is_pinned: false, created_at: "" },
];

export function ConversationList() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [tab, setTab] = useState("all");
  const navigate = useNavigate();
  const { id: activeId } = useParams();

  useEffect(() => {
    mockApi.conversations.list()
      .then((rows) => {
        if (rows.length === 0) { setConversations(DEMO); setIsDemo(true); }
        else { setConversations(rows as Conversation[]); setIsDemo(false); }
      })
      .catch(() => { setConversations(DEMO); setIsDemo(true); });
  }, []);

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

      {isDemo && (
        <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-cap text-paper-3 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-warn" /> demo
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {filtered.map((conv) => {
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
                    {conv.entity_name}
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
