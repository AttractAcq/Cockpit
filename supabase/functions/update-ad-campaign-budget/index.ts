// Programme Stage L — update a Campaign's budget. Re-checks the spend-limit
// policy against the NEW requested budget before accepting it — a budget
// increase can never bypass the same limit a launch would have been gated
// by ("Budget cannot exceed configured limit").

import { svc, cors, json, audit, readCredential } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { checkSpendLimitPolicy, type AdBudgetPolicy, NO_POLICY } from "../_shared/ad-safety-policy.ts";
import { updateBudgetStep, liveMetaAdsDeps, type MetaAdsCredentials } from "../_shared/meta-ads.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; ad_campaign_id?: string; budget_daily?: number; budget_total?: number };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const campaignId = (body.ad_campaign_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!campaignId) return json({ code: "AD_CAMPAIGN_ID_REQUIRED" }, 400);
  const budgetDaily = typeof body.budget_daily === "number" ? body.budget_daily : null;
  const budgetTotal = typeof body.budget_total === "number" ? body.budget_total : null;
  if (budgetDaily === null && budgetTotal === null) return json({ code: "BUDGET_REQUIRED" }, 400);
  if ((budgetDaily !== null && budgetDaily < 0) || (budgetTotal !== null && budgetTotal < 0)) return json({ code: "INVALID_BUDGET" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const campaign = await sb.from("ad_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (campaign.error) return json({ code: "LOOKUP_FAILED", message: campaign.error.message }, 500);
  if (!campaign.data || campaign.data.client_id !== clientId) return json({ code: "CROSS_CLIENT_CAMPAIGN" }, 403);
  if (!["draft", "pending_approval", "approved", "active", "paused"].includes(campaign.data.status)) {
    return json({ code: "INVALID_TRANSITION", message: `Cannot update budget from status "${campaign.data.status}".` }, 409);
  }

  const policyRow = await sb.from("ad_budget_policies").select("*").eq("client_id", clientId).maybeSingle();
  const policy: AdBudgetPolicy = policyRow.data ? {
    adAccountId: policyRow.data.ad_account_id, adAccountOwnerVerified: policyRow.data.ad_account_owner_verified,
    paymentMethodVerified: policyRow.data.payment_method_verified, spendLimitDaily: policyRow.data.spend_limit_daily,
    spendLimitTotal: policyRow.data.spend_limit_total, requiresClientApproval: policyRow.data.requires_client_approval,
    allowedGeographies: policyRow.data.allowed_geographies ?? [], restrictedAudienceFlags: policyRow.data.restricted_audience_flags ?? [],
    regulatedCategories: policyRow.data.regulated_categories ?? [],
  } : NO_POLICY;

  const gate = checkSpendLimitPolicy(policy, budgetDaily ?? campaign.data.budget_daily, budgetTotal ?? campaign.data.budget_total);
  const attemptCountRow = await sb.from("ad_launch_attempts").select("id", { count: "exact", head: true }).eq("ad_campaign_id", campaignId);
  const attemptNumber = (attemptCountRow.count ?? 0) + 1;

  if (!gate.allowed) {
    await sb.from("ad_launch_attempts").insert({
      client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber, action: "update_budget",
      result: "blocked", category: gate.code, message: gate.reason, completed_at: new Date().toISOString(),
    });
    return json({ code: gate.code, message: gate.reason }, 409);
  }

  // If already live on Meta, push the change there too — same fail-closed
  // missing-config pattern as launch/pause/resume.
  if (campaign.data.external_campaign_id && budgetDaily !== null) {
    const adSet = await sb.from("ad_sets").select("external_ad_set_id").eq("ad_campaign_id", campaignId).limit(1).maybeSingle();
    if (adSet.data?.external_ad_set_id) {
      const clientRow = await sb.from("clients").select("slug").eq("id", clientId).maybeSingle();
      const accessToken = await readCredential(sb, clientRow.data?.slug ?? "", "META_ADS", "ACCESS_TOKEN");
      if (!accessToken || !policy.adAccountId) {
        await sb.from("ad_launch_attempts").insert({
          client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber, action: "update_budget",
          result: "failed", category: "missing_config", message: "Meta ads configuration missing.", completed_at: new Date().toISOString(),
        });
        return json({ code: "MISSING_CONFIG", message: "Meta ads configuration missing; the live budget was not changed." }, 409);
      }
      const creds: MetaAdsCredentials = { accessToken, adAccountId: policy.adAccountId };
      const step = await updateBudgetStep(liveMetaAdsDeps(), creds, adSet.data.external_ad_set_id, Math.round(budgetDaily * 100));
      if (!step.ok) {
        await sb.from("ad_launch_attempts").insert({
          client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber, action: "update_budget",
          result: "failed", category: step.error.category, message: step.error.message, completed_at: new Date().toISOString(),
        });
        return json({ code: "META_CALL_FAILED", message: step.error.message }, 502);
      }
    }
  }

  const updated = await sb.from("ad_campaigns").update({
    budget_daily: budgetDaily ?? campaign.data.budget_daily, budget_total: budgetTotal ?? campaign.data.budget_total,
  }).eq("id", campaignId).select("*").single();
  if (updated.error) return json({ code: "UPDATE_FAILED", message: updated.error.message }, 500);

  await sb.from("ad_launch_attempts").insert({
    client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber, action: "update_budget",
    result: "success", message: "Budget updated.", completed_at: new Date().toISOString(),
  });
  await audit(sb, "ad_campaign.budget_updated", "ad_campaigns", campaignId, { client_id: clientId, budget_daily: budgetDaily, budget_total: budgetTotal });

  return json({ ok: true, campaign: updated.data });
});
