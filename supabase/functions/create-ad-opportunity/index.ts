// Programme Stage L — create an Ad Opportunity from any of the 8 origins
// Stage L names. An "organic_winner" origin must reference the real,
// client-owned Content Opportunity it was promoted from — this is what
// satisfies "Organic winners can be promoted without recreating the source
// manually" without ever fabricating provenance.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

const ORIGINS = ["manual_idea", "proof", "research", "campaign_requirement", "organic_winner", "performance_insight", "offer_launch", "seasonal_trigger"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string; title?: string; origin?: string;
    promoted_from_content_opportunity_id?: string;
    core_claim?: string; offer_ref?: string; notes?: string; generated_by?: string;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const title = (body.title ?? "").trim();
  const origin = (body.origin ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!title || title.length > 400) return json({ code: "INVALID_TITLE" }, 400);
  if (!ORIGINS.includes(origin as typeof ORIGINS[number])) {
    return json({ code: "INVALID_ORIGIN", message: `origin must be one of: ${ORIGINS.join(", ")}` }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  let promotedFrom: string | null = null;
  if (origin === "organic_winner") {
    const sourceId = (body.promoted_from_content_opportunity_id ?? "").trim();
    if (!sourceId) return json({ code: "PROMOTED_FROM_REQUIRED", message: "organic_winner origin requires promoted_from_content_opportunity_id." }, 400);
    const source = await sb.from("content_opportunities").select("id, client_id").eq("id", sourceId).maybeSingle();
    if (source.error) return json({ code: "LOOKUP_FAILED", message: source.error.message }, 500);
    if (!source.data || source.data.client_id !== clientId) return json({ code: "CROSS_CLIENT_SOURCE" }, 403);
    promotedFrom = sourceId;
  }

  const generatedBy = (body.generated_by ?? "manual").trim();
  if (generatedBy !== "manual" && generatedBy !== "ai") return json({ code: "INVALID_GENERATED_BY" }, 400);

  const inserted = await sb.from("ad_opportunities").insert({
    client_id: clientId, title, origin,
    promoted_from_content_opportunity_id: promotedFrom,
    core_claim: body.core_claim ?? null, offer_ref: body.offer_ref ?? null,
    notes: body.notes ?? null, generated_by: generatedBy, created_by: access.userId,
  }).select("*").single();
  if (inserted.error) return json({ code: "INSERT_FAILED", message: inserted.error.message }, 500);

  await audit(sb, "ad_opportunity.created", "ad_opportunities", inserted.data.id, { client_id: clientId, origin });

  return json({ ok: true, opportunity: inserted.data }, 201);
});
