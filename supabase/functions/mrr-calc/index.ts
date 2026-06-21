import { svc, json, cors, audit, agentEvent } from "../_shared/aa.ts";

// mrr-calc · CRON (daily)
// Rolls up active-client MRR from active contracts into mrr_snapshots, and
// writes a per-client pulse_metric. Idempotent per day (snapshot_date unique).
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const { data: contracts } = await sb.from("contracts").select("entity_id, mrr_cents").eq("status", "active");
    let total = 0; const clients = new Set<string>();
    const today = new Date().toISOString().slice(0, 10);
    for (const c of contracts ?? []) {
      const v = Number(c.mrr_cents ?? 0); total += v; clients.add(c.entity_id);
      await sb.from("pulse_metrics").upsert({ entity_id: c.entity_id, metric_date: today, metric_key: "mrr_cents", metric_value: v }, { onConflict: "entity_id,metric_date,metric_key" });
    }
    await sb.from("mrr_snapshots").upsert({ snapshot_date: today, mrr_cents: total, active_clients: clients.size, currency: "ZAR", breakdown: { source: "mrr-calc" } }, { onConflict: "snapshot_date" });
    await agentEvent(sb, null, "mrr-calc", "snapshot_written", { date: today, mrr_cents: total, active_clients: clients.size });
    await audit(sb, "mrr_calc", "mrr_snapshots", today, { mrr_cents: total, active_clients: clients.size });
    return json({ ok: true, date: today, mrr_cents: total, active_clients: clients.size });
  } catch (e) { return json({ error: String(e) }, 500); }
});
