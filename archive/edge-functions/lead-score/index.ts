import { svc, json, cors, useStubs, readCredential, audit, agentEvent } from "../_shared/aa.ts";

type IcpResult = {
  score: number;
  reason: string;
  band: "cold" | "warm" | "hot";
};

class UpstreamModelError extends Error {
  provider: "anthropic" | "openai";
  status: number;
  model: string;

  constructor(provider: "anthropic" | "openai", status: number, model: string) {
    super(`${provider} model call failed with HTTP ${status}`);
    this.provider = provider;
    this.status = status;
    this.model = model;
  }
}

function bandFor(score: number): IcpResult["band"] {
  if (score >= 85) return "hot";
  if (score >= 65) return "warm";
  return "cold";
}

function parseIcpJson(raw: string): IcpResult {
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("{") ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!jsonText) throw new Error("model response did not contain JSON");

  const parsed = JSON.parse(jsonText);
  const score = Number(parsed.score);
  if (!Number.isFinite(score)) throw new Error("model response score was not numeric");

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = parsed.band === "cold" || parsed.band === "warm" || parsed.band === "hot"
    ? parsed.band
    : bandFor(clamped);

  return {
    score: clamped,
    reason: String(parsed.reason ?? ""),
    band,
  };
}

function icpPrompt(ent: Record<string, unknown>) {
  return JSON.stringify({
    business_name: ent.business_name,
    niche: ent.niche,
    city: ent.city,
    signals: ent.notes_signals ?? {},
  });
}

async function scoreWithAnthropic(key: string, model: string, ent: Record<string, unknown>): Promise<IcpResult> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 120,
      temperature: 0,
      system:
        'You are AA ICP scoring. Return strict JSON only: {"score":0-100,"reason":"short reason","band":"cold|warm|hot"}. Score owner-operated Cape Town trade businesses highest.',
      messages: [{ role: "user", content: icpPrompt(ent) }],
    }),
  });

  if (!resp.ok) throw new UpstreamModelError("anthropic", resp.status, model);

  const body = await resp.json();
  const raw = body?.content?.map((block: { text?: string }) => block.text ?? "").join("") ?? "";
  return parseIcpJson(raw);
}

async function scoreWithOpenAI(key: string, model: string, ent: Record<string, unknown>): Promise<IcpResult> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 120,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            'You are AA ICP scoring. Return strict JSON only: {"score":0-100,"reason":"short reason","band":"cold|warm|hot"}. Score owner-operated Cape Town trade businesses highest.',
        },
        { role: "user", content: icpPrompt(ent) },
      ],
    }),
  });

  if (!resp.ok) throw new UpstreamModelError("openai", resp.status, model);

  const body = await resp.json();
  const raw = body?.choices?.[0]?.message?.content ?? "";
  return parseIcpJson(raw);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const sb = svc();
    const { entity_id } = await req.json();
    if (!entity_id) return json({ error: "entity_id required" }, 400);

    const { data: ent, error } = await sb.from("entities").select("*").eq("id", entity_id).single();
    if (error || !ent) return json({ error: "entity not found" }, 404);

    let result: IcpResult;
    let method: string;

    if (useStubs()) {
      const { data: s } = await sb.rpc("compute_icp_score", {
        p_niche: ent.niche,
        p_city: ent.city,
        p_signals: ent.notes_signals ?? {},
      });
      const score = Math.max(0, Math.min(100, Math.round(Number(s))));
      result = { score, reason: "stub:compute_icp_score", band: bandFor(score) };
      method = "stub:compute_icp_score";
    } else {
      const model = Deno.env.get("AA_ICP_MODEL") ?? "claude-haiku-4-5-20251001";
      if (model.startsWith("claude-")) {
        const key = await readCredential(sb, "_global", "anthropic", "api_key");
        if (!key) return json({ ok: false, error: "missing_credential", provider: "anthropic" }, 500);
        result = await scoreWithAnthropic(key, model, ent);
        method = `prod:anthropic:${model}`;
      } else {
        const key = await readCredential(sb, "_global", "openai", "api_key");
        if (!key) return json({ ok: false, error: "missing_credential", provider: "openai" }, 500);
        result = await scoreWithOpenAI(key, model, ent);
        method = `prod:openai:${model}`;
      }
    }

    const threshold = 65;
    const advance = result.score >= threshold && ent.stage === "source";
    const patch: Record<string, unknown> = { icp_fit_score: result.score };
    if (advance) patch.stage = "cold";

    await sb.from("entities").update(patch).eq("id", entity_id);
    if (advance) {
      await sb.from("triage_items").insert({
        entity_id,
        source: "agent",
        priority: result.score >= 85 ? "high" : "normal",
        status: "open",
        title: `New qualified lead: ${ent.business_name}`,
        detail: `ICP ${result.score} cleared ${threshold} via ${method}. In cold queue (SOP 01).`,
      });
    }

    await agentEvent(sb, entity_id, "lead-score", "icp_scored", {
      score: result.score,
      band: result.band,
      reason: result.reason,
      method,
      threshold,
    });
    await audit(sb, "lead_score", "entities", entity_id, { score: result.score, method });

    return json({
      ok: true,
      entity_id,
      score: result.score,
      band: result.band,
      reason: result.reason,
      method,
      advanced: advance,
      stub: method.startsWith("stub:"),
    });
  } catch (e) {
    if (e instanceof UpstreamModelError) {
      return json({
        ok: false,
        error: "upstream_model_error",
        provider: e.provider,
        status: e.status,
        model: e.model,
      }, 502);
    }

    return json({ ok: false, error: String(e) }, 500);
  }
});
