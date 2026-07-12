import { svc, json, cors, useStubs, readCredential, audit, agentEvent } from "../_shared/aa.ts";

async function callOpenClaw(key: string, system: string, user: string) {
  const model = Deno.env.get("AA_AICOS_MODEL") ?? "gpt-4.1-mini";
  const resp = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: 0.3, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
  const j = await resp.json();
  return j?.choices?.[0]?.message?.content ?? "";
}

function stubScore(text: string): number {
  const t = (text || "").toLowerCase();
  let s = 0.3;
  if (/\b(price|cost|quote|how much|interested|book|call)\b/.test(t)) s += 0.4;
  if (/\b(when|today|urgent|asap|now)\b/.test(t)) s += 0.2;
  if (/\b(not interested|stop|unsubscribe|no thanks)\b/.test(t)) s = 0.05;
  return Math.min(s, 1);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const { command, entity_id = null, message = "", context = {} } = await req.json();
    if (!command) return json({ error: "command required" }, 400);

    const key = await readCredential(sb, "_global", "openai", "api_key");
    const stub = useStubs() || !key;
    let result: Record<string, unknown> = {};

    if (command === "score_reply") {
      let score: number, reply: string;
      if (stub) {
        score = stubScore(message);
        reply = score < 0.1 ? "(no reply suggested — lead opted out)" : "Thanks for getting back to us! Are you free for a quick 10-min call this week to walk through it?";
      } else {
        const raw = await callOpenClaw(key, "You are OpenClaw, AA's lead-intelligence agent. Score the inbound 0..1 (1=hot) and draft a short reply. Return JSON {score, reply}.", message);
        try { const p = JSON.parse(raw); score = Number(p.score); reply = String(p.reply); } catch { score = stubScore(message); reply = raw.slice(0, 280); }
      }
      const band = score >= 0.7 ? "hot" : score >= 0.4 ? "warm" : "cold";
      const { data: ti } = await sb.from("triage_items").insert({ entity_id, source: "agent", priority: band === "hot" ? "high" : "normal", status: "open", title: `Inbound scored ${band} (${score.toFixed(2)})`, detail: `Suggested reply (draft, needs approval): ${reply}` }).select("id").single();
      result = { score, band, suggested_reply: reply, triage_item_id: ti?.id, auto_sent: false };
    } else if (command === "draft_mjr") {
      const copy = stub ? `Missed Jobs Report (draft) for ${context.business_name ?? "this business"}: based on local search demand, an estimated 12–18 qualified jobs/month are going to competitors. [stub copy — pending model]` : await callOpenClaw(key, "You are AA's MJR writer. Draft persuasive but factual Missed Jobs Report copy. Sell the problem, not the product.", JSON.stringify(context));
      result = { mjr_draft: copy, auto_sent: false };
    } else {
      return json({ error: `unknown command: ${command}` }, 400);
    }

    await agentEvent(sb, entity_id, "openclaw", command, { stub, ...result });
    await audit(sb, `aicos_${command}`, "triage_items", entity_id, { stub });
    return json({ ok: true, command, stub, ...result });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
