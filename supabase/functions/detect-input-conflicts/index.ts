// Programme Stage C runtime: deterministic conflict detection.
//
// Review queue only. Writes exclusively to client_input_conflicts and never
// mutates client inputs, context files, masters or approval state.
// Rules live in _shared/supply/conflicts.ts and are unit tested.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { detectConflicts } from "../_shared/supply/conflicts.ts";

const DETECTOR = "auto:v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }
  const clientId = (body.client_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const [inputsRes, proofRes, openRes] = await Promise.all([
    sb.from("client_inputs").select("*").eq("client_id", clientId).maybeSingle(),
    sb.from("proof_items").select("id").eq("client_id", clientId).eq("verification_status", "verified").limit(1),
    sb.from("client_input_conflicts").select("conflict_type, left_source_ref, status").eq("client_id", clientId).in("status", ["open", "acknowledged"]),
  ]);
  if (inputsRes.error) return json({ code: "LOOKUP_FAILED", message: inputsRes.error.message }, 500);
  if (!inputsRes.data) return json({ code: "NO_CLIENT_INPUTS", message: "This client has no inputs to scan." }, 404);

  const SKIP = new Set(["id", "client_id", "created_at", "updated_at", "uploaded_file_refs", "social_links"]);
  const fields: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(inputsRes.data as Record<string, unknown>)) {
    if (SKIP.has(k)) continue;
    if (typeof v === "string") fields[k] = v;
  }

  const hasVerifiedProof = (proofRes.data ?? []).length > 0;
  const findings = detectConflicts(fields, hasVerifiedProof);

  // Re-running must not duplicate an existing unresolved conflict, and must not
  // erase an operator's acknowledgement.
  const existing = new Set(((openRes.data ?? []) as Array<{ conflict_type: string; left_source_ref: string }>)
    .map((r) => `${r.conflict_type}::${r.left_source_ref}`));

  const toInsert = findings
    .filter((f) => !existing.has(`${f.conflict_type}::${f.left_source_ref}`))
    .map((f) => ({ client_id: clientId, ...f, detected_by: DETECTOR }));

  let inserted = 0;
  if (toInsert.length > 0) {
    const { error } = await sb.from("client_input_conflicts").insert(toInsert);
    if (error) return json({ code: "INSERT_FAILED", message: error.message }, 500);
    inserted = toInsert.length;
  }

  await audit(sb, "input_conflicts.detected", "client_input_conflicts", null, {
    client_id: clientId, found: findings.length, inserted,
  });

  return json({
    scanned_fields: Object.keys(fields).length,
    found: findings.length,
    inserted,
    already_open: findings.length - inserted,
    has_verified_proof: hasVerifiedProof,
  }, 200);
});
