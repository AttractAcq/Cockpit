// Master AI ("Jarvis") — frontend types.

export interface JarvisSettingsRow {
  id: string;
  client_id: string;
  autonomous_mode: boolean;
  updated_at: string;
}

export type JarvisRunStatus = "running" | "waiting_human" | "completed" | "failed" | "cancelled";

export interface JarvisRunRow {
  id: string;
  client_id: string;
  title: string;
  status: JarvisRunStatus;
  autonomous_mode: boolean;
  turn_count: number;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export type JarvisMessageRole = "user" | "assistant" | "tool";

export interface JarvisMessageRow {
  id: string;
  run_id: string;
  turn_order: number;
  role: JarvisMessageRole;
  content: string | null;
  tool_use_id: string | null;
  tool_name: string | null;
  tool_input: Record<string, unknown> | null;
  tool_output: unknown;
  created_at: string;
}

export type JarvisPendingActionGate = "floor" | "toggle";
export type JarvisPendingActionStatus = "pending" | "approved" | "rejected" | "expired";

export interface JarvisPendingActionRow {
  id: string;
  client_id: string;
  run_id: string;
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  gate: JarvisPendingActionGate;
  reason: string;
  status: JarvisPendingActionStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

export interface JarvisTurnOutcome {
  ok: boolean;
  run_id: string;
  status: JarvisRunStatus | "cancelled";
  message?: string;
  error?: string;
  pendingActionId?: string;
  resumed?: boolean;
}
