import { useState } from "react";
import { Button, Icon } from "@/components/primitives";

type SendState = "idle" | "sending" | "sent" | "error";

interface ComposerProps {
  onSend?: (text: string) => void | Promise<void>;
  placeholder?: string;
  /** Disables Send and shows BLOCKED tooltip — use when the send channel isn't approved yet */
  blocked?: boolean;
  blockedReason?: string;
  sendState?: SendState;
}

const SEND_LABEL: Record<SendState, string> = {
  idle: "Send",
  sending: "Sending…",
  sent: "Sent ✓",
  error: "Error — retry",
};

export function Composer({
  onSend,
  placeholder = "Type a reply…",
  blocked = false,
  blockedReason = "BLOCKED — external · activates once 360dialog is approved for this account.",
  sendState = "idle",
}: ComposerProps) {
  const [text, setText] = useState("");

  const handleSend = async () => {
    if (!text.trim() || blocked || sendState === "sending") return;
    await onSend?.(text);
    setText("");
  };

  const isBusy = sendState === "sending";
  const sendDisabled = blocked || isBusy || !text.trim();

  const sendButton = (
    <Button
      variant="primary"
      size="sm"
      onClick={handleSend}
      disabled={sendDisabled}
      className={sendDisabled ? "opacity-50 cursor-not-allowed" : ""}
    >
      {blocked ? (
        <>
          <span className="font-mono text-warn text-[9px] mr-1 leading-none">⊘</span>
          Send
        </>
      ) : (
        <>
          {SEND_LABEL[sendState]}
          {sendState === "idle" && <Icon name="send" size={11} className="ml-1 inline" />}
        </>
      )}
    </Button>
  );

  return (
    <div className="border-t border-line px-3 py-3 flex flex-col gap-2">
      {sendState === "error" && (
        <div className="text-xs text-neg bg-neg-dim border border-neg/30 rounded px-2 py-1">
          Message failed to send. Check connection and try again.
        </div>
      )}
      <div className="flex items-start gap-2">
        <button className="w-[30px] h-[30px] grid place-items-center rounded-md text-paper-3 hover:text-paper hover:bg-ink-200 transition-colors flex-shrink-0">
          <Icon name="paperclip" size={14} />
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder={placeholder}
          rows={2}
          disabled={isBusy}
          className="flex-1 bg-ink-200 border border-line rounded-lg px-3 py-2 text-sm text-paper placeholder:text-paper-3 resize-none focus:outline-none focus:border-line-2 disabled:opacity-60"
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          <Button variant="subtle" size="sm">Use template</Button>
          <Button variant="subtle" size="sm">Ask agent to draft</Button>
        </div>
        {blocked ? (
          <span title={blockedReason} className="inline-block">
            {sendButton}
          </span>
        ) : (
          sendButton
        )}
      </div>
    </div>
  );
}
