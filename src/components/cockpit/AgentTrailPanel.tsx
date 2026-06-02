import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Panel } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { AgentEvent } from "@/types";

/**
 * Renders a description string where text wrapped in **double-asterisks**
 * is rendered as bold paper-colored, the rest as paper-2.
 */
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

export function AgentTrailPanel() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.operations.agentEvents(6).then(setEvents);
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
      <div className="px-3 py-2 flex flex-col gap-2">
        {events.map((evt) => {
          const isRecent =
            new Date(evt.created_at).getTime() > Date.now() - 1000 * 60 * 30; // 30m
          return (
            <button
              key={evt.id}
              onClick={() =>
                evt.resource_kind === "campaign" && evt.resource_id
                  ? navigate(ROUTES.campaign(evt.resource_id))
                  : evt.entity_id
                    ? navigate(ROUTES.entity(evt.entity_id))
                    : navigate(ROUTES.operations)
              }
              className="grid grid-cols-[44px_1fr_auto] gap-2 items-baseline text-left hover:bg-ink-50 -mx-3 px-3 py-1 transition-colors"
            >
              <span className="font-mono text-2xs text-paper-3">
                {fmtAgo(evt.created_at)}
              </span>
              <span className="text-xs text-paper-2 leading-snug">
                <span
                  className={`font-mono uppercase tracking-cap text-[9.5px] mr-1.5 ${
                    isRecent ? "text-teal" : "text-paper-3"
                  }`}
                >
                  {evt.action}
                </span>
                {renderDescription(evt.description)}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
