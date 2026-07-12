// Start a scoped Phase 3 run: builds the deterministic plan, gates approved
// authority for every month the plan touches, and persists one item per slot
// (create/replace → queued; skip/conflict → recorded, not queued). Returns fast;
// generation happens one slot at a time via generate-phase-3-slot.
// HELD — do not deploy until the H8 migration is applied.
import { svc, json, cors } from "../_shared/aa.ts";
import { isAiEnabled, hasAnthropicKey } from "../_shared/anthropic.ts";
import {
  SCOPED_FORMATS, classifySlots, loadAuthorityForMonth, planSingleSlot, planWindowSlots, resolveCadence,
  type DuplicatePolicy, type PlannedSlot, type ScopedFormat,
} from "../_shared/phase3-scope.ts";

const FUNCTION_NAME = "start-phase-3-scope";
const STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POLICIES = new Set<DuplicatePolicy>(["skip_existing", "fill_missing", "replace_unapproved"]);

function fail(status: number, stage: string, error: string, details?: unknown): Response {
  return json({ ok: false, function: FUNCTION_NAME, stage, error, details, message: `${FUNCTION_NAME} failed at ${stage}: ${error}` }, status);
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

    const body = await req.json() as {
      client_id?: string; generation_mode?: string; start_date?: string; end_date?: string;
      planned_date?: string; asset_format?: string; duplicate_policy?: string; format_filter?: string[]; idempotency_key?: string;
    };
    const clientId = body.client_id?.trim() ?? "";
    const mode = body.generation_mode === "single_item" ? "single_item" : "range";
    const start = (mode === "single_item" ? body.planned_date : body.start_date)?.trim() ?? "";
    const end = (mode === "single_item" ? body.planned_date : body.end_date)?.trim() ?? "";
    const policy = (POLICIES.has(body.duplicate_policy as DuplicatePolicy) ? body.duplicate_policy : "skip_existing") as DuplicatePolicy;
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end) return fail(400, "request", "a valid inclusive date window is required.");

    let formatFilter: ScopedFormat[] | undefined;
    if (mode === "single_item") {
      if (!SCOPED_FORMATS.includes(body.asset_format as ScopedFormat)) return fail(400, "request", "a valid asset_format is required for single_item.");
      formatFilter = [body.asset_format as ScopedFormat];
    } else if (Array.isArray(body.format_filter) && body.format_filter.length) {
      formatFilter = body.format_filter.filter((f) => SCOPED_FORMATS.includes(f as ScopedFormat)) as ScopedFormat[];
    }

    let slots: PlannedSlot[];
    if (mode === "single_item") {
      slots = [planSingleSlot(start, body.asset_format as ScopedFormat)]; // no cadence filter for single-item
    } else {
      const cadence = await resolveCadence(sb, clientId);
      slots = planWindowSlots(start, end, cadence, formatFilter);
    }
    const classified = await classifySlots(sb, clientId, slots, policy);
    const toGenerate = classified.filter((s) => s.action === "create" || s.action === "replace");
    if (mode === "single_item" && toGenerate.length !== 1) {
      return fail(409, "plan", toGenerate.length === 0 ? "Nothing to generate for this date/format under the chosen policy (already exists or protected)." : "Single-item planning produced more than one slot.");
    }

    // Authority gate: every month we will generate into must be Phase 1/2 approved.
    const months = [...new Set(toGenerate.map((s) => s.execution_month))];
    for (const month of months) {
      const authority = await loadAuthorityForMonth(sb, clientId, month);
      if (!authority.ok) return fail(409, "authority", `Phase 3 authority not ready for ${month}: ${authority.error}`, { month, ...authority.counts });
    }

    const { data: run, error: runErr } = await sb.from("client_phase3_scoped_runs").insert({
      client_id: clientId, generation_mode: mode, start_date: start, end_date: end, duplicate_policy: policy,
      format_filter: formatFilter ?? null, status: toGenerate.length ? "generating" : "complete",
      total_slots: toGenerate.length,
      skipped_count: classified.filter((s) => s.action === "skip").length,
      conflicted_count: classified.filter((s) => s.action === "conflict").length,
      plan: classified.map((s) => ({ slot_key: s.slot_key, planned_date: s.planned_date, asset_format: s.asset_format, action: s.action, existing_ref: s.existing_ref ?? null, conflict_reason: s.conflict_reason ?? null })),
      idempotency_key: body.idempotency_key ?? null, created_by: user.id,
    }).select("*").single();
    if (runErr || !run) {
      if (runErr?.code === "23505") return fail(409, "start", "A run with this idempotency key already exists.");
      return fail(500, "start", "Could not create the scoped run.", runErr?.message);
    }

    const items = classified.map((s) => ({
      run_id: run.id, execution_month: s.execution_month, slot_key: s.slot_key, planned_date: s.planned_date, end_date: s.end_date,
      asset_format: s.asset_format, type_code: s.type_code, action: s.action,
      status: (s.action === "create" || s.action === "replace") ? "queued" : s.action === "skip" ? "skipped" : "skipped",
      conflict_reason: s.conflict_reason ?? null,
    }));
    if (items.length) {
      const { error: itemsErr } = await sb.from("client_phase3_scope_items").insert(items);
      if (itemsErr) { await sb.from("client_phase3_scoped_runs").delete().eq("id", run.id); return fail(500, "start", "Could not create scope items.", itemsErr.message); }
    }

    return json({ ok: true, function: FUNCTION_NAME, run, queued: toGenerate.length, total_slots: classified.length });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
