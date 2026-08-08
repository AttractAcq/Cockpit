// Programme Stage L — Campaign status transitions: pause, resume, complete,
// archive, and operator-confirmed reconcile (mirrors the organic
// reconcile_distribution_record pattern: the operator verifies real state on
// Meta themselves, then tells Cockpit which outcome is true — never a blind
// automated guess).

import { svc, cors, json, audit, readCredential } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { pauseCampaignStep, activateCampaignStep, liveMetaAdsDeps, type MetaAdsCredentials } from "../_shared/meta-ads.ts";

type Action = "pause" | "resume" | "complete" | "archive" | "reconcile";
const ACTIONS: readonly Action[] = ["pause", "resume", "complete", "archive", "reconcile"];

const ALLOWED_FROM: Record<Action, readonly string[]> = {
  pause: ["active"],
  resume: ["paused"],
  complete: ["active", "paused"],
  archive: ["completed", "failed", "draft"],
  reconcile: ["active", "paused", "launching", "failed"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; ad_campaign_id?: string; action?: string; reconciled_status?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const campaignId = (body.ad_campaign_id ?? "").trim();
  const action = (body.action ?? "").trim() as Action;
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!campaignId) return json({ code: "AD_CAMPAIGN_ID_REQUIRED" }, 400);
  if (!ACTIONS.includes(action)) return json({ code: "INVALID_ACTION", message: `action must be one of: ${ACTIONS.join(", ")}` }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const campaign = await sb.from("ad_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (campaign.error) return json({ code: "LOOKUP_FAILED", message: campaign.error.message }, 500);
  if (!campaign.data || campaign.data.client_id !== clientId) return json({ code: "CROSS_CLIENT_CAMPAIGN" }, 403);

  if (!ALLOWED_FROM[action].includes(campaign.data.status)) {
    return json({ code: "INVALID_TRANSITION", message: `Cannot ${action} from status "${campaign.data.status}".` }, 409);
  }

  const attemptCountRow = await sb.from("ad_launch_attempts").select("id", { count: "exact", head: true }).eq("ad_campaign_id", campaignId);
  const attemptNumber = (attemptCountRow.count ?? 0) + 1;

  if (action === "reconcile") {
    const reconciledStatus = (body.reconciled_status ?? "").trim();
    if (!["active", "paused", "completed", "failed"].includes(reconciledStatus)) {
      return json({ code: "INVALID_RECONCILED_STATUS" }, 400);
    }
    const updated = await sb.from("ad_campaigns").update({ status: reconciledStatus, last_reconciled_at: new Date().toISOString() }).eq("id", campaignId).select("*").single();
    if (updated.error) return json({ code: "UPDATE_FAILED", message: updated.error.message }, 500);
    await sb.from("ad_launch_attempts").insert({
      client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber, action: "reconcile",
      result: "success", message: `Operator-confirmed reconciliation to "${reconciledStatus}".`, completed_at: new Date().toISOString(),
    });
    await audit(sb, "ad_campaign.reconciled", "ad_campaigns", campaignId, { client_id: clientId, reconciled_status: reconciledStatus });
    return json({ ok: true, campaign: updated.data });
  }

  if (action === "complete" || action === "archive") {
    const nextStatus = action === "complete" ? "completed" : "archived";
    const updated = await sb.from("ad_campaigns").update({ status: nextStatus }).eq("id", campaignId).select("*").single();
    if (updated.error) return json({ code: "UPDATE_FAILED", message: updated.error.message }, 500);
    await audit(sb, `ad_campaign.${action}d`, "ad_campaigns", campaignId, { client_id: clientId });
    return json({ ok: true, campaign: updated.data });
  }

  // pause / resume — real Meta calls, same missing-config fail-closed pattern as launch.
  if (!campaign.data.external_campaign_id) {
    return json({ code: "NOT_LAUNCHED", message: "This campaign has no live Meta campaign id yet." }, 409);
  }
  const clientRow = await sb.from("clients").select("slug").eq("id", clientId).maybeSingle();
  const accessToken = await readCredential(sb, clientRow.data?.slug ?? "", "META_ADS", "ACCESS_TOKEN");
  const policyRow = await sb.from("ad_budget_policies").select("ad_account_id").eq("client_id", clientId).maybeSingle();
  const adAccountId = policyRow.data?.ad_account_id ?? null;
  if (!accessToken || !adAccountId) {
    const missing = [!accessToken && "Meta ads access token", !adAccountId && "ad account id"].filter(Boolean).join(", ");
    await sb.from("ad_launch_attempts").insert({
      client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber, action,
      result: "failed", category: "missing_config", message: `Meta ads configuration missing: ${missing}.`, completed_at: new Date().toISOString(),
    });
    return json({ code: "MISSING_CONFIG", message: `Meta ads configuration missing: ${missing}.` }, 409);
  }

  const creds: MetaAdsCredentials = { accessToken, adAccountId };
  const deps = liveMetaAdsDeps();
  const step = action === "pause"
    ? await pauseCampaignStep(deps, creds, campaign.data.external_campaign_id)
    : await activateCampaignStep(deps, creds, campaign.data.external_campaign_id);

  const nextStatus = step.ok ? (action === "pause" ? "paused" : "active") : campaign.data.status;
  await sb.from("ad_campaigns").update({ status: nextStatus, last_error: step.ok ? null : step.error.message }).eq("id", campaignId);
  await sb.from("ad_launch_attempts").insert({
    client_id: clientId, ad_campaign_id: campaignId, attempt_number: attemptNumber, action,
    result: step.ok ? "success" : "failed", category: step.ok ? null : step.error.category,
    message: step.ok ? `Campaign ${action}d.` : step.error.message, completed_at: new Date().toISOString(),
  });
  if (!step.ok) return json({ code: "META_CALL_FAILED", message: step.error.message }, 502);

  await audit(sb, `ad_campaign.${action}d`, "ad_campaigns", campaignId, { client_id: clientId });
  const updated = await sb.from("ad_campaigns").select("*").eq("id", campaignId).single();
  return json({ ok: true, campaign: updated.data });
});
