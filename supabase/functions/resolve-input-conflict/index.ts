// Programme Stage C runtime: operator review of a detected input conflict.
//
// Writes only to client_input_conflicts.status and its resolution fields. A
// conflict decision NEVER edits client inputs, context files, masters, calendar
// or approval state — resolving means "a human has judged this", not "the data
// has been changed".

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

const TERMINAL = new Set(["resolved", "dismissed"]);
const ALLOWED = new Set(["acknowledged", "resolved", "dismissed"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { conflict_id?: string; status?: string; resolution_note?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const conflictId = (body.conflict_id ?? "").trim();
  const status = (body.status ?? "").trim();
  const note = (body.resolution_note ?? "").trim();

  if (!conflictId) return json({ code: "CONFLICT_ID_REQUIRED" }, 400);
  if (!ALLOWED.has(status)) {
    return json({ code: "INVALID_STATUS", allowed: [...ALLOWED] }, 400);
  }
  // Mirrors client_input_conflicts_resolved_check: a terminal decision needs a
  // written reason, so "resolved" is never an unexplained click.
  if (TERMINAL.has(status) && note.length === 0) {
    return json({
      code: "RESOLUTION_NOTE_REQUIRED",
      message: `Marking a conflict ${status} requires a written reason.`,
    }, 400);
  }

  const sb = svc();
  const { data: conflict, error: lookupErr } = await sb
    .from("client_input_conflicts")
    .select("id, client_id, status, conflict_type, severity")
    .eq("id", conflictId)
    .maybeSingle();
  if (lookupErr) return json({ code: "LOOKUP_FAILED", message: lookupErr.message }, 500);
  if (!conflict) return json({ code: "CONFLICT_NOT_FOUND" }, 404);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), conflict.client_id as string);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  if (TERMINAL.has(conflict.status as string)) {
    return json({
      code: "ALREADY_DECIDED",
      message: `This conflict is already ${conflict.status}.`,
      status: conflict.status,
    }, 409);
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = { status };
  if (TERMINAL.has(status)) {
    patch.resolution_note = note;
    patch.resolved_by = access.userId;
    patch.resolved_at = nowIso;
  }

  const { error: updErr } = await sb
    .from("client_input_conflicts").update(patch).eq("id", conflictId);
  if (updErr) return json({ code: "UPDATE_FAILED", message: updErr.message }, 500);

  await audit(sb, "input_conflict.reviewed", "client_input_conflicts", conflictId, {
    client_id: conflict.client_id,
    from_status: conflict.status,
    to_status: status,
    conflict_type: conflict.conflict_type,
    severity: conflict.severity,
  });

  return json({ conflict_id: conflictId, status, decided_at: TERMINAL.has(status) ? nowIso : null }, 200);
});
