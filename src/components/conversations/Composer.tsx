import { useState } from "react";
import { Button, Icon } from "@/components/primitives";

interface ComposerProps {
  onSend?: (text: string) => void;
  placeholder?: string;
}

export function Composer({ onSend, placeholder = "Type a reply…" }: ComposerProps) {
  const [text, setText] = useState("");

  const handleSend = () => {
    if (!text.trim()) return;
    onSend?.(text);
    setText("");
  };

  return (
    <div className="border-t border-line px-3 py-3 flex flex-col gap-2">
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
              handleSend();
            }
          }}
          placeholder={placeholder}
          rows={2}
          className="flex-1 bg-ink-200 border border-line rounded-lg px-3 py-2 text-sm text-paper placeholder:text-paper-3 resize-none focus:outline-none focus:border-line-2"
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          <Button variant="subtle" size="sm">
            Use template
          </Button>
          <Button variant="subtle" size="sm">
            Ask agent to draft
          </Button>
        </div>
        <Button variant="primary" size="sm" onClick={handleSend}>
          Send <Icon name="send" size={11} className="ml-1 inline" />
        </Button>
      </div>
    </div>
  );
}
