// Programme Stage L extension — when an approved paid (ads_master-origin)
// asset group is approved in Assets, it attaches as a real image creative
// into Ad Studio instead of reaching client_distribution_records the way
// organic content does. Finds-or-creates the Ad Opportunity + Ad Brief for
// the asset's Calendar ref (idempotent, keyed by the new
// ad_opportunities.ads_master_id column), then inserts an
// ad_creative_variants row carrying client_asset_id.
//
// A freshly-created Brief always starts at status 'draft' -- this never
// skips Ad Studio's own submit_for_review/approve/launch gates, it only
// seeds them. Every field on an auto-created Brief is pulled from real,
// already-decided data (the ads_master planning row, and the approved
// asset's own production brief content) -- two fields have no honest real
// source at this point (landing_page, and cta_text when ads_master has no
// conversion_action) and are marked "needs_client_input" rather than
// invented, matching this codebase's existing convention for honest gaps.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { validateAdBriefBody, renderAdBriefMarkdown, type AdBriefBody } from "../_shared/ad-studio.ts";

const NEEDS_CLIENT_INPUT = "needs_client_input";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; asset_group_ref?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const assetGroupRef = (body.asset_group_ref ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!assetGroupRef) return json({ code: "ASSET_GROUP_REF_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const assets = await sb.from("client_assets")
    .select("id, title, status, sequence_index, production_brief:client_production_briefs(id, source_table, source_row_id, source_ref, execution_month, title, content_md)")
    .eq("client_id", clientId).eq("asset_group_ref", assetGroupRef).eq("is_current", true)
    .order("sequence_index", { ascending: true });
  if (assets.error) return json({ code: "LOOKUP_FAILED", message: assets.error.message }, 500);
  const rows = assets.data ?? [];
  if (!rows.length) return json({ code: "ASSET_GROUP_NOT_FOUND" }, 404);
  if (rows.some((row) => row.status !== "approved")) {
    return json({ code: "ASSET_GROUP_NOT_APPROVED", message: "Every asset in the group must be approved before it can attach as a creative." }, 409);
  }
  const asset = rows[0];
  // Supabase-js types a to-one FK join (production_brief:client_production_briefs(...))
  // as an array even though the query returns a single row — narrow through
  // unknown to the actual selected shape rather than reaching for `any`.
  interface ProductionBriefRef {
    id: string;
    source_table: string;
    source_row_id: string;
    source_ref: string;
    execution_month: string;
    title: string;
    content_md: string;
  }
  const brief = asset.production_brief as unknown as ProductionBriefRef | null;
  if (!brief) return json({ code: "PRODUCTION_BRIEF_NOT_FOUND" }, 404);
  if (brief.source_table !== "ads_master") {
    return json({ code: "NOT_A_PAID_ASSET", message: "This function only attaches ads_master-origin assets. Organic assets promote to distribution instead." }, 400);
  }

  const adsMaster = await sb.from("ads_master")
    .select("id, ref, stint_name, objective, funnel_stage, audience, hook_angle, primary_goal, conversion_action, meta_objective")
    .eq("id", brief.source_row_id).maybeSingle();
  if (adsMaster.error) return json({ code: "LOOKUP_FAILED", message: adsMaster.error.message }, 500);
  if (!adsMaster.data) return json({ code: "ADS_MASTER_NOT_FOUND" }, 404);
  const am = adsMaster.data;

  // Find-or-create the Ad Opportunity for this Calendar ref.
  let opportunityId: string;
  let createdOpportunity = false;
  const existingOpportunity = await sb.from("ad_opportunities").select("id").eq("client_id", clientId).eq("ads_master_id", am.id).maybeSingle();
  if (existingOpportunity.error) return json({ code: "LOOKUP_FAILED", message: existingOpportunity.error.message }, 500);
  if (existingOpportunity.data) {
    opportunityId = existingOpportunity.data.id;
  } else {
    const insertedOpportunity = await sb.from("ad_opportunities").insert({
      client_id: clientId, title: am.stint_name || brief.title, origin: "calendar_planned",
      ads_master_id: am.id, core_claim: am.hook_angle ?? null, offer_ref: null,
      notes: `Auto-created when the approved asset for Calendar ref ${am.ref} was attached as a creative.`,
      generated_by: "ai", created_by: access.userId,
    }).select("id").single();
    if (insertedOpportunity.error) return json({ code: "INSERT_FAILED", message: insertedOpportunity.error.message }, 500);
    opportunityId = insertedOpportunity.data.id;
    createdOpportunity = true;
    await audit(sb, "ad_opportunity.created", "ad_opportunities", opportunityId, { client_id: clientId, origin: "calendar_planned", ads_master_id: am.id });
  }

  // Find-or-create the active (non-superseded) Ad Brief for that Opportunity.
  let briefId: string;
  let briefBody: AdBriefBody;
  let createdBrief = false;
  const existingBrief = await sb.from("ad_briefs").select("id, body")
    .eq("ad_opportunity_id", opportunityId).neq("status", "superseded")
    .order("brief_version", { ascending: false }).limit(1).maybeSingle();
  if (existingBrief.error) return json({ code: "LOOKUP_FAILED", message: existingBrief.error.message }, 500);
  if (existingBrief.data) {
    briefId = existingBrief.data.id;
    briefBody = existingBrief.data.body as AdBriefBody;
  } else {
    const draftBody: AdBriefBody = {
      campaign_objective: am.objective || am.meta_objective || NEEDS_CLIENT_INPUT,
      awareness_stage: am.funnel_stage || NEEDS_CLIENT_INPUT,
      audience: am.audience || NEEDS_CLIENT_INPUT,
      offer: am.primary_goal || brief.title,
      landing_page: NEEDS_CLIENT_INPUT,
      primary_claim: am.hook_angle || brief.title,
      proof_required: false,
      hook_variants: [am.hook_angle || brief.title],
      visual_variants: [asset.title || brief.title],
      copy_variants: [brief.content_md],
      cta_variants: [am.conversion_action || NEEDS_CLIENT_INPUT],
      placement: ["feed"],
      testing_role: "primary",
      attribution_requirements: { pixel_id: null, conversion_event: am.conversion_action ?? null },
    };
    const validated = validateAdBriefBody(draftBody);
    if (!validated) return json({ code: "DRAFT_BRIEF_BODY_INVALID" }, 500);
    const versionQuery = await sb.from("ad_briefs").select("brief_version").eq("ad_opportunity_id", opportunityId).order("brief_version", { ascending: false }).limit(1);
    if (versionQuery.error) return json({ code: "LOOKUP_FAILED", message: versionQuery.error.message }, 500);
    const nextVersion = (versionQuery.data?.[0]?.brief_version ?? 0) + 1;
    const insertedBrief = await sb.from("ad_briefs").insert({
      client_id: clientId, ad_opportunity_id: opportunityId, brief_version: nextVersion,
      status: "draft", body: validated, rendered_markdown: renderAdBriefMarkdown(validated),
      created_by: access.userId,
    }).select("id, body").single();
    if (insertedBrief.error) return json({ code: "INSERT_FAILED", message: insertedBrief.error.message }, 500);
    briefId = insertedBrief.data.id;
    briefBody = insertedBrief.data.body as AdBriefBody;
    createdBrief = true;
    await audit(sb, "ad_brief.created", "ad_briefs", briefId, { client_id: clientId, ad_opportunity_id: opportunityId, auto_created: true });
  }

  // Idempotent: an asset already attached returns its existing variant.
  const existingVariant = await sb.from("ad_creative_variants").select("id").eq("client_asset_id", asset.id).maybeSingle();
  if (existingVariant.error) return json({ code: "LOOKUP_FAILED", message: existingVariant.error.message }, 500);
  if (existingVariant.data) {
    return json({
      ok: true, ad_opportunity_id: opportunityId, ad_brief_id: briefId,
      ad_creative_variant_id: existingVariant.data.id, created_opportunity: createdOpportunity,
      created_brief: createdBrief, replayed: true,
    });
  }

  const variantCount = await sb.from("ad_creative_variants").select("id", { count: "exact", head: true }).eq("ad_brief_id", briefId);
  if (variantCount.error) return json({ code: "LOOKUP_FAILED", message: variantCount.error.message }, 500);
  const copyIndex = variantCount.count ?? 0;

  const insertedVariant = await sb.from("ad_creative_variants").insert({
    client_id: clientId, ad_brief_id: briefId,
    hook_index: 0, visual_index: 0, copy_index: copyIndex, cta_index: 0, format: "feed",
    hook_text: briefBody.hook_variants[0] ?? brief.title,
    visual_ref: asset.title || brief.title,
    copy_text: brief.content_md,
    cta_text: am.conversion_action || NEEDS_CLIENT_INPUT,
    status: "draft", client_asset_id: asset.id,
    source_provenance: { source: "asset_approval", client_asset_id: asset.id, production_brief_id: brief.id, attached_by: access.userId },
  }).select("id").single();
  if (insertedVariant.error) return json({ code: "INSERT_FAILED", message: insertedVariant.error.message }, 500);

  await audit(sb, "ad_creative_variant.attached_from_asset", "ad_creative_variants", insertedVariant.data.id, {
    client_id: clientId, client_asset_id: asset.id, ad_brief_id: briefId,
  });

  return json({
    ok: true, ad_opportunity_id: opportunityId, ad_brief_id: briefId,
    ad_creative_variant_id: insertedVariant.data.id, created_opportunity: createdOpportunity,
    created_brief: createdBrief, replayed: false,
  }, 201);
});
