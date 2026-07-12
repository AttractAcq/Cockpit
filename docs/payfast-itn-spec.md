# PayFast ITN Validation Spec (confirmed from official sources)

**Status:** Research artefact for the P0 deposit gate (`booked → onboarding`). No code built yet.
**Date:** 2026-06-21
**Why this exists:** `docs/reconciliation-report.md` §8.1 / §P0 says the ITN handler needs **"HMAC-SHA1"**. That is **WRONG**. The official PayFast library uses **MD5**. This file is the corrected, citation-backed source of truth; the implementation must follow this, not the reconciliation report.

## Sources (official only)

- **`Payfast/payfast-common` → `src/Aggregator/Request/PaymentRequest.php`** — the canonical validation library that every official PayFast plugin depends on. Fetched verbatim via `gh api` on 2026-06-21. This is the authority for signature, IP, postback, and amount logic.
- **`Payfast/whmcs-aggregation` → `modules/gateways/callback/payfast.php`** — official reference callback; authority for the **order** of checks. Fetched verbatim.
- **`Payfast/payfast-php-sdk`** (`lib/PaymentIntegrations/Notification.php`) — same `pfValidSignature` implementation (confirmed present via `gh search code`).
- developers.payfast.co.za/docs and support.payfast.help — corroborating prose (signature is MD5, lowercase hex, variables in the order received; security checks = signature + source IP + amount + server postback).

---

## 1. Signature mechanism — MD5 (NOT HMAC-SHA1)

Verbatim from `PaymentRequest::pfValidSignature()`:

```php
foreach ($pfData as $key => $val) {
    if ($key != 'signature' && $key != 'option' && $key != 'Itemid') {
        $pfParamString .= $key . '=' . urlencode($val) . '&';
    }
}
$pfParamString = substr($pfParamString, 0, -1);

if (!empty($pfPassphrase)) {
    $pfParamStringWithPassphrase = $pfParamString . "&passphrase=" . urlencode($pfPassphrase);
    $signature = md5($pfParamStringWithPassphrase);
} else {
    $signature = md5($pfParamString);
}
$result = ($pfData['signature'] == $signature);
```

Confirmed rules:
- **Algorithm: `md5()`** of the parameter string. Hex digest, **lowercase** (PHP `md5()` default; docs explicitly warn the hash must be lowercase).
- **Parameter order: the order the fields arrive in the POST body** — NOT alphabetical. (The ITN-validation path iterates `$_POST` as received. Note: this is the opposite of the *API* signature `generateApiSignature()`, which `ksort()`s — do not confuse the two.)
- **Skip keys:** `signature`, `option`, `Itemid`.
- **Encoding: PHP `urlencode()`** on each value. This is the load-bearing gotcha for a non-PHP runtime (see §6): PHP `urlencode` encodes space as `+`, uppercase `%`-hex, and encodes `~` as `%7E`. JS `encodeURIComponent` differs (space → `%20`, leaves `!~*'()` unescaped). A faithful re-implementation is required or signatures will mismatch.
- **Passphrase** ("Salt Passphrase" in the merchant Account Information tab) is appended as `&passphrase=urlencode(passphrase)` **only if set**. If the account has a passphrase, omitting it → mismatch; if it has none, appending one → mismatch. Must match the account exactly.

## 2. Source validation — valid hosts / IP allow-list

Verbatim from `PaymentRequest::pfValidIP()`:

```php
$validHosts = array(
    'www.payfast.co.za',
    'sandbox.payfast.co.za',
    'w1w.payfast.co.za',
    'w2w.payfast.co.za',
);
$validIps = array();
foreach ($validHosts as $pfHostname) {
    $ips = gethostbynamel($pfHostname);
    if ($ips !== false) { $validIps = array_merge($validIps, $ips); }
}
$validIps = array_unique($validIps);
return in_array($sourceIP, $validIps);
```

Confirmed rules:
- Resolve those **four hostnames** to IPs at request time (DNS), and confirm the POST's source IP is in the resolved set.
- The host list is the authority; IPs are derived by DNS, not hardcoded.

## 3. Amount-match check

Verbatim from `PaymentRequest::pfAmountsEqual()` (and `PF_EPSILON = 0.01`):

