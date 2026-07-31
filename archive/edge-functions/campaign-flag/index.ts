import { svc, json, cors, audit, agentEvent } from "../_shared/aa.ts";

const DRIFT_THRESHOLD = 0.35;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const { data: camps } = await sb.from("campaigns").select("id, entity_id, name").eq("status", "active");
    let flagged = 0;
    for (const c of camps ?? []) {
      const since48 = new Date(Date.now() - 48 * 3600e3).toISOString().slice(0, 10);
      const since7d = new Date(Date.now() - 7 * 24 * 3600e3).toISOString().slice(0, 10);
      const { data: recent } = await sb.from("ad_metrics").select("spend_cents, conversions").eq("campaign_id", c.id).gte("metric_date", since48);
      const { data: base } = await sb.from("ad_metrics").select("spend_cents, conversions").eq("campaign_id", c.id).gte("metric_date", since7d);
      const cpa = (rows: { spend_cents: number; conversions: number }[] | null) => { const s = (rows ?? []).reduce((a, r) => a + Number(r.spend_cents), 0); const cv = (rows ?? []).reduce((a, r) => a + Number(r.conversions), 0); return cv > 0 ? s / cv : null; };
      const cpaRecent = cpa(recent), cpaBase = cpa(base);
      if (cpaRecent == null || cpaBase == null || cpaBase === 0) continue;
      const drift = (cpaRecent - cpaBase) / cpaBase;
      if (drift >= DRIFT_THRESHOLD) {
        await sb.from("triage_items").insert({ entity_id: c.entity_id, source: "agent", priority: "high", status: "open", title: `CPA drift on ${c.name}: +${Math.round(drift * 100)}%`, detail: `48h CPA R${(cpaRecent / 100).toFixed(0)} vs 7d baseline R${(cpaBase / 100).toFixed(0)}. Decide: pause / reallocate / hold (SOP 10).` });
        await agentEvent(sb, c.entity_id, "metasync", "cpa_drift_flagged", { campaign_id: c.id, drift });
        flagged++;
      }
    }
    await audit(sb, "campaign_flag_sweep", "triage_items", null, { checked: camps?.length ?? 0, flagged });
    return json({ ok: true, checked: camps?.length ?? 0, flagged });
  } catch (e) { return json({ error: String(e) }, 500); }
});
