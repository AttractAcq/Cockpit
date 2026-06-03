import type { UUID, ISODate } from "./common";

/**
 * AgentEvent = anything OpenClaw / AICOS did (or was instructed to do).
 * Powers the Agent Trail panel and the Operations page audit log.
 */

export type AgentAction =
  | "drafted"
  | "sent"
  | "flagged"
  | "scored"
  | "synced"
  | "scraped"
  | "paused"
  | "approved"
  | "generated"
  | "replied"
  | "escalated";

export interface AgentEvent {
  id: UUID;
  action: AgentAction;
  description: string; // human-readable, e.g. "MJR for Vasco Joinery — 14 competitors"
  agent_name: string; // which agent (OpenClaw, Apify, n8n, MetaSync, Claude Content, …)
  status: "success" | "needs_review" | "failed";

  entity_id: UUID | null;
  entity_name: string | null;

  // Reference back to the thing that was acted on
  resource_kind: "conversation" | "campaign" | "report" | "entity" | "system" | null;
  resource_id: UUID | null;

  // Time
  created_at: ISODate;

  // For dev/ops drilldown
  agent_run_id: UUID | null;
}

/**
 * Automation = a long-running operation that's currently In Flight.
 * Shown in the Cockpit's "In Flight" panel and the Operations page.
 */
export type AutomationStatus = "live" | "idle" | "warn" | "error" | "paused";

export interface Automation {
  id: UUID;
  name: string;
  kind: "outreach_sequence" | "ad_campaign" | "agent" | "scraper" | "scheduler";
  status: AutomationStatus;
  status_pill: string | null; // e.g. "WA + IG", "flagged", "live"

  // Display lines
  detail: string; // e.g. "Joinery Wave 03 · step 2 of 4"
  primary_stat_label: string; // e.g. "sent"
  primary_stat_value: string; // e.g. "12"
  secondary_stats: string; // e.g. "3 replied · 1 booked"

  // For drilldown
  resource_kind: "campaign" | "sequence" | "agent" | "scraper" | null;
  resource_id: UUID | null;

  started_at: ISODate;
  last_action_at: ISODate;
}
