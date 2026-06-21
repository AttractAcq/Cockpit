import { svc, json, cors, useStubs, readCredential, audit, agentEvent } from "../_shared/aa.ts";

async function claudeCopy(key: string, ctx: Record<string, unknown>): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("AA_CLAUDE_MODEL") ?? "claude-sonnet-4-20250514", max_tokens: 1200, system: "You write AA Missed Jobs Reports for owner-operated Cape Town trades. Sell the problem, not the product. Factual, grounded, no hype.", messages: [{ role: "user", content: `Draft MJR copy for: ${JSON.stringify(ctx)}` }] }) });
  const j = await resp.json();
  return j?.content?.map((b: { text?: string }) => b.text ?? "").join("") ?? "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const { entity_id } = await req.json();
    if (!entity_id) return json({ error: "entity_id required" }, 400);
    const { data: ent } = await sb.from("entities").select("*").eq("id", entity_id).single();
    if (!ent) return json({ error: "entity not found" }, 404);
    const ctx = { business_name: ent.business_name, niche: ent.niche, city: ent.city };
    const key = await readCredential(sb, "_global", "anthropic", "api_key");
    const stub = useStubs() || !key;
    const copy = stub ? `MISSED JOBS REPORT (draft)\n\n${ent.business_name} — ${ent.niche}, ${ent.city}\n\nLocal search demand suggests an estimated 12–18 qualified ${ent.niche} jobs per month are reaching competitors first. The gap is not capability — it is visibility and proof. [stub copy — pending Claude]` : await claudeCopy(key, ctx);
    const storage_path = `${entity_id}/mjr/mjr_${Date.now()}.pdf`;
    const { data: asset } = await sb.from("assets").insert({ entity_id, kind: "mjr", title: `MJR — ${ent.business_name}`, storage_path, status: "review", metadata: { copy, stub, generated_at: new Date().toISOString() } }).select("id").single();
    await agentEvent(sb, entity_id, "claude-content", "mjr_generated", { stub, asset_id: asset?.id });
    await audit(sb, "mjr_generate", "assets", asset?.id ?? null, { stub, entity_id });
    return json({ ok: true, stub, asset_id: asset?.id, storage_path, copy, needs_approval: true });
  } catch (e) { return json({ error: String(e) }, 500); }
});
