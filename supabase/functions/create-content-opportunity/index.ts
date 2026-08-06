// Programme Stage E runtime: convert a canonical source into a Content Opportunity.
//
// Satisfies Stage E acceptance criterion 5 ("every source can be converted into
// one or more Content Opportunities") without violating criterion 6: this writes
// only to content_opportunities and content_opportunity_sources. It never
// touches calendar_slots, calendar_cells, content_items, briefs or production.
//
// One source may produce MANY opportunities, so this is deliberately not
// idempotent on source alone. It is idempotent on (source, title).

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

const ORIGIN_BY_KIND: Record<string, string> = {
  manual_idea: "manual",
  proof_item: "proof",
  research_candidate: "research",
  performance_insight: "performance",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string;
    content_source_id?: string;
    title?: string;
    angle?: string | null;
    rationale?: string | null;
    additional_source_ids?: string[];
  };
  try { body = await req.json(); } catch {
    return json({ code: "INVALID_JSON" }, 400);
  }

  const clientId = (body.client_id ?? "").trim();
  const sourceId = (body.content_source_id ?? "").trim();
  const title = (body.title ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!sourceId) return json({ code: "CONTENT_SOURCE_ID_REQUIRED" }, 400);
  if (title.length < 1 || title.length > 400) {
    return json({ code: "INVALID_TITLE", message: "title must be 1-400 characters." }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const allSourceIds = [sourceId, ...(body.additional_source_ids ?? [])]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
  const uniqueSourceIds = [...new Set(allSourceIds)];

  // Every referenced source must belong to this client. Cross-client
  // composition is rejected outright rather than silently filtered.
  const { data: sources, error: sourceError } = await sb
    .from("content_sources")
    .select("id, client_id, source_kind")
    .in("id", uniqueSourceIds);
  if (sourceError) return json({ code: "LOOKUP_FAILED", message: sourceError.message }, 500);
  if (!sources || sources.length !== uniqueSourceIds.length) {
    return json({ code: "SOURCE_NOT_FOUND" }, 404);
  }
  const foreign = sources.filter((s) => s.client_id !== clientId);
  if (foreign.length > 0) {
    return json({ code: "CROSS_CLIENT_SOURCE", message: "A referenced source belongs to another client." }, 403);
  }

  const primary = sources.find((s) => s.id === sourceId)!;
  const origin = ORIGIN_BY_KIND[primary.source_kind as string] ?? "manual";

  // Idempotent on (source, title): re-submitting the same conversion returns
  // the existing opportunity rather than creating a near-duplicate.
  const { data: existing } = await sb
    .from("content_opportunity_sources")
    .select("content_opportunity_id, content_opportunities!inner(id, title, status)")
    .eq("content_source_id", sourceId)
    .eq("content_opportunities.title", title)
    .limit(1)
    .maybeSingle();
  if (existing) {
    return json({ duplicate: true, content_opportunity_id: existing.content_opportunity_id }, 200);
  }

  const { data: opportunity, error: insertError } = await sb
    .from("content_opportunities")
    .insert({
      client_id: clientId,
      title,
      angle: body.angle ?? null,
      rationale: body.rationale ?? null,
      status: "draft",
      origin,
      created_by: access.userId,
    })
    .select("id")
    .single();
  if (insertError) return json({ code: "INSERT_FAILED", message: insertError.message }, 500);

  const opportunityId = opportunity.id as string;

  const links = uniqueSourceIds.map((id) => ({
    client_id: clientId,
    content_opportunity_id: opportunityId,
    content_source_id: id,
    contribution: id === sourceId ? "primary" : "supporting",
  }));
  const { error: linkError } = await sb.from("content_opportunity_sources").insert(links);
  if (linkError) {
    // An opportunity with no provenance is worse than none at all.
    await sb.from("content_opportunities").delete().eq("id", opportunityId);
    return json({ code: "LINK_FAILED", message: linkError.message }, 500);
  }

  await audit(sb, "content_opportunity.created", "content_opportunities", opportunityId, {
    client_id: clientId,
    origin,
    source_count: uniqueSourceIds.length,
  });

  return json({
    duplicate: false,
    content_opportunity_id: opportunityId,
    origin,
    status: "draft",
    linked_sources: uniqueSourceIds.length,
  }, 201);
});
