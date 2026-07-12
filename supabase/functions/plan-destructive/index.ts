// Dry-run planner for destructive lifecycle operations. Read-only: computes the
// plan and persists a `planned` operation row for auditability. Never mutates
// lifecycle data. HELD — do not deploy until the H9 migration is applied.
import { svc, json, cors } from "../_shared/aa.ts";
import { buildPlan, type DestructiveTarget, type OperationType } from "../_shared/destructive.ts";

const FUNCTION_NAME = "plan-destructive";
const STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);
const OPS = new Set<OperationType>(["delete_asset", "delete_phase3_content", "reject_asset", "reject_content_brief"]);

function fail(status: number, stage: string, error: string): Response {
  return json({ ok: false, function: FUNCTION_NAME, stage, error, message: `${FUNCTION_NAME} failed at ${stage}: ${error}` }, status);
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

    const body = await req.json() as DestructiveTarget & { reason?: string };
    if (!OPS.has(body.operation_type)) return fail(400, "request", "Unknown operation_type.");
    const target: DestructiveTarget = {
      operation_type: body.operation_type, asset_id: body.asset_id, master_table: body.master_table,
      ref: body.ref, asset_group_ref: body.asset_group_ref, brief_id: body.brief_id,
    };
    const plan = await buildPlan(sb, target);
    if (!plan.client_id) return json({ ok: true, function: FUNCTION_NAME, operation_id: null, plan });

    const targetId = target.asset_id ?? target.brief_id ?? null;
    const { data: op, error: opErr } = await sb.from("client_destructive_operations").insert({
      client_id: plan.client_id, operation_type: body.operation_type,
      target_type: target.master_table ?? (target.asset_group_ref ? "asset_group" : body.operation_type),
      target_id: targetId, target_ref: plan.target_ref, reason: body.reason ?? null,
      dry_run: true, status: "planned", requested_by: user.id,
      plan: { ...plan, target },
    }).select("id").single();
    if (opErr || !op) return fail(500, "persist", opErr?.message ?? "Could not record the operation.");

    return json({ ok: true, function: FUNCTION_NAME, operation_id: op.id, plan });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
