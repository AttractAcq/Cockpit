// Programme Stage I — the studio router. Routes an approved Content Brief
// to its format-specific studio and creates the canonical Production Job.
// Writes only production_jobs — no asset generation happens here, and
// nothing here touches the legacy client_production_briefs pipeline.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import {
  routeToStudio,
  validateAssetPlan,
  buildProductionJobIdempotencyKey,
} from "../_shared/production-studio.ts";

interface StructuredBriefLike {
  format: string;
  organic_or_paid: "organic" | "paid";
  production_mode: "ai" | "human" | "hybrid";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; content_brief_id?: string; asset_plan?: unknown };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const briefId = (body.content_brief_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!briefId) return json({ code: "CONTENT_BRIEF_ID_REQUIRED" }, 400);

  let assetPlan: ReturnType<typeof validateAssetPlan> = [];
  if (body.asset_plan !== undefined) {
    assetPlan = validateAssetPlan(body.asset_plan);
    if (assetPlan === null) return json({ code: "INVALID_ASSET_PLAN" }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: brief, error: briefError } = await sb
    .from("content_briefs")
    .select("id, client_id, content_item_id, status, body")
    .eq("id", briefId)
    .maybeSingle();
  if (briefError) return json({ code: "LOOKUP_FAILED", message: briefError.message }, 500);
  if (!brief) return json({ code: "CONTENT_BRIEF_NOT_FOUND" }, 404);
  if (brief.client_id !== clientId) return json({ code: "CROSS_CLIENT_CONTENT_BRIEF" }, 403);
  // Stage H's own acceptance criterion: every production job starts from an
  // *approved* Brief. Enforced again here, at the Stage I entry point.
  if (brief.status !== "approved") {
    return json({ code: "BRIEF_NOT_APPROVED", message: `Brief status is "${brief.status}", not "approved".` }, 409);
  }

  const structured = brief.body as StructuredBriefLike;
  const route = routeToStudio({ format: structured.format, organicOrPaid: structured.organic_or_paid });
  if (!route.routable || !route.studio) {
    return json({ code: "UNROUTABLE_FORMAT", message: route.reason }, 422);
  }

  const idempotencyKey = buildProductionJobIdempotencyKey(brief.content_item_id, route.studio);

  const { data: existing, error: existingError } = await sb
    .from("production_jobs")
    .select("*")
    .eq("client_id", clientId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existingError) return json({ code: "LOOKUP_FAILED", message: existingError.message }, 500);
  if (existing) {
    return json({ ok: true, idempotent_replay: true, studio: route.studio, job: existing }, 200);
  }

  const { data: job, error: insertError } = await sb
    .from("production_jobs")
    .insert({
      client_id: clientId,
      content_item_id: brief.content_item_id,
      content_brief_id: briefId,
      capability: route.studio,
      status: "pending",
      idempotency_key: idempotencyKey,
      production_mode: structured.production_mode,
      asset_plan: assetPlan,
    })
    .select("*")
    .single();
  if (insertError) return json({ code: "INSERT_FAILED", message: insertError.message }, 500);

  await audit(sb, "production_job.routed", "production_jobs", job.id, {
    client_id: clientId, content_brief_id: briefId, studio: route.studio,
  });

  return json({ ok: true, idempotent_replay: false, studio: route.studio, job }, 201);
});
