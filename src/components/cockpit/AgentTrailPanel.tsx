import { useNavigate } from "react-router-dom";
import { Panel } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { useRealtimeList } from "@/hooks/useRealtime";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { AgentEvent } from "@/types";

const DEMO: AgentEvent[] = [
  { id: "d-ae1", action: "drafted", description: "MJR for **Vasco Joinery** — 14 competitors, R84k gap", agent_name: "OpenClaw", status: "needs_review", entity_id: null, entity_name: "Vasco Joinery", resource_kind: "report", resource_id: null, created_at: new Date(Date.now() - 1000 * 60 * 14).toISOString(), agent_run_id: null },
  { id: "d-ae2", action: "flagged", description: "Joinery Test 02 — CPA +40% past 48h, needs decision", agent_name: "OpenClaw", status: "needs_review", entity_id: null, entity_name: null, resource_kind: "campaign", resource_id: null, created_at: new Date(Date.now() - 1000 * 60 * 36).toISOString(), agent_run_id: null },
  { id: "d-ae3", action: "scored", description: "3 new replies · Mike (0.84), Lindiwe (0.71)", agent_name: "OpenClaw", status: "success", entity_id: null, entity_name: null, resource_kind: "conversation", resource_id: null, created_at: new Date(Date.now() - 1000 * 60 * 80).toISOString(), agent_run_id: null },
  { id: "d-ae4", action: "scraped", description: "23 new Google Maps leads · Sea Point joinery cluster", agent_name: "Apify", status: "success", entity_id: null, entity_name: null, resource_kind: "system", resource_id: null, created_at: new Date(Date.now() - 1000 * 60 * 60 * 21).toISOString(), agent_run_id: null },
];

function renderDescription(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <b key={i} className="text-paper font-medium">{part.slice(2, -2)}</b>;
    }
    return <span key={i}>{part}</span>;
  });
}

export function AgentTrailPanel() {
  const navigate = useNavigate();
  const { rows: live, loading } = useRealtimeList<AgentEvent>("agent_events", () => mockApi.operations.agentEvents(6));

  const events = loading ? [] : (live.length > 0 ? live : DEMO).slice(0, 6);

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
          const isRecent = new Date(evt.created_at).getTime() > Date.now() - 1000 * 60 * 30;
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
              <span className="font-mono text-2xs text-paper-3">{fmtAgo(evt.created_at)}</span>
              <span className="text-xs text-paper-2 leading-snug">
                <span className={`font-mono uppercase tracking-cap text-[9.5px] mr-1.5 ${isRecent ? "text-teal" : "text-paper-3"}`}>
                  {evt.action}
                </span>
                {renderDescription(evt.description || "")}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
