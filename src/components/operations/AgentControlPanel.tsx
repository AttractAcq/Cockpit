import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, EmptyState, Panel } from "@/components/primitives";
import { api } from "@/lib/api";
import { useRealtimeList } from "@/hooks/useRealtime";
import { ROUTES } from "@/lib/constants";
import { fmtAgo } from "@/lib/format";
import type { AgentEvent } from "@/types";

const AGENTS = [
  { id: "apify",         eventName: "Apify",         name: "Apify",         description: "Google Maps scraper · nightly SAST 03:00" },
  { id: "openclaw",      eventName: "OpenClaw",       name: "OpenClaw",      description: "Scoring, MJR drafting, CPA flagging" },
  { id: "n8n",           eventName: "n8n",            name: "n8n",           description: "Workflow automation · outreach sequences" },
  { id: "metasync",      eventName: "MetaSync",       name: "MetaSync",      description: "Meta Ads sync · creative + spend pull" },
  { id: "claude_content",eventName: "Claude Content", name: "Claude Content",description: "Brief generation · ad copy · captions" },
];

const CUTOFF_24H = () => Date.now() - 24 * 60 * 60 * 1000;

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
  const { rows: events, loading: eventsLoading, error: eventsError } = useRealtimeList<AgentEvent>(
    "agent_events",
    () => api.agentEvents.list(100) as Promise<AgentEvent[]>,
  );

  const [scrapeConfirm, setScrapeConfirm] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState<{ kind: "done" | "error"; text: string } | null>(null);
  const navigate = useNavigate();

  // Derive live status from events in the last 24h
  function agentIsLive(eventName: string): boolean {
    return events.some(
      (e) => e.agent_name === eventName && new Date(e.created_at).getTime() > CUTOFF_24H(),
    );
  }

  async function handleRunScrape() {
    setScraping(true);
    setScrapeMsg(null);
    try {
      await api.operations.runScrape();
      setScrapeMsg({ kind: "done", text: "Scrape triggered — new entities will appear in Pipeline as they arrive." });
      setScrapeConfirm(false);
    } catch (e) {
      setScrapeMsg({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setScraping(false);
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      {/* Agent status grid */}
      <Panel title="Agents" meta={`${AGENTS.length} configured`}>
        <div className="px-3 py-2 grid grid-cols-1 gap-0">
          {AGENTS.map((agent, i) => {
            const live = agentIsLive(agent.eventName);
            return (
              <div
                key={agent.id}
                className={`py-2.5 flex items-center gap-3 ${i < AGENTS.length - 1 ? "border-b border-line" : ""}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  live ? "bg-teal shadow-teal-glow animate-pulse-dot" : "bg-ink-50 border border-line"
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-paper font-medium">{agent.name}</div>
                  <div className="text-xs text-paper-3 font-mono">{agent.description}</div>
                </div>
                <span className={`font-mono text-[9px] uppercase tracking-cap px-1.5 py-px rounded-[3px] ${
                  live ? "text-teal border border-[rgba(0,229,195,0.3)]" : "text-paper-3 border border-line"
                }`}>
                  {live ? "live" : "idle"}
                </span>

                {agent.id === "apify" && !scrapeConfirm && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => { setScrapeConfirm(true); setScrapeMsg(null); }}
                    disabled={scraping}
                  >
                    Run now
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Inline scrape confirmation panel */}
        {scrapeConfirm && (
          <div className="mx-3 mb-3 bg-warn-dim border border-warn/30 rounded-lg px-3 py-3 flex flex-col gap-2.5">
            <div className="text-xs text-warn font-medium">
              This launches a real Apify scrape and may incur cost. Continue?
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleRunScrape}
                disabled={scraping}
                className={scraping ? "opacity-50 cursor-not-allowed" : ""}
              >
                {scraping ? "Launching…" : "Yes, run scrape"}
              </Button>
              <Button
                variant="subtle"
                size="sm"
                onClick={() => { setScrapeConfirm(false); setScrapeMsg(null); }}
                disabled={scraping}
              >
                Cancel
              </Button>
            </div>
            {scrapeMsg && (
              <div className={`text-xs font-mono ${scrapeMsg.kind === "done" ? "text-teal" : "text-neg"}`}>
                {scrapeMsg.kind === "done" ? "✓" : "✗"} {scrapeMsg.text}
              </div>
            )}
          </div>
        )}

        {scrapeMsg && !scrapeConfirm && (
          <div className={`mx-3 mb-3 px-3 py-2 rounded-lg text-xs font-mono ${
            scrapeMsg.kind === "done"
              ? "bg-teal-dim border border-[rgba(0,229,195,0.25)] text-teal"
              : "bg-neg-dim border border-neg/30 text-neg"
          }`}>
            {scrapeMsg.kind === "done" ? "✓" : "✗"} {scrapeMsg.text}
          </div>
        )}
      </Panel>

      {/* Agent trail */}
      <Panel
        title="Agent trail"
        meta={
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-teal rounded-full shadow-teal-glow animate-pulse-dot" />
            live
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

        {eventsError && (
          <div className="px-3 py-2 text-xs text-neg bg-neg-dim border-b border-neg/30">
            Trail load failed: {eventsError}
          </div>
        )}

        {!eventsLoading && !eventsError && events.length === 0 && (
          <div className="px-3 py-6">
            <EmptyState
              icon="ops"
              title="No agent activity yet"
              body="Events from OpenClaw, Apify, n8n, and other agents will appear here."
            />
          </div>
        )}

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
