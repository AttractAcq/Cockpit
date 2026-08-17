// Master AI ("Jarvis") — the agent loop. One action-routed edge function:
//   send_message           — start or continue a run with a new user message
//   continue                — resume a run that hit its per-invocation time
//                              budget (client drives this exactly like
//                              driveCompetitorOSBuild/driveAssetJob elsewhere)
//   cancel                   — stop an in-progress run
//   resolve_pending_action    — a human approves/rejects a gated tool call
//
// Safety boundary: JARVIS_TOOL_GATES classifies every tool as free / toggle /
// floor. 'floor' tools (launch_ad_campaign, schedule/publish/retry
// distribution) ALWAYS create a pending action and stop the run —
// autonomous_mode has no path to skip this check; the gate list is a
// hardcoded import, never read from client_jarvis_settings. 'toggle' tools
// execute immediately only when the RUN's autonomous_mode snapshot (captured
// once, at run creation) is true.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { svc, cors, json, audit, SUPABASE_URL } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { callAnthropicWithTools, type AnthropicMessageParam, type AnthropicContentBlock } from "../_shared/anthropic.ts";
import { JARVIS_TOOLS, JARVIS_TOOL_GATES, type JarvisToolGate } from "../_shared/jarvis/tools.ts";
import { executeJarvisTool } from "../_shared/jarvis/dispatcher.ts";

const MODEL = "claude-sonnet-5";
const TURN_TIME_BUDGET_MS = 100_000;

const SYSTEM_PROMPT = `You are Jarvis, an operator agent embedded in the AA Cockpit application, acting for one specific client at a time. You have tools to read and act across that client's content pipeline: Content Supply/Ideation, Intelligence Agents, Content Briefs, Assets, and Ad Studio.

Rules:
- Call at most one tool per response, then wait for its result before deciding the next action. Never call more than one tool in a single turn.
- Some tool calls will not execute immediately — they create a pending action for a human to approve first (either because the action is internally review-gated and autonomous mode is off, or because it is a real-world action like launching a paid ad campaign or publishing/scheduling a real post, which always requires a human click regardless of any setting). When a tool call returns as pending, say so plainly and stop; do not assume it happened.
- Never invent business facts, results, metrics, or claims. If a tool requires information you don't have (e.g. an Ad Brief's landing_page or a CTA with no real source), use the literal string "needs_client_input" rather than making something up.
- Be concise. State what you did or are about to do, then act — don't narrate at length before calling a tool.
- When a task is genuinely finished, say so clearly instead of continuing to call tools.`;

interface RunRow {
  id: string;
  client_id: string;
  status: string;
  autonomous_mode: boolean;
  turn_count: number;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_use_id: string | null;
  tool_name: string | null;
  tool_input: Record<string, unknown> | null;
  tool_output: unknown;
  turn_order: number;
}

function toAnthropicMessages(rows: MessageRow[]): AnthropicMessageParam[] {
  const messages: AnthropicMessageParam[] = [];
  for (const row of rows) {
    if (row.role === "user") {
      messages.push({ role: "user", content: row.content ?? "" });
    } else if (row.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      if (row.content) blocks.push({ type: "text", text: row.content });
      if (row.tool_name && row.tool_use_id) {
        blocks.push({ type: "tool_use", id: row.tool_use_id, name: row.tool_name, input: row.tool_input ?? {} });
      }
      messages.push({ role: "assistant", content: blocks });
    } else {
      const isError = typeof row.tool_output === "object" && row.tool_output !== null && "error" in (row.tool_output as Record<string, unknown>);
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: row.tool_use_id ?? "",
          content: JSON.stringify(row.tool_output ?? {}),
          is_error: isError,
        }],
      });
    }
  }
  return messages;
}

async function nextTurnOrder(sb: ReturnType<typeof svc>, runId: string): Promise<number> {
  const { data } = await sb.from("client_agent_messages").select("turn_order").eq("run_id", runId).order("turn_order", { ascending: false }).limit(1).maybeSingle();
  return (data?.turn_order ?? 0) + 1;
}

async function insertMessage(
  sb: ReturnType<typeof svc>,
  clientId: string,
  runId: string,
  row: Partial<MessageRow> & { role: MessageRow["role"] },
): Promise<MessageRow> {
  const turnOrder = await nextTurnOrder(sb, runId);
  const { data, error } = await sb.from("client_agent_messages").insert({
    client_id: clientId, run_id: runId, turn_order: turnOrder,
    role: row.role, content: row.content ?? null, tool_use_id: row.tool_use_id ?? null,
    tool_name: row.tool_name ?? null, tool_input: row.tool_input ?? null, tool_output: row.tool_output ?? null,
  }).select("*").single();
  if (error) throw new Error(`Failed to persist message: ${error.message}`);
  return data as MessageRow;
}

