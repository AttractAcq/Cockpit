// Programme Stage L — launch a Campaign: the one action in this stage that
// can spend real money, so it is the most heavily gated. Every safety check
// in _shared/ad-safety-policy.ts runs BEFORE any Meta credential is even
// read, let alone before any Meta API call. No live Meta ad-account
// credentials are configured anywhere in this project, so a real launch
// attempt today always fails closed at the credentials check with a clear,
// honest, non-fabricated error — this is a deliberate safety property of
// this deployment, not just an untested code path. See
// docs/programme/status/Stage_L_Status.md.
//
// Scope note: this launch creates the Meta Campaign and one Ad Set, then
// activates the Campaign. It does NOT yet create individual Meta Ad objects
// per creative variant (that requires an intermediate ad-creative upload
// step this pass did not build) — deferred, documented in the status report.

import { svc, cors, json, audit, readCredential } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { checkLaunchPolicy, type AdBudgetPolicy, NO_POLICY } from "../_shared/ad-safety-policy.ts";
import { createCampaignStep, createAdSetStep, activateCampaignStep, liveMetaAdsDeps, type MetaAdsCredentials } from "../_shared/meta-ads.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string; ad_campaign_id?: string;
    requested_geographies?: string[]; requested_audience_flags?: string[];
    regulated_category?: string; regulated_category_acknowledged?: boolean;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const campaignId = (body.ad_campaign_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!campaignId) return json({ code: "AD_CAMPAIGN_ID_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const campaign = await sb.from("ad_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (campaign.error) return json({ code: "LOOKUP_FAILED", message: campaign.error.message }, 500);
  if (!campaign.data || campaign.data.client_id !== clientId) return json({ code: "CROSS_CLIENT_CAMPAIGN" }, 403);
  if (!["draft", "pending_approval", "approved"].includes(campaign.data.status)) {
    return json({ code: "INVALID_TRANSITION", message: `Cannot launch from status "${campaign.data.status}".` }, 409);
  }
  if (campaign.data.external_campaign_id) {
    return json({ code: "ALREADY_LAUNCHED", message: "This campaign already has a live Meta campaign id; use pause/resume instead." }, 409);
  }

  // The claim gate (proof_required vs. verified Proof) is enforced once, at
  // Brief approval (manage-ad-brief) — the same point Stage H's organic
  // Brief approval gate lives, and the same convention: a campaign can only
  // ever be built from an already-approved Brief (checked in
  // create-ad-campaign), so an unsupported claim can never reach this point.

  const policyRow = await sb.from("ad_budget_policies").select("*").eq("client_id", clientId).maybeSingle();
  if (policyRow.error) return json({ code: "LOOKUP_FAILED", message: policyRow.error.message }, 500);
  const policy: AdBudgetPolicy = policyRow.data ? {
    adAccountId: policyRow.data.ad_account_id,
    adAccountOwnerVerified: policyRow.data.ad_account_owner_verified,
    paymentMethodVerified: policyRow.data.payment_method_verified,
    spendLimitDaily: policyRow.data.spend_limit_daily,
    spendLimitTotal: policyRow.data.spend_limit_total,
    requiresClientApproval: policyRow.data.requires_client_approval,
    allowedGeographies: policyRow.data.allowed_geographies ?? [],
    restrictedAudienceFlags: policyRow.data.restricted_audience_flags ?? [],
    regulatedCategories: policyRow.data.regulated_categories ?? [],
  } : NO_POLICY;

  const gate = checkLaunchPolicy({
    policy,
    campaign: { clientApprovedAt: campaign.data.client_approved_at, budgetDaily: campaign.data.budget_daily, budgetTotal: campaign.data.budget_total },
    requestedGeographies: Array.isArray(body.requested_geographies) ? body.requested_geographies : [],
    requestedAudienceFlags: Array.isArray(body.requested_audience_flags) ? body.requested_audience_flags : [],
    regulatedCategory: body.regulated_category ?? null,
    regulatedCategoryAcknowledged: body.regulated_category_acknowledged === true,
  });

  const attemptCountRow = await sb.from("ad_launch_attempts").select("id", { count: "exact", head: true }).eq("ad_campaign_id", campaignId);
  const attemptNumber = (attemptCountRow.count ?? 0) + 1;

  if (!gate.allowed) {
    await sb.from("ad_launch_attempts").insert({
      client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber,
      action: "launch", result: "blocked", category: gate.code, message: gate.reason, completed_at: new Date().toISOString(),
    });
    return json({ code: gate.code, message: gate.reason }, 409);
  }

  // Credentials — never touch Meta without them. This project has none
  // configured, so this is the honest, expected outcome of every launch
  // attempt made against this deployment.
  const clientRow = await sb.from("clients").select("slug").eq("id", clientId).maybeSingle();
  const clientSlug = clientRow.data?.slug ?? "";
  const accessToken = await readCredential(sb, clientSlug, "META_ADS", "ACCESS_TOKEN");
  const adAccountId = policy.adAccountId;
  if (!accessToken || !adAccountId) {
    const missing = [!accessToken && "Meta ads access token", !adAccountId && "ad account id"].filter(Boolean).join(", ");
    await sb.from("ad_launch_attempts").insert({
      client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber,
      action: "launch", result: "failed", category: "missing_config",
      message: `Meta ads configuration missing: ${missing}.`, completed_at: new Date().toISOString(),
    });
    return json({ code: "MISSING_CONFIG", message: `Meta ads configuration missing: ${missing}. Nothing was launched.` }, 409);
  }

  const creds: MetaAdsCredentials = { accessToken, adAccountId };
  const deps = liveMetaAdsDeps();

  await sb.from("ad_campaigns").update({ status: "launching", launch_attempted_at: new Date().toISOString() }).eq("id", campaignId);

  const campaignStep = await createCampaignStep(deps, creds, { name: campaign.data.name, objective: campaign.data.objective, specialAdCategories: [] });
  if (!campaignStep.ok) {
    await sb.from("ad_campaigns").update({ status: "failed", last_error: campaignStep.error.message }).eq("id", campaignId);
    await sb.from("ad_launch_attempts").insert({
      client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber, action: "create_campaign",
      result: "failed", category: campaignStep.error.category, message: campaignStep.error.message, completed_at: new Date().toISOString(),
    });
    return json({ code: "META_CAMPAIGN_CREATE_FAILED", message: campaignStep.error.message }, 502);
  }
  await sb.from("ad_campaigns").update({ external_campaign_id: campaignStep.value }).eq("id", campaignId);

  const adSet = await sb.from("ad_sets").select("*").eq("ad_campaign_id", campaignId).limit(1).maybeSingle();
  if (adSet.data) {
    const adSetStep = await createAdSetStep(deps, creds, {
      name: adSet.data.name, campaignExternalId: campaignStep.value,
      dailyBudgetMinorUnits: Math.round((adSet.data.budget_daily ?? campaign.data.budget_daily ?? 0) * 100),
      optimizationGoal: "LINK_CLICKS", geoLocations: Array.isArray(body.requested_geographies) ? body.requested_geographies : [],
    });
    if (adSetStep.ok) {
      await sb.from("ad_sets").update({ external_ad_set_id: adSetStep.value }).eq("id", adSet.data.id);
    }
  }

  const activation = await activateCampaignStep(deps, creds, campaignStep.value);
  const finalStatus = activation.ok ? "active" : "failed";
  await sb.from("ad_campaigns").update({
    status: finalStatus, last_error: activation.ok ? null : activation.error.message,
  }).eq("id", campaignId);

  await sb.from("ad_launch_attempts").insert({
    client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber, action: "launch",
    result: activation.ok ? "success" : "failed",
    category: activation.ok ? null : activation.error.category,
    message: activation.ok ? "Campaign launched." : activation.error.message,
    external_ids: { campaign: campaignStep.value }, completed_at: new Date().toISOString(),
  });

  await audit(sb, "ad_campaign.launched", "ad_campaigns", campaignId, { client_id: clientId, success: activation.ok });

  const updated = await sb.from("ad_campaigns").select("*").eq("id", campaignId).single();
  return json({ ok: activation.ok, campaign: updated.data }, activation.ok ? 200 : 502);
});
