import { svc, json, cors, useStubs, readCredential, audit, agentEvent } from "../_shared/aa.ts";

async function claudeBrief(key: string, ctx: Record<string, unknown>): Promise<string> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("AA_CLAUDE_MODEL") ?? "claude-sonnet-4-20250514", max_tokens: 900, system: "You write faceless 9:16 reel briefs (22-34s, B-roll/animation) for AA trade clients, in the AA voice and the client's brand context. Output a structured brief: hook, beats, b-roll list, on-screen text, CTA.", messages: [{ role: "user", content: `Brief for: ${JSON.stringify(ctx)}` }] }) });
  const j = await resp.json();
  return j?.content?.map((b: { text?: string }) => b.text ?? "").join("") ?? "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const { entity_id, topic = "general proof reel", ref_code = null } = await req.json();
    if (!entity_id) return json({ error: "entity_id required" }, 400);
    const { data: ent } = await sb.from("entities").select("*").eq("id", entity_id).single();
    if (!ent) return json({ error: "entity not found" }, 404);
    const ctx = { business_name: ent.business_name, niche: ent.niche, topic };
    const key = await readCredential(sb, "_global", "anthropic", "api_key");
    const stub = useStubs() || !key;
    const body = stub ? `REEL BRIEF (draft) — ${ent.business_name}\nTopic: ${topic}\nHook (0-3s): "The ${ent.niche} job nobody saw coming"\nBeats: before -> process -> reveal\nB-roll: site arrival, work in progress, finished result\nOn-screen text: 3 short lines\nCTA: "Booking ${ent.city} jobs now"\n[stub - pending Claude]` : await claudeBrief(key, ctx);
    const { data: brief } = await sb.from("briefs").insert({ entity_id, ref_code, title: `Reel brief — ${topic}`, body, status: "draft" }).select("id").single();
    await agentEvent(sb, entity_id, "claude-content", "brief_generated", { stub, brief_id: brief?.id, topic });
    await audit(sb, "brief_generate", "briefs", brief?.id ?? null, { stub, entity_id });
    return json({ ok: true, stub, brief_id: brief?.id, body, needs_approval: true });
  } catch (e) { return json({ error: String(e) }, 500); }
});
