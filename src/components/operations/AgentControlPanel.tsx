import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Panel } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { AgentEvent } from "@/types";

function renderDescription(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <b key={i} className="text-paper font-medium">
          {part.slice(2, -2)}
        </b>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function AgentControlPanel() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.operations.agentEvents().then(setEvents);
  }, []);

  return (
    <Panel
      title="Agent trail"
      meta={
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-teal rounded-full shadow-teal-glow animate-pulse-dot" />
          OpenClaw · live
        </span>
      }
    >
      <div className="px-3 py-2.5 border-b border-line flex items-center justify-between bg-ink-100">
        <div className="flex items-center gap-2 text-xs text-paper-2">
          <span className="font-mono uppercase tracking-cap text-[9.5px] text-paper-3">
            Mode
          </span>
          <span className="text-paper">Auto with HITL approval</span>
        </div>
        <div className="flex gap-1.5">
          <Button variant="secondary" size="sm">Configure</Button>
          <Button variant="subtle" size="sm">Pause agent</Button>
        </div>
      </div>

      <div className="px-3 py-3 flex flex-col gap-2.5">
        {events.map((evt) => (
          <button
            key={evt.id}
            onClick={() =>
              evt.entity_id
                ? navigate(ROUTES.entity(evt.entity_id))
                : evt.resource_kind === "campaign" && evt.resource_id
                  ? navigate(ROUTES.campaign(evt.resource_id))
                  : null
            }
            className="grid grid-cols-[60px_1fr_auto] gap-3 items-baseline text-left hover:bg-ink-50 -mx-3 px-3 py-1.5 transition-colors"
          >
            <span className="font-mono text-2xs text-paper-3">
              {fmtAgo(evt.created_at)}
            </span>
            <span className="text-xs text-paper-2 leading-snug">
              <span className="font-mono uppercase tracking-cap text-[9.5px] mr-1.5 text-teal">
                {evt.action}
              </span>
              {renderDescription(evt.description)}
            </span>
            <span className="font-mono text-2xs text-paper-3">{evt.agent_name}</span>
          </button>
        ))}
      </div>
    </Panel>
  );
}
