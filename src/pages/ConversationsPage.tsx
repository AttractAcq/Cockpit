import { ConversationList, ConversationThread } from "@/components/conversations";

export function ConversationsPage() {
  return (
    <div className="flex-1 min-h-0 overflow-hidden flex">
      <ConversationList />
      <ConversationThread />
    </div>
  );
}
