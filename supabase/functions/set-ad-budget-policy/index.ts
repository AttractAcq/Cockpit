// Programme Stage L — set (upsert) a client's ad safety policy: account
// ownership, payment method, spend limits, allowed geographies, restricted
// audience flags, regulated categories, and whether client approval is
// required before any campaign of theirs can launch.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

function stringArray(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((v) => typeof v === "string")) return null;
  return raw as string[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string;
    ad_account_id?: string;
    ad_account_owner_verified?: boolean;
    payment_method_verified?: boolean;
    spend_limit_daily?: number | null;
    spend_limit_total?: number | null;
    requires_client_approval?: boolean;
    allowed_geographies?: unknown;
    restricted_audience_flags?: unknown;
    regulated_categories?: unknown;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);

  const allowedGeographies = stringArray(body.allowed_geographies ?? []);
  if (allowedGeographies === null) return json({ code: "INVALID_ALLOWED_GEOGRAPHIES" }, 400);
  const restrictedAudienceFlags = stringArray(body.restricted_audience_flags ?? []);
  if (restrictedAudienceFlags === null) return json({ code: "INVALID_RESTRICTED_AUDIENCE_FLAGS" }, 400);
  const regulatedCategories = stringArray(body.regulated_categories ?? []);
  if (regulatedCategories === null) return json({ code: "INVALID_REGULATED_CATEGORIES" }, 400);

  if (body.spend_limit_daily !== undefined && body.spend_limit_daily !== null && (typeof body.spend_limit_daily !== "number" || body.spend_limit_daily < 0)) {
    return json({ code: "INVALID_SPEND_LIMIT_DAILY" }, 400);
  }
  if (body.spend_limit_total !== undefined && body.spend_limit_total !== null && (typeof body.spend_limit_total !== "number" || body.spend_limit_total < 0)) {
    return json({ code: "INVALID_SPEND_LIMIT_TOTAL" }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: policy, error } = await sb.from("ad_budget_policies").upsert({
    client_id: clientId,
    ad_account_id: body.ad_account_id?.trim() || null,
    ad_account_owner_verified: body.ad_account_owner_verified === true,
    payment_method_verified: body.payment_method_verified === true,
    spend_limit_daily: body.spend_limit_daily ?? null,
    spend_limit_total: body.spend_limit_total ?? null,
    requires_client_approval: body.requires_client_approval !== false,
    allowed_geographies: allowedGeographies,
    restricted_audience_flags: restrictedAudienceFlags,
    regulated_categories: regulatedCategories,
    updated_by: access.userId,
  }, { onConflict: "client_id" }).select("*").single();
  if (error) return json({ code: "UPSERT_FAILED", message: error.message }, 500);

  await audit(sb, "ad_budget_policy.set", "ad_budget_policies", policy.id, { client_id: clientId });

  return json({ ok: true, policy }, 200);
});
