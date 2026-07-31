import { svc, json, cors, audit } from "../_shared/aa.ts";

// client-portal-sync · INVOKE
// Aggregates a client-scoped view: ad metrics, content queue, lead count.
// Auth-gated: verifies the caller owns the requested entity_id or is staff
// (admin/distribution/delivery) before issuing service-role queries.
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { entity_id } = await req.json();
    if (!entity_id) return json({ error: "entity_id required" }, 400);

    // Resolve caller identity from their JWT.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const sb = svc();
    const { data: { user }, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !user) return json({ error: "unauthorized" }, 401);

    // Fetch their team_members row to determine role and linked entity.
    const { data: member } = await sb
      .from("team_members")
      .select("role, client_entity_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) return json({ error: "forbidden" }, 403);

    // Staff may access any entity; clients only their own.
    const STAFF_ROLES = ["admin", "distribution", "delivery"];
    if (!STAFF_ROLES.includes(member.role) && member.client_entity_id !== entity_id) {
      return json({ error: "forbidden" }, 403);
    }

    // All subsequent queries run under service role (already in sb).
    const { data: ent } = await sb.from("entities").select("id, business_name, stage").eq("id", entity_id).single();
    if (!ent) return json({ error: "entity not found" }, 404);

    const { data: campaigns } = await sb.from("campaigns").select("id, name, status").eq("entity_id", entity_id);
    const campIds = (campaigns ?? []).map((c) => c.id);
    let spend = 0, leads = 0, conversions = 0;
    if (campIds.length) {
      const { data: m } = await sb.from("ad_metrics").select("spend_cents, leads, conversions").in("campaign_id", campIds);
      for (const r of m ?? []) { spend += Number(r.spend_cents); leads += Number(r.leads); conversions += Number(r.conversions); }
    }
    const { data: queued } = await sb.from("assets").select("id, kind, title, status").eq("entity_id", entity_id).eq("status", "review");
    const { data: contract } = await sb
      .from("contracts")
      .select("tier, mrr_cents, status, starts_at, ends_at")
      .eq("entity_id", entity_id)
      .eq("status", "active")
      .maybeSingle();

    await audit(sb, "portal_sync", "entities", entity_id, { campaigns: campIds.length });
    return json({
      ok: true, entity_id, business_name: ent.business_name, stage: ent.stage,
      metrics: { spend_cents: spend, leads, conversions, campaigns: campIds.length },
      content_for_review: queued ?? [], contract: contract ?? null,
    });
  } catch (e) { return json({ error: String(e) }, 500); }
});
