import { svc, json, cors, useStubs, readCredential, audit, agentEvent } from "../_shared/aa.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const { action, entity_id, client_slug, campaign_id = null, params = {} } = await req.json();
    if (!action || !entity_id) return json({ error: "action and entity_id required" }, 400);
    const token = client_slug ? await readCredential(sb, client_slug, "meta", "access_token") : await readCredential(sb, "_global", "meta", "system_user_token");
    const stub = useStubs() || !token;
    let result: Record<string, unknown> = {};
    switch (action) {
      case "create_campaign": {
        const ext = stub ? `stub-camp-${crypto.randomUUID()}` : await metaCreate(token!, params);
        const { data: c } = await sb.from("campaigns").insert({ entity_id, name: params.name ?? "Untitled campaign", platform: "meta", external_id: ext, objective: params.objective ?? "OUTCOME_LEADS", status: "draft", daily_budget_cents: params.daily_budget_cents ?? null }).select("id").single();
        result = { campaign_id: c?.id, external_id: ext };
        break;
      }
      case "pause": { await sb.from("campaigns").update({ status: "paused" }).eq("id", campaign_id); result = { campaign_id, status: "paused" }; break; }
      case "read_insights": { const spend = stub ? 12500 : 0; result = { campaign_id, spend_cents: spend, stub }; break; }
      default: return json({ error: `unknown action: ${action}` }, 400);
    }
    await agentEvent(sb, entity_id, "metasync", `ad_ops_${action}`, { stub, ...result });
    await audit(sb, `meta_${action}`, "campaigns", String(result.campaign_id ?? campaign_id ?? ""), { stub });
    return json({ ok: true, action, stub, ...result });
  } catch (e) { return json({ error: String(e) }, 500); }
});

async function metaCreate(token: string, params: Record<string, unknown>): Promise<string> {
  const acct = params.ad_account_id ?? Deno.env.get("AA_META_AD_ACCOUNT");
  const resp = await fetch(`https://graph.facebook.com/v21.0/act_${acct}/campaigns`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...params, status: "PAUSED", access_token: token }) });
  const j = await resp.json();
  return j?.id ?? `meta-${Date.now()}`;
}
