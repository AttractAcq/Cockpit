// payfast-webhook · WEBHOOK · verify_jwt=FALSE
// Inbound PayFast ITN (Instant Transaction Notification). PayFast cannot present
// a Supabase JWT — this is the one correct exception to verify_jwt=true. Safety
// comes entirely from this function's own checks, in order:
//   signature -> source IP -> server postback -> amount -> merchant -> status
//   -> entity mapping (untrusted) -> idempotency -> record payment -> advance.
// See docs/payfast-itn-spec.md for the verified flow (MD5, NOT HMAC-SHA1).
//
// Status convention (spec §6.5):
//   - permanent rejections (forged/mismatched/unmappable/non-COMPLETE): log + 200
//     (PayFast retrying cannot fix them; we acknowledge receipt and take no action)
//   - transient failures (postback fetch error, DB write fail, advance fail): 5xx
//     so PayFast RETRIES — never leave a COMPLETE payment with an un-advanced entity.

import { svc, json, audit, agentEvent } from "../_shared/aa.ts";
import {
  readPayfast, pfValidSignature, pfValidSourceIP, pfServerValidate,
  pfAmountsEqual, TIER_DEPOSIT_CENTS, recordPayment,
} from "../_shared/payfast.ts";

const ADVANCED_STAGES = ["onboarding", "active", "delivering"];

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const sb = svc();
  const raw = await req.text();
  const params = new URLSearchParams(raw);
  const f = (k: string) => params.get(k) ?? "";

  const pfPaymentId = f("pf_payment_id");
  const entityId = f("m_payment_id") || f("custom_str1");
  const tier = f("custom_str2");

  // log + acknowledge a permanent rejection (no retry value)
  const reject = async (reason: string, extra: Record<string, unknown> = {}) => {
    await agentEvent(sb, entityId || null, "payfast", "itn_rejected", { reason, pf_payment_id: pfPaymentId, ...extra }, "error");
    await audit(sb, "payfast_itn_rejected", "payments", null, { reason, pf_payment_id: pfPaymentId, ...extra });
    return json({ ok: false, reason }, 200);
  };
  // transient failure -> 5xx so PayFast retries
  const transient = async (reason: string, extra: Record<string, unknown> = {}) => {
    await agentEvent(sb, entityId || null, "payfast", "itn_transient_error", { reason, pf_payment_id: pfPaymentId, ...extra }, "error");
    await audit(sb, "payfast_itn_transient", "payments", null, { reason, pf_payment_id: pfPaymentId, ...extra });
    return json({ ok: false, reason }, 503);
  };

  try {
    const passphrase = await readPayfast(sb, "passphrase");   // null -> no-passphrase path
    const ourMerchant = await readPayfast(sb, "merchant_id");
    const sandbox = (Deno.env.get("AA_PAYFAST_SANDBOX") ?? "true") !== "false";

    // 1. Signature (MD5, received order)
    if (!pfValidSignature(params, passphrase)) return reject("bad_signature");

    // 2. Source IP — null = unverifiable in this runtime (rely on postback), false = reject
    const ipOk = await pfValidSourceIP(req);
    if (ipOk === false) return reject("bad_source_ip");
    if (ipOk === null) {
      await agentEvent(sb, entityId || null, "payfast", "itn_source_ip_unverifiable", { pf_payment_id: pfPaymentId }, "processed");
    }

    // 3. Server postback (the hard gate). Network failure = transient -> retry.
    let serverValid: boolean;
    try {
      serverValid = await pfServerValidate(raw, sandbox);
    } catch (e) {
      return transient("postback_connect_failed", { detail: String(e) });
    }
    if (!serverValid) return reject("failed_server_validation");

    // 4. Amount — recompute expected server-side from tier; never trust amount_gross blindly
    const expectedCents = TIER_DEPOSIT_CENTS[tier];
    if (!expectedCents) return reject("unknown_tier", { tier });
    const amountGross = Number(f("amount_gross"));
    if (!pfAmountsEqual(amountGross, expectedCents / 100)) {
      return reject("amount_mismatch", { amount_gross: f("amount_gross"), expected_rand: (expectedCents / 100).toFixed(2) });
    }

    // 5. Merchant id match
    if (!ourMerchant || f("merchant_id") !== ourMerchant) return reject("merchant_mismatch", { posted: f("merchant_id") });

    // 6. Payment status — only COMPLETE advances the gate
    if (f("payment_status") !== "COMPLETE") {
      await agentEvent(sb, entityId || null, "payfast", "itn_non_complete", { payment_status: f("payment_status"), pf_payment_id: pfPaymentId });
      return json({ ok: true, ignored: f("payment_status") }, 200);
    }

    // 7. Entity mapping is UNTRUSTED input — must resolve to a real entity
    if (!entityId) return reject("unmappable_entity", { detail: "no m_payment_id/custom_str1" });
    const { data: ent, error: entErr } = await sb
      .from("entities").select("id, stage").eq("id", entityId).maybeSingle();
    if (entErr) return transient("entity_lookup_failed", { detail: entErr.message });
    if (!ent) return reject("unmappable_entity", { detail: "entity_id does not resolve", entity_id: entityId });

    // 8. Idempotency by ACTUAL STATE (not a flag): if already advanced, we're done.
    if (ADVANCED_STAGES.includes(ent.stage)) {
      const { data: existing } = await sb.from("payments").select("id").eq("external_ref", pfPaymentId).maybeSingle();
      if (!existing) {
        // advanced but payment unrecorded (rare) — record for completeness, don't re-advance
        await recordPayment(sb, { entity_id: entityId, amount_cents: expectedCents, tier, external_ref: pfPaymentId, status: "complete" });
      }
      return json({ ok: true, deduped: true, stage: ent.stage }, 200);
    }
    // Only 'booked' may proceed to advance (deposit gate guards booked -> onboarding)
    if (ent.stage !== "booked") return reject("unexpected_stage", { stage: ent.stage });

    // 9. Record the COMPLETE payment FIRST (skip if a prior attempt already did).
    const { data: prior } = await sb.from("payments").select("id").eq("external_ref", pfPaymentId).maybeSingle();
    if (!prior) {
      const rec = await recordPayment(sb, { entity_id: entityId, amount_cents: expectedCents, tier, external_ref: pfPaymentId, status: "complete" });
      if (rec.error) return transient("payment_write_failed", { detail: rec.error });
    }

    // 10. Advance via the existing onboarding function (skip_payment — already recorded).
    //     audit-log + n8n fire inside onboarding. We do NOT raw-write entities.stage.
    await sb.functions.invoke("onboarding", {
      body: { entity_id: entityId, amount_cents: expectedCents, tier, skip_payment: true },
    });

    // 11. Verify the actual outcome — don't trust the invoke result, check the stage.
    //     If still 'booked', the advance failed: FAIL LOUD (5xx) so PayFast retries.
    //     A retry finds the payment already recorded (step 9) and re-runs the advance.
    const { data: after } = await sb.from("entities").select("stage").eq("id", entityId).maybeSingle();
    if (!after || !ADVANCED_STAGES.includes(after.stage)) {
      return transient("advance_failed", { stage: after?.stage ?? "unknown" });
    }

    await agentEvent(sb, entityId, "payfast", "itn_processed", { pf_payment_id: pfPaymentId, tier, amount_cents: expectedCents, stage: after.stage });
    await audit(sb, "payfast_itn_processed", "payments", null, { pf_payment_id: pfPaymentId, entity_id: entityId, tier });
    return json({ ok: true, entity_id: entityId, stage: after.stage }, 200);
  } catch (e) {
    // Unknown error — treat as transient so PayFast retries rather than dropping a real payment.
    return transient("unhandled_error", { detail: String(e) });
  }
});
