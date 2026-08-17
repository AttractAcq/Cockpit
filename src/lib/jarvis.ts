// Master AI ("Jarvis") — data access. Reads go direct to Supabase under
// RLS; every write/agent-turn goes through jarvis-turn or set-jarvis-settings.

import { supabase, invokeFn } from "./supabase";
import type {
  JarvisSettingsRow, JarvisRunRow, JarvisMessageRow, JarvisPendingActionRow, JarvisTurnOutcome,
} from "@/types/jarvis";

export async function fetchJarvisSettings(clientId: string): Promise<JarvisSettingsRow | null> {
  const { data, error } = await supabase.from("client_jarvis_settings").select("*").eq("client_id", clientId).maybeSingle();
  if (error) throw error;
  return (data as JarvisSettingsRow | null) ?? null;
}

export async function setJarvisAutonomousMode(clientId: string, autonomousMode: boolean): Promise<JarvisSettingsRow> {
  const result = await invokeFn<{ ok: true; settings: JarvisSettingsRow }>("set-jarvis-settings", {
    client_id: clientId, autonomous_mode: autonomousMode,
  });
  return result.settings;
}

export async function fetchJarvisRuns(clientId: string, limit = 30): Promise<JarvisRunRow[]> {
  const { data, error } = await supabase.from("client_agent_runs").select("*")
    .eq("client_id", clientId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as JarvisRunRow[];
}

export async function fetchJarvisRun(runId: string): Promise<JarvisRunRow | null> {
  const { data, error } = await supabase.from("client_agent_runs").select("*").eq("id", runId).maybeSingle();
  if (error) throw error;
  return (data as JarvisRunRow | null) ?? null;
}

export async function fetchJarvisMessages(runId: string): Promise<JarvisMessageRow[]> {
  const { data, error } = await supabase.from("client_agent_messages").select("*")
    .eq("run_id", runId).order("turn_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as JarvisMessageRow[];
}

export async function fetchJarvisPendingActions(clientId: string): Promise<JarvisPendingActionRow[]> {
  const { data, error } = await supabase.from("client_agent_pending_actions").select("*")
    .eq("client_id", clientId).eq("status", "pending").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as JarvisPendingActionRow[];
}

export async function sendJarvisMessage(input: { clientId: string; runId?: string | null; message: string }): Promise<JarvisTurnOutcome> {
  return invokeFn<JarvisTurnOutcome>("jarvis-turn", {
    action: "send_message", client_id: input.clientId, run_id: input.runId ?? undefined, message: input.message,
  });
}

export async function continueJarvisRun(clientId: string, runId: string): Promise<JarvisTurnOutcome> {
  return invokeFn<JarvisTurnOutcome>("jarvis-turn", { action: "continue", client_id: clientId, run_id: runId });
}

export async function cancelJarvisRun(clientId: string, runId: string): Promise<JarvisTurnOutcome> {
  return invokeFn<JarvisTurnOutcome>("jarvis-turn", { action: "cancel", client_id: clientId, run_id: runId });
}

export async function resolveJarvisPendingAction(input: {
  clientId: string; pendingActionId: string; decision: "approved" | "rejected"; note?: string;
}): Promise<JarvisTurnOutcome> {
  return invokeFn<JarvisTurnOutcome>("jarvis-turn", {
    action: "resolve_pending_action", client_id: input.clientId,
    pending_action_id: input.pendingActionId, decision: input.decision, note: input.note,
  });
}

/**
 * Drives a run to a stopping point (completed/waiting_human/failed/cancelled),
 * calling `continue` repeatedly while the server reports `status: "running"`
 * (it hit its own per-invocation time budget) — same shape as
 * driveCompetitorOSBuild/driveAssetJob elsewhere in this app.
 */
export async function driveJarvisRun(
  clientId: string,
  runId: string,
  onProgress?: (outcome: JarvisTurnOutcome) => void,
  shouldContinue?: () => boolean,
): Promise<JarvisTurnOutcome> {
  let last: JarvisTurnOutcome = { ok: true, run_id: runId, status: "running" };
  for (let guard = 0; guard < 40; guard += 1) {
    if (shouldContinue && !shouldContinue()) return last;
    last = await continueJarvisRun(clientId, runId);
    onProgress?.(last);
    if (last.status !== "running") return last;
  }
  return last;
}
