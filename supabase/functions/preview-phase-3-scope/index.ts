// Deterministic, read-only preview of a scoped Phase 3 request. NO AI, NO writes.
// Returns the exact planned slots + duplicate classification so the UI never
// guesses. HELD — do not deploy until the H8 migration is applied.
import { svc, json, cors } from "../_shared/aa.ts";
import {
  SCOPED_FORMATS, classifySlots, planSingleSlot, planWindowSlots, resolveCadence,
  type DuplicatePolicy, type PlannedSlot, type ScopedFormat,
} from "../_shared/phase3-scope.ts";

const FUNCTION_NAME = "preview-phase-3-scope";
const STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POLICIES = new Set<DuplicatePolicy>(["skip_existing", "fill_missing", "replace_unapproved"]);

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

    const body = await req.json() as {
      client_id?: string; generation_mode?: string; start_date?: string; end_date?: string;
      planned_date?: string; asset_format?: string; duplicate_policy?: string; format_filter?: string[];
    };
    const clientId = body.client_id?.trim() ?? "";
    const mode = body.generation_mode === "single_item" ? "single_item" : "range";
    const start = (mode === "single_item" ? body.planned_date : body.start_date)?.trim() ?? "";
    const end = (mode === "single_item" ? body.planned_date : body.end_date)?.trim() ?? "";
    const policy = (POLICIES.has(body.duplicate_policy as DuplicatePolicy) ? body.duplicate_policy : "skip_existing") as DuplicatePolicy;
    if (!clientId) return fail(400, "request", "client_id is required.");
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) return fail(400, "request", "valid dates are required.");
    if (start > end) return fail(400, "request", "start_date must be on or before end_date.");

    let formatFilter: ScopedFormat[] | undefined;
    if (mode === "single_item") {
      if (!SCOPED_FORMATS.includes(body.asset_format as ScopedFormat)) return fail(400, "request", "a valid asset_format is required for single_item.");
      formatFilter = [body.asset_format as ScopedFormat];
    } else if (Array.isArray(body.format_filter) && body.format_filter.length) {
      formatFilter = body.format_filter.filter((f) => SCOPED_FORMATS.includes(f as ScopedFormat)) as ScopedFormat[];
    }

    // single_item bypasses cadence entirely — exactly one slot for the chosen
    // date+format, any weekday. range mode uses the cadence-filtered planner.
    let slots: PlannedSlot[];
    if (mode === "single_item") {
      slots = [planSingleSlot(start, body.asset_format as ScopedFormat)];
    } else {
      const cadence = await resolveCadence(sb, clientId);
      slots = planWindowSlots(start, end, cadence, formatFilter);
    }

    const classified = await classifySlots(sb, clientId, slots, policy);
    const summary = {
      create: classified.filter((s) => s.action === "create").length,
      skip: classified.filter((s) => s.action === "skip").length,
      replace: classified.filter((s) => s.action === "replace").length,
      conflict: classified.filter((s) => s.action === "conflict").length,
    };
    const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
    return json({
      ok: true, function: FUNCTION_NAME, generation_mode: mode, start_date: start, end_date: end, days,
      duplicate_policy: policy, total_slots: classified.length, summary,
      slots: classified.map((s) => ({ slot_key: s.slot_key, planned_date: s.planned_date, end_date: s.end_date, execution_month: s.execution_month, asset_format: s.asset_format, action: s.action, existing_ref: s.existing_ref ?? null, conflict_reason: s.conflict_reason ?? null })),
      protected_conflicts: classified.filter((s) => s.action === "conflict").map((s) => ({ planned_date: s.planned_date, asset_format: s.asset_format, existing_ref: s.existing_ref, reason: s.conflict_reason })),
    });
  } catch (error) {
    return fail(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
