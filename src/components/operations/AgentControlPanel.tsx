import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Panel } from "@/components/primitives";
import { mockApi } from "@/lib/mock";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { AgentEvent } from "@/types";

const AGENTS = [
  { id: "apify", name: "Apify", description: "Google Maps scraper · nightly SAST 03:00", status: "idle" as const },
  { id: "openclaw", name: "OpenClaw", description: "Scoring, MJR drafting, CPA flagging", status: "live" as const },
  { id: "n8n", name: "n8n", description: "Workflow automation · outreach sequences", status: "live" as const },
  { id: "metasync", name: "MetaSync", description: "Meta Ads sync · creative + spend pull", status: "live" as const },
  { id: "claude_content", name: "Claude Content", description: "Brief generation · ad copy · captions", status: "idle" as const },
];

const DEMO_EVENTS: AgentEvent[] = [
  { id: "d-e1", action: "drafted", description: "MJR for **Vasco Joinery** — 14 competitors, R84k gap", agent_name: "OpenClaw", status: "needs_review", entity_id: null, entity_name: "Vasco Joinery", resource_kind: "report", resource_id: null, created_at: new Date(Date.now() - 1000 * 60 * 14).toISOString(), agent_run_id: null },
  { id: "d-e2", action: "flagged", description: "Joinery Test 02 — CPA +40% over 48h", agent_name: "OpenClaw", status: "needs_review", entity_id: null, entity_name: null, resource_kind: "campaign", resource_id: null, created_at: new Date(Date.now() - 1000 * 60 * 36).toISOString(), agent_run_id: null },
  { id: "d-e3", action: "scored", description: "3 new replies · Mike (0.84), Lindiwe (0.71), Themba (0.43)", agent_name: "OpenClaw", status: "success", entity_id: null, entity_name: null, resource_kind: "conversation", resource_id: null, created_at: new Date(Date.now() - 1000 * 60 * 80).toISOString(), agent_run_id: null },
  { id: "d-e4", action: "sent", description: "Step 2 · Joinery Wave 03 to 12 prospects via WhatsApp", agent_name: "n8n", status: "success", entity_id: null, entity_name: null, resource_kind: "system", resource_id: null, created_at: new Date(Date.now() - 1000 * 60 * 110).toISOString(), agent_run_id: null },
  { id: "d-e5", action: "scraped", description: "23 new Google Maps leads · Sea Point joinery cluster", agent_name: "Apify", status: "success", entity_id: null, entity_name: null, resource_kind: "system", resource_id: null, created_at: new Date(Date.now() - 1000 * 60 * 60 * 21).toISOString(), agent_run_id: null },
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

export function AgentControlPanel() {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [scraping, setScraping] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    mockApi.operations.agentEvents()
      .then((rows) => {
        if (rows.length === 0) { setEvents(DEMO_EVENTS); setIsDemo(true); }
        else { setEvents(rows as AgentEvent[]); setIsDemo(false); }
      })
      .catch(() => { setEvents(DEMO_EVENTS); setIsDemo(true); });
  }, []);

  async function handleRunScrape() {
    setScraping(true);
    try {
      await mockApi.operations.runScrape();
      alert("Scrape job triggered — new entities will appear in Pipeline as they arrive.");
    } catch (e) {
      alert("Scrape failed: " + String(e));
    } finally {
      setScraping(false);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/* Agent status grid */}
      <Panel title="Agents" meta="5 configured">
        <div className="px-3 py-2 grid grid-cols-1 gap-0">
          {AGENTS.map((agent, i) => (
            <div
              key={agent.id}
              className={`py-2.5 flex items-center gap-3 ${i < AGENTS.length - 1 ? "border-b border-line" : ""}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                agent.status === "live" ? "bg-teal shadow-teal-glow animate-pulse-dot" : "bg-ink-50 border border-line"
              }`} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-paper font-medium">{agent.name}</div>
                <div className="text-xs text-paper-3 font-mono">{agent.description}</div>
              </div>
              <span className={`font-mono text-[9px] uppercase tracking-cap px-1.5 py-px rounded-[3px] ${
                agent.status === "live" ? "text-teal border border-[rgba(0,229,195,0.3)]" : "text-paper-3 border border-line"
              }`}>
                {agent.status}
              </span>
              {agent.id === "apify" && (
                <Button variant="secondary" size="sm" onClick={handleRunScrape} disabled={scraping}>
                  {scraping ? "Running…" : "Run now"}
                </Button>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {/* Agent trail */}
      <Panel
        title="Agent trail"
        meta={
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-teal rounded-full shadow-teal-glow animate-pulse-dot" />
            live{isDemo ? " · demo" : ""}
          </span>
        }
      >
        <div className="px-3 py-2.5 border-b border-line flex items-center justify-between bg-ink-100">
          <div className="flex items-center gap-2 text-xs text-paper-2">
            <span className="font-mono uppercase tracking-cap text-[9.5px] text-paper-3">Mode</span>
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
                    : undefined
              }
              className="grid grid-cols-[60px_1fr_auto] gap-3 items-baseline text-left hover:bg-ink-50 -mx-3 px-3 py-1.5 transition-colors"
            >
              <span className="font-mono text-2xs text-paper-3">{fmtAgo(evt.created_at)}</span>
              <span className="text-xs text-paper-2 leading-snug">
                <span className="font-mono uppercase tracking-cap text-[9.5px] mr-1.5 text-teal">{evt.action}</span>
                {renderDescription(evt.description || "")}
              </span>
              <span className="font-mono text-2xs text-paper-3">{evt.agent_name}</span>
            </button>
          ))}
        </div>
      </Panel>
    </div>
  );
}
