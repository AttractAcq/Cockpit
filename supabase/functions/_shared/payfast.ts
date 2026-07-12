// _shared/payfast.ts
// PayFast integration primitives, shared by payfast-create-link (outbound) and
// payfast-webhook (inbound ITN). All logic mirrors PayFast's official library
// (Payfast/payfast-common PaymentRequest.php and Payfast/payfast-php-sdk Auth.php).
// See docs/payfast-itn-spec.md for the verbatim sources and the OUTBOUND vs ITN
// signature differences. Structured so a future Subscription/tokenization charge
// (Stage 1.4 retainer) reuses the same signing/validation + recordPayment path.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { readCredential } from "./aa.ts";

// ---------------------------------------------------------------------------
// Encoding + hashing
// ---------------------------------------------------------------------------

/**
 * Faithful re-implementation of PHP urlencode():
 *   - space -> '+'
 *   - alphanumerics and - _ . left as-is
 *   - everything else -> uppercase %XX
 * encodeURIComponent leaves !'()*~ unescaped and encodes space as %20, so we
 * fix those up to match PHP exactly. Mismatch here = signature mismatch.
 */
export function phpUrlencode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Lowercase hex MD5 (PHP md5() default). */
export function md5Hex(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Vault access
// ---------------------------------------------------------------------------

export type PayfastCredential = "passphrase" | "merchant_id" | "merchant_key";

/**
 * Reads a platform PayFast credential from the Vault via the service role.
 * vaultName("_global","payfast","passphrase") => "_GLOBAL_PAYFAST_PASSPHRASE".
 * Returns null if not set (callers must handle the no-passphrase path).
 */
export function readPayfast(sb: SupabaseClient, credential: PayfastCredential): Promise<string | null> {
  return readCredential(sb, "_global", "payfast", credential);
}

// ---------------------------------------------------------------------------
// Hosts / mode
// ---------------------------------------------------------------------------

/** PayFast process host by mode (outbound /eng/process and ITN postback /eng/query/validate). */
export function pfHost(sandbox: boolean): string {
  return sandbox ? "sandbox.payfast.co.za" : "www.payfast.co.za";
}

/** Source-validation host allow-list (payfast-common pfValidIP $validHosts). */
const PF_VALID_HOSTS = [
  "www.payfast.co.za",
  "sandbox.payfast.co.za",
  "w1w.payfast.co.za",
  "w2w.payfast.co.za",
];

// ---------------------------------------------------------------------------
// INBOUND — ITN validation (payfast-common PaymentRequest.php)
// ---------------------------------------------------------------------------

/**
 * Build the ITN signature param string: fields in the order RECEIVED, skipping
 * signature/option/Itemid, each value urlencoded (NO trim). Passphrase, if set,
 * appended as &passphrase=urlencode(passphrase). md5() of the result.
 * NOTE: received-order + no-trim — deliberately different from the outbound signer.
 */
export function pfItnSignature(params: URLSearchParams, passphrase: string | null): string {
  const skip = new Set(["signature", "option", "Itemid"]);
  const parts: string[] = [];
  for (const [key, val] of params) {
    if (!skip.has(key)) parts.push(`${key}=${phpUrlencode(val)}`);
  }
  let paramString = parts.join("&");
  if (passphrase) paramString += `&passphrase=${phpUrlencode(passphrase)}`;
  return md5Hex(paramString);
}

/** Constant-ish compare of the posted signature against the computed one. */
export function pfValidSignature(params: URLSearchParams, passphrase: string | null): boolean {
  const posted = params.get("signature") ?? "";
  const expected = pfItnSignature(params, passphrase);
  return posted.length === expected.length && posted.toLowerCase() === expected;
}

/**
 * Source-IP check. In a serverless runtime there is no socket peer IP, so we use
 * the client-most x-forwarded-for entry and compare against the DNS-resolved IPs
 * of the PayFast hosts. If DNS resolution is unavailable in the runtime we cannot
 * verify and return null ("unverifiable") — the caller then relies on the server
 * postback (pfServerValidate) as the hard gate, per docs/payfast-itn-spec.md §6.4.
 *   - true  = IP is a known PayFast IP
 *   - false = resolved fine but IP is NOT PayFast (reject)
 *   - null  = could not resolve (treat as unverifiable, don't hard-reject on this alone)
 */
export async function pfValidSourceIP(req: Request): Promise<boolean | null> {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const sourceIp = xff.split(",")[0]?.trim();
  if (!sourceIp) return null;

  const validIps = new Set<string>();
  let resolvedAny = false;
  for (const host of PF_VALID_HOSTS) {
    try {
      const ips = await Deno.resolveDns(host, "A");
      for (const ip of ips) validIps.add(ip);
      resolvedAny = true;
    } catch {
      // DNS lookup not permitted / failed for this host — skip it.
    }
  }
  if (!resolvedAny) return null;
  return validIps.has(sourceIp);
}

/**
 * Server-side validation postback (pfValidData): POST the same param string back
 * to https://{host}/eng/query/validate; VALID = first response line trimmed,
 * case-insensitive. This is the authoritative "came from PayFast and intact" gate.
 */
export async function pfServerValidate(rawBody: string, sandbox: boolean): Promise<boolean> {
  const url = `https://${pfHost(sandbox)}/eng/query/validate`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: rawBody,
  });
  const text = await resp.text();
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  return firstLine.toUpperCase() === "VALID";
}

