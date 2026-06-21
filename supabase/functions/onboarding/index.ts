import { svc, json, cors, agentEvent, audit } from "../_shared/aa.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const sb = svc();
    const { entity_id, amount_cents, tier = "proof_brand" } = await req.json() as {
      entity_id: string;
      amount_cents: number;
      tier?: string;
    };

    if (!entity_id) return json({ error: "entity_id required" }, 400);
    if (!amount_cents || amount_cents < 1) return json({ error: "amount_cents required and must be > 0" }, 400);

    // 1. Fetch entity — need business_name + contact fields for n8n payload
    const { data: ent, error: entErr } = await sb
      .from("entities")
      .select("id, business_name, contact_name, contact_phone, stage")
      .eq("id", entity_id)
      .single();
    if (entErr || !ent) return json({ error: "entity not found" }, 404);

    if (["onboarding", "active", "delivering"].includes(ent.stage)) {
      return json({ error: "entity already past onboarding gate", stage: ent.stage }, 409);
    }

    // 2. Record deposit payment
    const { error: payErr } = await sb.from("payments").insert({
      entity_id,
      amount_cents,
      currency: "ZAR",
      tier,
      status: "pending",
    });
    if (payErr) return json({ error: "failed to record payment", detail: payErr.message }, 500);

    // 3. Advance entity stage to onboarding
    const { error: stageErr } = await sb
      .from("entities")
      .update({ stage: "onboarding" })
      .eq("id", entity_id);
    if (stageErr) return json({ error: "failed to advance stage", detail: stageErr.message }, 500);

    // 4. Fire n8n onboarding webhook
    // AA_N8N_ONBOARDING_WEBHOOK must be set as a Supabase Edge Function secret:
    // Supabase Dashboard → Settings → Edge Functions → Add new secret
    // Name: AA_N8N_ONBOARDING_WEBHOOK
    // Value: https://primary-production-2335e.up.railway.app/webhook/aa-onboarding
    const webhookUrl = Deno.env.get("AA_N8N_ONBOARDING_WEBHOOK");
    if (!webhookUrl) {
      await agentEvent(sb, entity_id, "onboarding", "n8n_webhook_missing", { tier }, "error");
      // Entity is already advanced — return 207 so the UI knows stage changed but n8n wasn't fired
      return json({
        ok: false,
        entity_id,
        stage: "onboarding",
        error: "AA_N8N_ONBOARDING_WEBHOOK not configured — entity advanced but n8n not triggered",
      }, 207);
    }

    const n8nResp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entity_id,
        business_name: ent.business_name,
        contact_name: ent.contact_name ?? "",
        contact_phone: ent.contact_phone ?? "",
        amount_cents,
        tier,
      }),
    });

    const n8nBody = await n8nResp.json().catch(() => ({})) as Record<string, unknown>;

    // 5. Audit + event log regardless of n8n outcome
    await agentEvent(sb, entity_id, "onboarding", "onboarding_started", {
      amount_cents,
      tier,
      n8n_ok: n8nResp.ok,
      n8n_status: n8nResp.status,
      n8n_body: n8nBody,
    });
    await audit(sb, "onboarding_start", "entities", entity_id, { amount_cents, tier });

    if (!n8nResp.ok) {
      return json({
        ok: false,
        entity_id,
        stage: "onboarding",
        warning: "entity advanced but n8n webhook returned an error",
        n8n_status: n8nResp.status,
        n8n_body: n8nBody,
      }, 207);
    }

    return json({ ok: true, entity_id, stage: "onboarding", n8n_response: n8nBody });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