```php
public const PF_EPSILON = 0.01;
public function pfAmountsEqual(float $amount1, float $amount2): bool {
    return !(abs(floatval($amount1) - floatval($amount2)) > self::PF_EPSILON);
}
```

Confirmed rule: compare **`amount_gross`** (from the ITN) against the **expected deposit** with an epsilon of **0.01** (float-safe). PayFast amounts are in **rand with 2 decimals** (e.g. `7500.00`), so convert to/from our integer `amount_cents` carefully.

## 4. Server-side validation postback

Verbatim from `PaymentRequest::pfValidData()`:

```php
$url = 'https://' . $pfHost . '/eng/query/validate';
// POST the raw $pfParamString (form-urlencoded) to that URL, then:
$lines = explode("\n", $response);
$verifyResult = trim($lines[0]);
return (strcasecmp($verifyResult, 'VALID') == 0);
```

Confirmed rules:
- POST the **same parameter string** (form-urlencoded body) back to **`https://{pfHost}/eng/query/validate`**.
- **`$pfHost`** is chosen by mode (from the WHMCS callback): **`www.payfast.co.za`** (live) or **`sandbox.payfast.co.za`** (sandbox/test_mode).
- **VALID** = the **first line** of the response, trimmed, equals `VALID` (case-insensitive).
- This is the authoritative "did this really come from PayFast and is it intact" check, complementary to the signature + IP checks. Always perform it.

## 5. Expected ITN POST fields

Confirmed field names read by the official callbacks / documented in the ITN page:

| Field | Meaning / use |
|---|---|
| `m_payment_id` | **Our** reference, set when we create the payment. We pass `entity_id` (or a deposit ref) here so the ITN maps back to the entity. |
| `pf_payment_id` | **PayFast's** unique payment id → store as `payments.external_ref`. |
| `payment_status` | Success value is **`COMPLETE`**. (`pfData['payment_status']`.) Other states e.g. pending/failed exist; only `COMPLETE` advances the gate. |
| `item_name` | Item label (WHMCS parses the invoice id out of it). |
| `item_description` | Optional description. |
| `amount_gross` | Total paid → the amount-match check (§3). |
| `amount_fee` | PayFast fee. |
| `amount_net` | Net to merchant. |
| `merchant_id` | Verify it equals **our** merchant id (`PF_ERR_MERCHANT_ID_MISMATCH` in the lib). |
| `signature` | The MD5 to validate (§1); excluded from the string being hashed. |
| `name_first`, `name_last`, `email_address` | Buyer details (optional). |
| `custom_str1..5`, `custom_int1..5` | Free fields; usable to carry `entity_id`/`tier` if preferred over `m_payment_id`. |
| `token` | Present for **subscriptions/tokenization** — the handle a future recurring-retainer charge uses (Subscription API). |

## 6. Implementation notes for Deno/TypeScript (Supabase edge function)

1. **Read the raw body, not parsed JSON.** The ITN is `application/x-www-form-urlencoded`. Parse with `URLSearchParams` BUT preserve insertion order for the signature string (URLSearchParams preserves order). Build the signature string by iterating entries in received order, skipping `signature`/`option`/`Itemid`.
2. **Faithful `urlencode`.** Implement PHP `urlencode` exactly:
   ```ts
   const phpUrlencode = (s: string) =>
     encodeURIComponent(s)
       .replace(/%20/g, "+")
       .replace(/[!'()*~]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
   ```
   (Covers space→`+` and the `!'()*~` chars that `encodeURIComponent` leaves alone but PHP escapes. Verify against a known-good sandbox ITN before trusting it.)
3. **MD5 in Deno.** No built-in MD5 in Web Crypto. Use `crypto` from `jsr:@std/crypto` / `node:crypto` `createHash("md5")` available in Supabase's Deno runtime. Confirm the exact import at build time.
4. **Source IP in a serverless runtime.** There is no raw socket peer IP; the caller IP arrives in `x-forwarded-for`. Resolve the four §2 hostnames via DNS (`Deno.resolveDns(host, "A")`) and check the **client-most** `x-forwarded-for` entry against the set. If DNS/host checks are unreliable behind the platform proxy, the **server postback (§4) is the hard gate** and must never be skipped.
5. **Return 200 to acknowledge.** PayFast retries the ITN until it receives a `200`. Return `200` for processed-and-accepted AND for permanent rejections (bad signature / merchant mismatch — retrying won't help). Return non-2xx only for **transient** failures (e.g. postback couldn't connect) so PayFast retries. Always log rejections.
6. **Idempotency.** PayFast may deliver the same ITN more than once. De-dupe on `pf_payment_id` (`payments.external_ref`) before advancing the stage.

