// Programme Stage L — create a draft Campaign (Campaign + one Ad Set + one
// Ad per selected creative variant), entirely in Cockpit's own database.
// This function NEVER calls Meta — every object it creates starts in
// 'draft' with no external id. Idempotent per (client_id, idempotency_key)
// so retried or duplicate requests can never create two campaigns for the
// same intent ("Duplicate campaign creation is blocked").

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string; ad_brief_id?: string; name?: string; objective?: string;
    budget_daily?: number; budget_total?: number;
    attribution?: Record<string, unknown>;
    selected_variant_ids?: string[];
    ad_set?: { name?: string; audience?: Record<string, unknown>; placement?: string[]; budget_daily?: number };
    idempotency_key?: string;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const briefId = (body.ad_brief_id ?? "").trim();
  const name = (body.name ?? "").trim();
  const objective = (body.objective ?? "").trim();
  const variantIds = Array.isArray(body.selected_variant_ids) ? body.selected_variant_ids.filter((v) => typeof v === "string" && v.trim()) : [];
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!briefId) return json({ code: "AD_BRIEF_ID_REQUIRED" }, 400);
  if (!name) return json({ code: "NAME_REQUIRED" }, 400);
  if (!objective) return json({ code: "OBJECTIVE_REQUIRED" }, 400);
  if (variantIds.length === 0) return json({ code: "AT_LEAST_ONE_VARIANT_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const brief = await sb.from("ad_briefs").select("id, client_id, status").eq("id", briefId).maybeSingle();
  if (brief.error) return json({ code: "LOOKUP_FAILED", message: brief.error.message }, 500);
  if (!brief.data || brief.data.client_id !== clientId) return json({ code: "CROSS_CLIENT_BRIEF" }, 403);
  if (brief.data.status !== "approved") return json({ code: "BRIEF_NOT_APPROVED", message: `Brief status is "${brief.data.status}", not "approved".` }, 409);

  const idempotencyKey = (body.idempotency_key ?? "").trim() || `campaign:${briefId}:${name}`.slice(0, 160);

  const existing = await sb.from("ad_campaigns").select("*").eq("client_id", clientId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing.error) return json({ code: "LOOKUP_FAILED", message: existing.error.message }, 500);
  if (existing.data) return json({ ok: true, idempotent_replay: true, campaign: existing.data }, 200);

  const variants = await sb.from("ad_creative_variants").select("id, client_id, ad_brief_id, status").in("id", variantIds);
  if (variants.error) return json({ code: "LOOKUP_FAILED", message: variants.error.message }, 500);
  if ((variants.data ?? []).length !== variantIds.length) return json({ code: "VARIANT_NOT_FOUND" }, 404);
  for (const v of variants.data ?? []) {
    if (v.client_id !== clientId || v.ad_brief_id !== briefId) return json({ code: "VARIANT_CROSS_CLIENT_OR_BRIEF" }, 403);
  }

  const campaignInsert = await sb.from("ad_campaigns").insert({
    client_id: clientId, ad_brief_id: briefId, idempotency_key: idempotencyKey,
    name, objective, status: "draft",
    budget_daily: body.budget_daily ?? null, budget_total: body.budget_total ?? null,
    attribution: body.attribution ?? {}, created_by: access.userId,
  }).select("*").single();
  if (campaignInsert.error) return json({ code: "INSERT_FAILED", message: campaignInsert.error.message }, 500);
  const campaign = campaignInsert.data;

  const adSetInput = body.ad_set ?? {};
  const adSetInsert = await sb.from("ad_sets").insert({
    client_id: clientId, ad_campaign_id: campaign.id,
    name: (adSetInput.name ?? `${name} — Ad Set 1`).toString().slice(0, 200),
    audience: adSetInput.audience ?? {}, placement: adSetInput.placement ?? [],
    budget_daily: adSetInput.budget_daily ?? body.budget_daily ?? null,
    status: "draft",
  }).select("*").single();
  if (adSetInsert.error) {
    await sb.from("ad_campaigns").delete().eq("id", campaign.id);
    return json({ code: "INSERT_FAILED", message: adSetInsert.error.message }, 500);
  }
  const adSet = adSetInsert.data;

  const adsToInsert = variantIds.map((variantId, i) => ({
    client_id: clientId, ad_set_id: adSet.id, ad_creative_variant_id: variantId,
    name: `${name} — Ad ${i + 1}`, status: "draft",
  }));
  const adsInsert = await sb.from("ads").insert(adsToInsert).select("*");
  if (adsInsert.error) {
    await sb.from("ad_campaigns").delete().eq("id", campaign.id); // cascades ad_sets/ads
    return json({ code: "INSERT_FAILED", message: adsInsert.error.message }, 500);
  }

  await audit(sb, "ad_campaign.created", "ad_campaigns", campaign.id, {
    client_id: clientId, ad_brief_id: briefId, ad_count: adsInsert.data?.length ?? 0,
  });

  return json({ ok: true, idempotent_replay: false, campaign, ad_set: adSet, ads: adsInsert.data }, 201);
});
