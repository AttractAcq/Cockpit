import type { Message } from "@/types";
import { fmtTime } from "@/lib/format";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === "outbound";
  const isAgentSent = message.sent_by === "agent";

  return (
    <div
      className={`flex flex-col gap-1 max-w-[80%] ${isOutbound ? "items-end self-end" : "items-start self-start"}`}
    >
      <div
        className={`text-2xs text-paper-3 font-mono flex items-center gap-1.5 ${isOutbound ? "flex-row-reverse" : ""}`}
      >
        <span>{message.sender_name}</span>
        {isAgentSent && (
          <span className="text-teal uppercase tracking-cap text-[9px]">via agent</span>
        )}
        <span>·</span>
        <span>{fmtTime(message.sent_at)}</span>
      </div>
      <div
        className={`rounded-[10px] px-3 py-2 text-sm leading-relaxed ${
          isOutbound
            ? "bg-teal-dim text-paper border border-[rgba(0,229,195,0.25)]"
            : "bg-ink-200 text-paper border border-line"
        }`}
      >
        {message.body}
      </div>
    </div>
  );
}
