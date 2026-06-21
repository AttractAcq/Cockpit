import { svc, json, cors, audit } from "../_shared/aa.ts";

function authed(req: Request): boolean {
  const expected = Deno.env.get("AA_WEBHOOK_SECRET");
  if (!expected) return true;
  return req.headers.get("x-aa-webhook-secret") === expected;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method === "GET") return new Response("ok", { headers: cors });
  if (!authed(req)) return json({ error: "unauthorized" }, 401);
  try {
    const sb = svc();
    const payload = await req.json().catch(() => ({}));
    const value = payload?.entry?.[0]?.changes?.[0]?.value ?? payload?.value ?? payload;
    const msgs = value?.messages ?? (payload.from ? [payload] : []);
    const results: unknown[] = [];
    for (const m of msgs) {
      const from = m.from ?? value?.contacts?.[0]?.wa_id ?? "unknown";
      const text = m.text?.body ?? m.body ?? "";
      let { data: ent } = await sb.from("entities").select("id").eq("contact_phone", from).maybeSingle();
      if (!ent) { const { data: e } = await sb.from("entities").insert({ kind: "prospect", stage: "engaged", business_name: `WhatsApp ${from}`, contact_phone: from }).select("id").single(); ent = e; }
      let { data: conv } = await sb.from("conversations").select("id").eq("entity_id", ent!.id).eq("channel", "whatsapp").eq("status", "open").maybeSingle();
      if (!conv) { const { data: c } = await sb.from("conversations").insert({ entity_id: ent!.id, channel: "whatsapp", status: "open" }).select("id").single(); conv = c; }
      await sb.from("messages").insert({ conversation_id: conv!.id, direction: "inbound", sender: from, body: text });
      await sb.functions.invoke("aicos-act", { body: { command: "score_reply", entity_id: ent!.id, message: text } }).catch(() => {});
      results.push({ entity_id: ent!.id, conversation_id: conv!.id });
    }
    await audit(sb, "whatsapp_inbound", "messages", null, { count: results.length });
    return json({ ok: true, processed: results.length });
  } catch (e) { return json({ error: String(e) }, 500); }
});