/** Float-safe amount comparison (pfAmountsEqual; PF_EPSILON = 0.01). */
export function pfAmountsEqual(amount1: number, amount2: number, epsilon = 0.01): boolean {
  return Math.abs(amount1 - amount2) <= epsilon;
}

// ---------------------------------------------------------------------------
// OUTBOUND — payment-request signature (payfast-php-sdk Auth::generateSignature)
// ---------------------------------------------------------------------------

/**
 * Canonical field order for the OUTBOUND payment-request signature. The string is
 * built in THIS order (only fields actually present + non-empty), each value
 * urlencode(trim(value)), then passphrase=urlencode(trim(passphrase)) appended
 * LAST, then md5(). This differs from the ITN signer (received order, no trim,
 * passphrase by key position vs appended last) — see docs/payfast-itn-spec.md.
 */
export const PF_OUTBOUND_FIELD_ORDER = [
  "merchant_id", "merchant_key", "return_url", "cancel_url", "notify_url", "notify_method",
  "name_first", "name_last", "email_address", "cell_number",
  "m_payment_id", "amount", "item_name", "item_description",
  "custom_int1", "custom_int2", "custom_int3", "custom_int4", "custom_int5",
  "custom_str1", "custom_str2", "custom_str3", "custom_str4", "custom_str5",
  "email_confirmation", "confirmation_address", "currency", "payment_method",
  "subscription_type", "billing_date", "recurring_amount", "frequency", "cycles",
  "subscription_notify_email", "subscription_notify_webhook", "subscription_notify_buyer",
] as const;

/** Build the ordered "key=value&..." string for an outbound request (no signature). */
export function pfOutboundParamString(data: Record<string, string>, passphrase: string | null): string {
  const parts: string[] = [];
  for (const key of PF_OUTBOUND_FIELD_ORDER) {
    const v = data[key];
    if (v !== undefined && v !== null && String(v).length > 0) {
      parts.push(`${key}=${phpUrlencode(String(v).trim())}`);
    }
  }
  if (passphrase) parts.push(`passphrase=${phpUrlencode(passphrase.trim())}`);
  return parts.join("&");
}

/** md5 of the outbound param string = the request signature. */
export function pfOutboundSignature(data: Record<string, string>, passphrase: string | null): string {
  return md5Hex(pfOutboundParamString(data, passphrase));
}

/**
 * Build the full redirect URL to PayFast's process page, with all fields + the
 * signature, in canonical order. Returns a GET URL the caller can redirect to.
 */
export function buildPaymentRedirectUrl(
  data: Record<string, string>,
  passphrase: string | null,
  sandbox: boolean,
): string {
  const signature = pfOutboundSignature(data, passphrase);
  const qs: string[] = [];
  for (const key of PF_OUTBOUND_FIELD_ORDER) {
    const v = data[key];
    if (v !== undefined && v !== null && String(v).length > 0) {
      qs.push(`${key}=${phpUrlencode(String(v).trim())}`);
    }
  }
  qs.push(`signature=${signature}`);
  return `https://${pfHost(sandbox)}/eng/process?${qs.join("&")}`;
}

// ---------------------------------------------------------------------------
// Deposit pricing (server-side source of truth — DO NOT trust client amounts)
// ---------------------------------------------------------------------------

/**
 * Deposit amount per tier, in cents (ZAR). These mirror the list prices in
 * CLAUDE.md (Offers). ⚠️ CONFIRM WITH ALEX: the actual *deposit* may differ from
 * the full list price. Both the link generator and the webhook amount-check read
 * from here, so they stay consistent by construction.
 */
export const TIER_DEPOSIT_CENTS: Record<string, number> = {
  proof_sprint: 750000,      // R7,500
  proof_brand: 3250000,      // R32,500
  authority_brand: 11500000, // R115,000
};

/** Format integer cents as PayFast's "X.XX" rand string. */
export function centsToRandString(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ---------------------------------------------------------------------------
// payments table write (reused by deposit gate + future retainer charge)
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  entity_id: string;
  amount_cents: number;
  tier: string;
  currency?: string;
  status?: string;
  external_ref?: string | null;
}

/**
 * Inserts a payments row and returns its id. Single write path for both the
 * deposit gate (status "complete", external_ref = pf_payment_id) and any future
 * recurring-retainer charge. Does not advance entity stage — that stays the
 * onboarding function's job (the single audited money-backed transition).
 */
export async function recordPayment(
  sb: SupabaseClient,
  input: RecordPaymentInput,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await sb
    .from("payments")
    .insert({
      entity_id: input.entity_id,
      amount_cents: input.amount_cents,
      tier: input.tier,
      currency: input.currency ?? "ZAR",
      status: input.status ?? "complete",
      external_ref: input.external_ref ?? null,
    })
    .select("id")
    .single();
  if (error) return { id: null, error: error.message };
  return { id: data?.id ?? null, error: null };
}
