// Executes a planned destructive operation via the staged workflow:
//   validate+plan → pending → delete storage → transactional DB RPC → complete.
// Re-derives the plan at runtime (never trusts the stale dry-run) and reports full
// storage/DB recovery detail. HELD — do not deploy until the H9 migration is applied.
import { svc, json, cors } from "../_shared/aa.ts";
import { BUCKET, buildPlan, type DestructiveTarget } from "../_shared/destructive.ts";

const FUNCTION_NAME = "execute-destructive";
const STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);

function fail(status: number, stage: string, error: string): Response {
  return json({ ok: false, function: FUNCTION_NAME, stage, error, message: `${FUNCTION_NAME} failed at ${stage}: ${error}` }, status);
}

async function callApply(sb: ReturnType<typeof svc>, opId: string, target: DestructiveTarget, clientId: string): Promise<Record<string, unknown>> {
  if (target.operation_type === "delete_asset") {
    const { data, error } = await sb.rpc("apply_delete_asset", { p_operation_id: opId, p_asset_id: target.asset_id });
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }
  if (target.operation_type === "delete_phase3_content") {
    const { data, error } = await sb.rpc("apply_delete_phase3_content", { p_operation_id: opId, p_client_id: clientId, p_master_table: target.master_table, p_ref: target.ref });
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }
  if (target.operation_type === "reject_asset") {
    const { data: a } = await sb.from("client_assets").select("production_brief_id, source_ref").eq("asset_group_ref", target.asset_group_ref ?? "").limit(1).maybeSingle();
    const { data, error } = await sb.rpc("apply_reject_asset", { p_operation_id: opId, p_client_id: clientId, p_asset_group_ref: target.asset_group_ref, p_brief_id: a?.production_brief_id ?? null, p_source_ref: a?.source_ref ?? "" });
    if (error) throw new Error(error.message);
    return data as Record<string, unknown>;
  }
  const { data, error } = await sb.rpc("apply_reject_content_brief", { p_operation_id: opId, p_client_id: clientId, p_brief_id: target.brief_id });
  if (error) throw new Error(error.message);
  return data as Record<string, unknown>;
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

    const body = await req.json() as { operation_id?: string; reason?: string };
    const opId = body.operation_id?.trim() ?? "";
    if (!opId) return fail(400, "request", "operation_id is required.");
    const { data: op, error: opErr } = await sb.from("client_destructive_operations").select("*").eq("id", opId).maybeSingle();
    if (opErr || !op) return fail(404, "load", "Operation not found.");
    if (op.status === "complete") return json({ ok: true, function: FUNCTION_NAME, status: "complete", result: op.result, message: "Already completed (idempotent)." });

    const target = (op.plan?.target ?? {}) as DestructiveTarget;
    const clientId = op.client_id as string;

    // Re-derive the plan at runtime — never trust the stored dry-run.
    const plan = await buildPlan(sb, target);
    if (!plan.allowed) {
      await sb.from("client_destructive_operations").update({ status: "blocked", result: { blockers: plan.blockers, published_findings: plan.published_findings }, last_error: plan.blockers.join(" "), updated_at: new Date().toISOString() }).eq("id", opId);
      return json({ ok: false, function: FUNCTION_NAME, status: "blocked", blockers: plan.blockers, published_findings: plan.published_findings }, 409);
    }

    await sb.from("client_destructive_operations").update({ status: "pending", dry_run: false, reason: body.reason ?? op.reason, updated_at: new Date().toISOString() }).eq("id", opId);

    // Stage 3: storage first. If storage fails, DB rows are NOT touched.
    const storagePlanned = [...new Set(plan.storage_objects.filter(Boolean))];
    let storageDeleted: string[] = [];
    const storageFailed: string[] = [];
    if (storagePlanned.length) {
      const { data: removed, error: rmErr } = await sb.storage.from(BUCKET).remove(storagePlanned);
      if (rmErr) {
        await sb.from("client_destructive_operations").update({ status: "failed", last_error: `Storage deletion failed: ${rmErr.message}`, result: { storage_objects_planned: storagePlanned, storage_objects_deleted: [], storage_objects_failed: storagePlanned, database_rows_deleted: 0, database_rows_updated: 0, recovery_required: false }, updated_at: new Date().toISOString() }).eq("id", opId);
        return json({ ok: false, function: FUNCTION_NAME, status: "failed", stage: "storage", error: rmErr.message, recovery_required: false }, 502);
      }
      storageDeleted = (removed ?? []).map((o) => o.name);
    }

    // Stage 4: transactional DB delete/rollback.
    let dbResult: Record<string, unknown>;
    try {
      dbResult = await callApply(sb, opId, target, clientId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const recovery = storageDeleted.length > 0; // storage already gone, DB not applied
      await sb.from("client_destructive_operations").update({
        status: message.startsWith("BLOCKED") ? "blocked" : "failed", last_error: message,
        result: { storage_objects_planned: storagePlanned, storage_objects_deleted: storageDeleted, storage_objects_failed: storageFailed, database_rows_deleted: 0, database_rows_updated: 0, recovery_required: recovery },
        updated_at: new Date().toISOString(),
      }).eq("id", opId);
      return json({ ok: false, function: FUNCTION_NAME, status: message.startsWith("BLOCKED") ? "blocked" : "failed", stage: "database", error: message, recovery_required: recovery }, message.startsWith("BLOCKED") ? 409 : 500);
    }

    const completedAt = new Date().toISOString();
    const result = { storage_objects_planned: storagePlanned, storage_objects_deleted: storageDeleted, storage_objects_failed: storageFailed, db_result: dbResult, recovery_required: false };
    await sb.from("client_destructive_operations").update({ status: "complete", result, completed_at: completedAt, updated_at: completedAt }).eq("id", opId);
    await sb.from("activity_log").insert({
      client_id: clientId, event_type: `destructive_${target.operation_type}`,
      plain_english_message: `${target.operation_type.replaceAll("_", " ")} completed for ${plan.target_ref ?? "target"}.`,
      metadata: { operation_id: opId, target_ref: plan.target_ref, ...dbResult },
    }).select("id").maybeSingle();

    return json({ ok: true, function: FUNCTION_NAME, status: "complete", result });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
