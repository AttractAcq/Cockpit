// Master AI ("Jarvis") — set (upsert) a client's autonomy toggle.
//
// autonomous_mode governs internal review gates only (approving a Source,
// Brief, asset group, Ad Opportunity/Brief/Campaign draft). It has no effect
// on the hard floor (launching a paid ad campaign, publishing/scheduling a
// real post) -- that floor is hardcoded in the jarvis-turn tool dispatcher,
// not read from this table, so it can never be changed by writing here.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; autonomous_mode?: boolean };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (typeof body.autonomous_mode !== "boolean") {
    return json({ code: "AUTONOMOUS_MODE_REQUIRED", message: "autonomous_mode must be a boolean." }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: settings, error } = await sb
    .from("client_jarvis_settings")
    .upsert({
      client_id: clientId,
      autonomous_mode: body.autonomous_mode,
      updated_by: access.userId,
    }, { onConflict: "client_id" })
    .select("*")
    .single();
  if (error) return json({ code: "UPSERT_FAILED", message: error.message }, 500);

  await audit(sb, "jarvis_settings.set", "client_jarvis_settings", settings.id, {
    client_id: clientId, autonomous_mode: body.autonomous_mode,
  });

  return json({ ok: true, settings }, 200);
});