function reasonForGate(gate: JarvisToolGate, toolName: string): string {
  if (gate === "floor") return `${toolName} is a real-world action (spend or external publish) and always requires human confirmation.`;
  return `${toolName} is an internal review gate and autonomous mode is off for this run — waiting for human approval.`;
}

/** The agent loop: repeatedly call Claude, execute or gate the resulting tool call, until natural stop, a gate, a hard failure, or the time budget runs out. */
async function runAgentLoop(
  sb: ReturnType<typeof svc>,
  userClient: ReturnType<typeof createClient>,
  clientId: string,
  actorId: string,
  runId: string,
): Promise<{ status: string; message?: string; error?: string; pendingActionId?: string }> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < TURN_TIME_BUDGET_MS) {
    const { data: run, error: runError } = await sb.from("client_agent_runs").select("*").eq("id", runId).single();
    if (runError || !run) return { status: "failed", error: "Run disappeared mid-loop." };
    const runRow = run as RunRow;
    if (runRow.status === "cancelled") return { status: "cancelled" };
    if (runRow.status !== "running") return { status: runRow.status };

    const { data: history, error: historyError } = await sb.from("client_agent_messages").select("*").eq("run_id", runId).order("turn_order", { ascending: true });
    if (historyError) return { status: "failed", error: historyError.message };

    const result = await callAnthropicWithTools({
      system: SYSTEM_PROMPT,
      messages: toAnthropicMessages((history ?? []) as MessageRow[]),
      tools: JARVIS_TOOLS,
      model: MODEL,
      timeoutMs: 60_000,
      toolChoice: { type: "auto", disable_parallel_tool_use: true },
    });

    if (!result.ok) {
      if (result.retryable) return { status: "running", error: result.error };
      await sb.from("client_agent_runs").update({ status: "failed", failure_message: result.error, completed_at: new Date().toISOString() }).eq("id", runId);
      return { status: "failed", error: result.error };
    }

    const textBlocks = result.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n").trim();
    const toolUse = result.content.find((b): b is { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } => b.type === "tool_use");

    await insertMessage(sb, clientId, runId, {
      role: "assistant", content: textBlocks || null,
      tool_use_id: toolUse?.id, tool_name: toolUse?.name, tool_input: toolUse?.input,
    });
    await sb.from("client_agent_runs").update({ turn_count: runRow.turn_count + 1 }).eq("id", runId);

    if (!toolUse) {
      await sb.from("client_agent_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", runId);
      return { status: "completed", message: textBlocks };
    }

    const gate: JarvisToolGate = JARVIS_TOOL_GATES[toolUse.name] ?? "toggle";
    const needsHuman = gate === "floor" || (gate === "toggle" && !runRow.autonomous_mode);

    if (needsHuman) {
      const { data: pending, error: pendingError } = await sb.from("client_agent_pending_actions").insert({
        client_id: clientId, run_id: runId, tool_use_id: toolUse.id, tool_name: toolUse.name,
        tool_input: toolUse.input, gate, reason: reasonForGate(gate, toolUse.name),
      }).select("id").single();
      if (pendingError) return { status: "failed", error: pendingError.message };
      await sb.from("client_agent_runs").update({ status: "waiting_human" }).eq("id", runId);
      return { status: "waiting_human", pendingActionId: pending.id };
    }

    const toolResult = await executeJarvisTool({ userClient, sb, clientId, actorId }, toolUse.name, toolUse.input);
    await insertMessage(sb, clientId, runId, {
      role: "tool", tool_use_id: toolUse.id, tool_name: toolUse.name, tool_input: toolUse.input, tool_output: toolResult.output,
    });
  }

  return { status: "running" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    action?: string; client_id?: string; run_id?: string; message?: string;
    pending_action_id?: string; decision?: string; note?: string;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const action = (body.action ?? "").trim();
  const clientId = (body.client_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!["send_message", "continue", "cancel", "resolve_pending_action"].includes(action)) {
    return json({ code: "INVALID_ACTION" }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  const userClient = createClient(SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  if (action === "cancel") {
    const runId = (body.run_id ?? "").trim();
    if (!runId) return json({ code: "RUN_ID_REQUIRED" }, 400);
    // A no-op cancel on an already-terminal run isn't an error worth surfacing.
    await sb.from("client_agent_runs").update({ status: "cancelled", completed_at: new Date().toISOString() }).eq("id", runId).eq("client_id", clientId).eq("status", "running");
    return json({ ok: true, run_id: runId, status: "cancelled" }, 200);
  }

  if (action === "resolve_pending_action") {
    const pendingActionId = (body.pending_action_id ?? "").trim();
    const decision = (body.decision ?? "").trim();
    if (!pendingActionId) return json({ code: "PENDING_ACTION_ID_REQUIRED" }, 400);
    if (!["approved", "rejected"].includes(decision)) return json({ code: "INVALID_DECISION" }, 400);

    const { data: pending, error: pendingError } = await sb.from("client_agent_pending_actions").select("*").eq("id", pendingActionId).eq("client_id", clientId).eq("status", "pending").maybeSingle();
    if (pendingError) return json({ code: "LOOKUP_FAILED", message: pendingError.message }, 500);
    if (!pending) return json({ code: "PENDING_ACTION_NOT_FOUND" }, 404);

    await sb.from("client_agent_pending_actions").update({
      status: decision, resolved_at: new Date().toISOString(), resolved_by: access.userId, resolution_note: body.note ?? null,
    }).eq("id", pendingActionId);

    let toolOutput: unknown;
    if (decision === "approved") {
      const result = await executeJarvisTool({ userClient, sb, clientId, actorId: access.userId }, pending.tool_name, pending.tool_input ?? {});
      toolOutput = result.output;
    } else {
      toolOutput = { error: `Rejected by operator${body.note ? `: ${body.note}` : "."}` };
    }
    await insertMessage(sb, clientId, pending.run_id, {
      role: "tool", tool_use_id: pending.tool_use_id, tool_name: pending.tool_name, tool_input: pending.tool_input, tool_output: toolOutput,
    });
    await sb.from("client_agent_runs").update({ status: "running" }).eq("id", pending.run_id).eq("status", "waiting_human");
    await audit(sb, `jarvis.pending_action.${decision}`, "client_agent_pending_actions", pendingActionId, { client_id: clientId, tool_name: pending.tool_name });

    return json({ ok: true, run_id: pending.run_id, resumed: true }, 200);
  }

  // send_message / continue share the same loop entry point.
  let runId = (body.run_id ?? "").trim() || null;

  if (action === "send_message") {
    const message = (body.message ?? "").trim();
    if (!message) return json({ code: "MESSAGE_REQUIRED" }, 400);

    if (runId) {
      const { data: existing } = await sb.from("client_agent_runs").select("id, status").eq("id", runId).eq("client_id", clientId).maybeSingle();
      if (!existing || existing.status !== "running") runId = null; // fall through to create a fresh run
    }
    if (!runId) {
      const { data: settings } = await sb.from("client_jarvis_settings").select("autonomous_mode").eq("client_id", clientId).maybeSingle();
      const { data: created, error: createError } = await sb.from("client_agent_runs").insert({
        client_id: clientId, title: message.slice(0, 120), status: "running",
        autonomous_mode: settings?.autonomous_mode === true, created_by: access.userId,
      }).select("id").single();
      if (createError) return json({ code: "RUN_CREATE_FAILED", message: createError.message }, 500);
      runId = created.id;
      await audit(sb, "jarvis.run.created", "client_agent_runs", runId, { client_id: clientId });
    }
    await insertMessage(sb, clientId, runId, { role: "user", content: message });
  } else {
    if (!runId) return json({ code: "RUN_ID_REQUIRED" }, 400);
    const { data: existing } = await sb.from("client_agent_runs").select("id, status").eq("id", runId).eq("client_id", clientId).maybeSingle();
    if (!existing) return json({ code: "RUN_NOT_FOUND" }, 404);
    if (existing.status !== "running") return json({ ok: true, run_id: runId, status: existing.status }, 200);
  }

  const outcome = await runAgentLoop(sb, userClient, clientId, access.userId, runId);
  await sb.from("activity_log").insert({
    client_id: clientId, actor_id: access.userId, event_type: "jarvis.turn",
    plain_english_message: `Jarvis run ${outcome.status}${outcome.message ? `: ${outcome.message.slice(0, 200)}` : "."}`,
    object_type: "client_agent_runs", object_id: runId, metadata: { status: outcome.status },
  });

  return json({ ok: true, run_id: runId, ...outcome }, 200);
});
