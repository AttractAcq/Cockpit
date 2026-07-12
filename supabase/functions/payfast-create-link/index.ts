// payfast-create-link · INVOKE · verify_jwt=TRUE
// Called by AA (operator/cockpit), NOT by PayFast. Given { entity_id, tier },
// derives the deposit amount SERVER-SIDE (never trusts a client-supplied amount),
// builds a signed PayFast payment request with entity_id embedded in m_payment_id
// (and custom_str1 as backup, custom_str2 = tier), and returns the redirect URL.
// This makes the ITN -> entity mapping correct BY CONSTRUCTION.
//
// The remaining manual gap is only wherever AA *triggers* this function (a Cockpit
// action / form) — that is a Stage 3 wiring item (see docs/payfast-itn-spec.md).

import { svc, json, cors, audit, agentEvent } from "../_shared/aa.ts";
import {
  readPayfast, buildPaymentRedirectUrl, TIER_DEPOSIT_CENTS, centsToRandString,
} from "../_shared/payfast.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const { entity_id, tier } = await req.json() as { entity_id?: string; tier?: string };

    if (!entity_id) return json({ error: "entity_id required" }, 400);
    if (!tier) return json({ error: "tier required" }, 400);

    // Server-side amount — DO NOT trust any client-supplied amount.
    const amountCents = TIER_DEPOSIT_CENTS[tier];
    if (!amountCents) {
      return json({ error: `unknown tier: ${tier}`, known: Object.keys(TIER_DEPOSIT_CENTS) }, 400);
    }

    // Entity must exist and be at the booked gate (deposit advances booked -> onboarding).
    const { data: ent, error: entErr } = await sb
      .from("entities")
      .select("id, business_name, contact_name, contact_email, stage")
      .eq("id", entity_id)
      .single();
    if (entErr || !ent) return json({ error: "entity not found" }, 404);
    if (ent.stage !== "booked") {
      return json({ error: "entity not at booked gate", stage: ent.stage }, 409);
    }

    const merchantId = await readPayfast(sb, "merchant_id");
    const merchantKey = await readPayfast(sb, "merchant_key");
    const passphrase = await readPayfast(sb, "passphrase"); // may be null -> no-passphrase path
    if (!merchantId || !merchantKey) {
      await agentEvent(sb, entity_id, "payfast", "create_link_misconfigured",
        { has_merchant_id: !!merchantId, has_merchant_key: !!merchantKey }, "error");
      return json({ error: "PayFast merchant credentials not configured in vault" }, 503);
    }

    const sandbox = (Deno.env.get("AA_PAYFAST_SANDBOX") ?? "true") !== "false";
    const base = Deno.env.get("AA_PUBLIC_BASE_URL") ?? "";
    const notifyUrl = Deno.env.get("AA_PAYFAST_NOTIFY_URL")
      ?? `${SUPABASE_FUNCTIONS_BASE()}/payfast-webhook`;

    // Build the outbound request. entity_id rides in m_payment_id (primary) and
    // custom_str1 (backup); tier in custom_str2 so the webhook can re-derive the
    // expected amount. The first/last name split is best-effort from business_name.
    const data: Record<string, string> = {
      merchant_id: merchantId,
      merchant_key: merchantKey,
      ...(base ? { return_url: `${base}/money?deposit=success`, cancel_url: `${base}/money?deposit=cancelled` } : {}),
      notify_url: notifyUrl,
      ...(ent.contact_email ? { email_address: ent.contact_email } : {}),
      m_payment_id: entity_id,
      amount: centsToRandString(amountCents),
      item_name: `AA deposit — ${tier}`,
      item_description: `Deposit for ${ent.business_name ?? entity_id}`,
      custom_str1: entity_id,
      custom_str2: tier,
      currency: "ZAR",
    };

    const redirectUrl = buildPaymentRedirectUrl(data, passphrase, sandbox);

    await agentEvent(sb, entity_id, "payfast", "create_link", { tier, amount_cents: amountCents, sandbox });
    await audit(sb, "payfast_create_link", "entities", entity_id, { tier, amount_cents: amountCents, sandbox });

    return json({ ok: true, entity_id, tier, amount_cents: amountCents, redirect_url: redirectUrl });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

/** Default notify_url base from the function's own origin (SUPABASE_URL/functions/v1). */
function SUPABASE_FUNCTIONS_BASE(): string {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  return url ? `${url}/functions/v1` : "";
}
