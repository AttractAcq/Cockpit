import { svc, json, cors, useStubs, readCredential, audit } from "../_shared/aa.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const { entity_id, conversation_id = null, to, body, template = null, client_slug, approved = false } = await req.json();
    if (!to || !body) return json({ error: "to and body required" }, 400);
    if (!approved) return json({ error: "send blocked: requires approved=true (human-approval guardrail)" }, 403);
    const key = client_slug ? await readCredential(sb, client_slug, "dialog360", "bsp_key") : null;
    const stub = useStubs() || !key;
    let external_ref: string;
    if (stub) { external_ref = `stub-wamid-${crypto.randomUUID()}`; }
    else {
      const resp = await fetch("https://waba-v2.360dialog.io/messages", { method: "POST", headers: { "D360-API-KEY": key!, "Content-Type": "application/json" }, body: JSON.stringify(template ? { to, type: "template", template } : { to, type: "text", text: { body } }) });
      const j = await resp.json();
      external_ref = j?.messages?.[0]?.id ?? `sent-${Date.now()}`;
    }
    let conv = conversation_id;
    if (!conv && entity_id) { const { data: c } = await sb.from("conversations").insert({ entity_id, channel: "whatsapp", status: "open" }).select("id").single(); conv = c?.id; }
    if (conv) { await sb.from("messages").insert({ conversation_id: conv, direction: "outbound", sender: "AA", body }); }
    await audit(sb, "whatsapp_send", "messages", conv, { to, stub, template: !!template, approved });
    return json({ ok: true, stub, external_ref, conversation_id: conv });
  } catch (e) { return json({ error: String(e) }, 500); }
});