---

*Validation order for our handler (per runbook, stricter than the WHMCS reference which is signature → postback): **signature (§1) → source/host (§2) → server postback (§4) → amount match (§3)**, then `merchant_id` match and `payment_status == COMPLETE`, then `unmappable_entity` check, then idempotency check, then advance. Reject + log on any failure.*

---

## 7. OUTBOUND payment-request signature (DIFFERENT from the ITN signature)

Source: `Payfast/payfast-php-sdk` → `lib/Auth.php` `generateSignature()` (fetched verbatim 2026-06-21). Used by `payfast-create-link` to build the payment request AA sends a buyer to.

**It is NOT the same algorithm as the ITN signature.** Differences that will silently break signing if ignored:

| | ITN signature (§1, `pfValidSignature`) | OUTBOUND signature (`Auth::generateSignature`) |
|---|---|---|
| Field order | **order received** in the POST | **fixed canonical field order** (the `$fields` list) |
| Value encoding | `urlencode(val)` — **no trim** | `urlencode(trim(val))` — **trimmed** |
| Empty fields | included as received | **omitted** if empty |
| `merchant_key` | not present in an ITN | **included** in the signed string |
| Passphrase | appended `&passphrase=urlencode(val)` | appended LAST `passphrase=urlencode(trim(val))` |
| Hash | `md5()`, lowercase hex | `md5()`, lowercase hex |

**Canonical outbound field order** (only fields present + non-empty are emitted, in this order, then `passphrase` last):

```
merchant_id, merchant_key, return_url, cancel_url, notify_url, notify_method,
name_first, name_last, email_address, cell_number,
m_payment_id, amount, item_name, item_description,
custom_int1..5, custom_str1..5,
email_confirmation, confirmation_address, currency, payment_method,
subscription_type, billing_date, recurring_amount, frequency, cycles,
subscription_notify_email, subscription_notify_webhook, subscription_notify_buyer
```

Implemented in `_shared/payfast.ts` as `PF_OUTBOUND_FIELD_ORDER` / `pfOutboundSignature` / `buildPaymentRedirectUrl`. The subscription-only fields at the tail are exactly what a **Stage 1.4 retainer** charge will populate — the signer already handles them, so that path reuses this code unchanged.

## 8. Link generation — now AUTOMATED (`payfast-create-link`)

`supabase/functions/payfast-create-link/` (`verify_jwt=true`, called by AA, not PayFast) takes `{ entity_id, tier }`, derives the deposit **amount server-side** from `TIER_DEPOSIT_CENTS` (never trusts a client amount), embeds `entity_id` in **`m_payment_id`** + **`custom_str1`** (backup) and `tier` in **`custom_str2`**, signs per §7, and returns the redirect URL. **This makes the ITN→entity mapping correct by construction** — no human types a UUID.

`payfast-webhook` still treats the mapping as **untrusted input**: it reads `entity_id` from `m_payment_id`/`custom_str1` and **rejects with reason `unmappable_entity`** (logged) if it is missing or does not resolve to a real `booked` entity. Generator makes it reliable; webhook stays the safety net.

> **⚠️ Stage 3 wiring flag:** the only remaining manual gap is *where AA triggers `payfast-create-link`* — a Cockpit action / form in the Money or Pipeline workspace. That UI wiring is **not built**; it is a Stage 3 surface task. Until then the function must be invoked manually (e.g. `supabase.functions.invoke("payfast-create-link", { body: { entity_id, tier } })`).

> **⚠️ Confirm with Alex — `TIER_DEPOSIT_CENTS`:** the per-tier deposit amounts in `_shared/payfast.ts` mirror the CLAUDE.md list prices (Proof Sprint R7,500 · Proof Brand R32,500 · Authority Brand R115,000). The actual *deposit* may differ from the full list price — confirm before live use.
