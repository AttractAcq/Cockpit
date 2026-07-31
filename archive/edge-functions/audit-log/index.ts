import { svc, json, cors, audit, agentEvent } from "../_shared/aa.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const body = await req.json().catch(() => ({}));
    const {
      action,
      table_name = null,
      record_id = null,
      metadata = {},
      agent = null,
      entity_id = null,
      event_type = null,
    } = body;

    if (!action) return json({ error: "action is required" }, 400);

    await audit(sb, action, table_name, record_id, metadata);
    if (agent && event_type) {
      await agentEvent(sb, entity_id, agent, event_type, metadata);
    }
    return json({ ok: true, logged: action });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
