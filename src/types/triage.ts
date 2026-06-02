import type { UUID, ISODate } from "./common";

/**
 * TriageItem = anything that needs human attention.
 * The Cockpit's primary inbox surfaces these, prioritized by score.
 */

export type TriageKind =
  | "reply" // a message needing a response
  | "decision" // a system event needing approval (e.g. pause ad)
  | "approve" // human-in-the-loop on agent output (e.g. send MJR)
  | "task" // calendar / time-based action (e.g. onboarding call)
  | "anomaly"; // system-detected issue (e.g. CPA drift)

export type TriageStatus = "open" | "snoozed" | "done" | "dismissed";

export interface TriageItem {
  id: UUID;
  kind: TriageKind;
  status: TriageStatus;

  // Display
  who: string; // primary subject ("Mike Daniels", "Joinery Test 02")
  who_subtitle: string | null; // ("Roofworx CT · IG DM")
  body: string; // the human-readable summary
  body_meta: string | null; // muted continuation (suggestion, context)

  // Linked entity
  entity_id: UUID | null;
  entity_name: string | null;
  related_resource_kind: "conversation" | "campaign" | "report" | "calendar" | null;
  related_resource_id: UUID | null;

  // Actions — primary/secondary/tertiary; one is `primary: true`
  actions: TriageAction[];

  // Agent context
  agent_note: string | null; // e.g. "OpenClaw scored: hot · 0.84"
  agent_score: number | null;
  auto_flagged: boolean;

  // Priority
  priority: number; // 0-100, higher = sooner
  created_at: ISODate;
  due_at: ISODate | null;
}

export interface TriageAction {
  id: string; // 'reply', 'approve_pause', 'open_thread' etc
  label: string;
  primary: boolean;
  destructive: boolean;
}
