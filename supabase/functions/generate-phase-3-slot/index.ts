// Process EXACTLY ONE queued slot of a scoped Phase 3 run: one bounded AI call →
// one master row + one calendar cell (needs_review, no brief, no asset). Re-checks
// the slot's duplicate state at execution time (never trusts the preview snapshot).
// The UI drives it once per slot; the run is persisted + resumable.
// HELD — do not deploy until the H8 migration is applied.
import { svc, json, cors } from "../_shared/aa.ts";
import { isAiEnabled, hasAnthropicKey } from "../_shared/anthropic.ts";
import {
  classifySlots, generateOnePhase3Item, loadAuthorityForMonth,
  type ClassifiedSlot, type DuplicatePolicy, type PlannedSlot, type ScopedFormat, type TypeCode,
} from "../_shared/phase3-scope.ts";

const FUNCTION_NAME = "generate-phase-3-slot";
const STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);

function fail(status: number, stage: string, error: string, details?: unknown): Response {
  return json({ ok: false, function: FUNCTION_NAME, stage, error, details, message: `${FUNCTION_NAME} failed at ${stage}: ${error}` }, status);
}

async function progress(sb: ReturnType<typeof svc>, runId: string) {
  const { data } = await sb.from("client_phase3_scope_items").select("status").eq("run_id", runId);
  const rows = (data ?? []) as { status: string }[];
  const queued = rows.filter((r) => r.status === "queued" || r.status === "processing").length;
  const complete = rows.filter((r) => r.status === "complete").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  return { queued, complete, failed, total: rows.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "request", "POST only");
  const sb = svc();
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !user) return fail(401, "authorization", "Not authenticated.");
    const { data: operator } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (!operator || !STAFF_ROLES.has(operator.role)) return fail(403, "authorization", "Staff access required.");
    if (!isAiEnabled() || !hasAnthropicKey()) return fail(503, "configuration", "Server-side AI generation is not configured.");

    const body = await req.json() as { run_id?: string };
    const runId = body.run_id?.trim() ?? "";
    if (!runId) return fail(400, "request", "run_id is required.");
    const { data: run, error: runErr } = await sb.from("client_phase3_scoped_runs").select("*").eq("id", runId).maybeSingle();
    if (runErr || !run) return fail(404, "load_run", "Scoped run not found.", runErr?.message);
    const clientId = run.client_id as string;
    const policy = run.duplicate_policy as DuplicatePolicy;

    const { data: claimed, error: claimErr } = await sb.rpc("claim_next_phase3_scope_item", { p_run_id: runId });
    if (claimErr) return fail(500, "claim", "Could not claim a slot.", claimErr.message);
    const item = (Array.isArray(claimed) ? claimed[0] : claimed) as Record<string, unknown> | undefined;

    if (!item) {
      const prog = await progress(sb, runId);
      const status = prog.failed > 0 ? "partial" : "complete";
      const { data: finalRun } = await sb.from("client_phase3_scoped_runs").update({ status, updated_at: new Date().toISOString() }).eq("id", runId).select("*").maybeSingle();
      return json({ ok: true, function: FUNCTION_NAME, terminal: true, item_processed: false, run: finalRun ?? run, progress: prog });
    }

    const slot: PlannedSlot = {
      slot_key: item.slot_key as string, planned_date: item.planned_date as string, end_date: (item.end_date as string) ?? null,
      execution_month: item.execution_month as string, asset_format: item.asset_format as ScopedFormat, type_code: item.type_code as TypeCode,
      lane: item.slot_key && String(item.slot_key).includes(":ad_static:") ? adLaneName(String(item.slot_key)) : undefined,
    };

    // Execution-time re-check — never trust the preview snapshot.
    const [fresh] = await classifySlots(sb, clientId, [slot], policy);
    if (fresh.action !== "create" && fresh.action !== "replace") {
      await sb.from("client_phase3_scope_items").update({ status: "skipped", action: fresh.action, conflict_reason: fresh.conflict_reason ?? "already satisfied at execution", updated_at: new Date().toISOString() }).eq("id", item.id as string);
      await sb.from("client_phase3_scoped_runs").update({ [fresh.action === "conflict" ? "conflicted_count" : "skipped_count"]: (Number(run[fresh.action === "conflict" ? "conflicted_count" : "skipped_count"]) || 0) + 1, updated_at: new Date().toISOString() }).eq("id", runId);
      const prog = await progress(sb, runId);
      return json({ ok: true, function: FUNCTION_NAME, terminal: false, item_processed: false, skipped: true, action: fresh.action, progress: prog });
    }

    const authority = await loadAuthorityForMonth(sb, clientId, slot.execution_month);
    if (!authority.ok) {
      await sb.from("client_phase3_scope_items").update({ status: "failed", last_error: authority.error, updated_at: new Date().toISOString() }).eq("id", item.id as string);
      await sb.from("client_phase3_scoped_runs").update({ status: "partial", last_error: authority.error, updated_at: new Date().toISOString() }).eq("id", runId);
      return fail(409, "authority", `Authority not ready for ${slot.execution_month}: ${authority.error}`);
    }

    try {
      const classified: ClassifiedSlot = { ...slot, action: fresh.action, existing_ref: fresh.existing_ref };
      const result = await generateOnePhase3Item(sb, clientId, classified, authority.context, authority.execution);
      await sb.from("client_phase3_scope_items").update({ status: "complete", planned_ref: result.ref, created_master_table: result.master_table, created_master_id: result.master_id, calendar_cell_id: result.calendar_cell_id, updated_at: new Date().toISOString() }).eq("id", item.id as string);
      await sb.from("client_phase3_scoped_runs").update({ created_count: (Number(run.created_count) || 0) + 1, created_refs: [...((run.created_refs as string[]) ?? []), result.ref], updated_at: new Date().toISOString() }).eq("id", runId);
      const prog = await progress(sb, runId);
      if (prog.queued === 0) await sb.from("client_phase3_scoped_runs").update({ status: prog.failed > 0 ? "partial" : "complete", updated_at: new Date().toISOString() }).eq("id", runId);
      return json({ ok: true, function: FUNCTION_NAME, terminal: prog.queued === 0, item_processed: true, ref: result.ref, planned_date: slot.planned_date, progress: prog });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isConflict = message.startsWith("CONFLICT");
      await sb.from("client_phase3_scope_items").update({ status: isConflict ? "skipped" : "failed", action: isConflict ? "conflict" : (item.action as string), conflict_reason: isConflict ? message : null, last_error: isConflict ? null : message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", item.id as string);
      if (isConflict) await sb.from("client_phase3_scoped_runs").update({ conflicted_count: (Number(run.conflicted_count) || 0) + 1, updated_at: new Date().toISOString() }).eq("id", runId);
      else await sb.from("client_phase3_scoped_runs").update({ status: "partial", last_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("id", runId);
      const prog = await progress(sb, runId);
      const status = message.includes("timed out") ? 504 : 500;
      return json({ ok: !isConflict ? false : true, function: FUNCTION_NAME, terminal: false, item_processed: false, error: isConflict ? undefined : message, conflict: isConflict, progress: prog }, isConflict ? 200 : status);
    }
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});

function adLaneName(slotKey: string): string {
  const key = slotKey.split(":").at(-1) ?? "";
  return key === "lane-2" ? "Ad 2" : key === "lane-3" ? "Ad 3" : "Ad 1";
}
