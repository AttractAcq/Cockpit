// Stage 2 Phase 10 — Communications Hub. Meta/Instagram DM plumbing,
// deliberately separate from _shared/instagram-publish.ts (Distribution's
// per-client content-publishing path) rather than extending it -- sending a
// DM reply and publishing a feed post are different Graph API capabilities
// with different callers, and Comms Hub is AA's own single Instagram
// business account (Decision 3, Phase 00), not a per-client one.
//
// Credential resolution deliberately reuses the exact priority order
// instagram-publish.ts's resolveMetaConfig already established (deployed
// secret first, then per-account Vault) rather than inventing a new scheme
// -- the same real Meta System User Token that already publishes real
// posts is the one this reuses.

import { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { readCredential } from "./aa.ts";

const GRAPH_VERSION = "v21.0";
const AA_CLIENT_SLUG = "attract-acquisition";

export async function resolveAaMetaToken(sb: SupabaseClient): Promise<string | null> {
  return (
    (Deno.env.get("_GLOBAL_META_SYSTEM_USER_TOKEN") ?? null) ??
    (Deno.env.get("META_SYSTEM_USER_TOKEN") ?? null) ??
    (await readCredential(sb, AA_CLIENT_SLUG, "META", "SYSTEM_USER_TOKEN")) ??
    (await readCredential(sb, "_GLOBAL", "META", "SYSTEM_USER_TOKEN"))
  );
}

export async function resolveAaInstagramAccountId(sb: SupabaseClient): Promise<string | null> {
  return (
    (await readCredential(sb, AA_CLIENT_SLUG, "META", "IG_USER_ID")) ??
    (Deno.env.get("META_INSTAGRAM_BUSINESS_ACCOUNT_ID") ?? null)
  );
}

/**
 * Verify Meta's X-Hub-Signature-256 header against the raw request body using
 * the app secret. Constant-time comparison via a byte-length-matched digest
 * compare -- never a plain `===` on attacker-influenced hex strings.
 */
export async function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

export type SendMessageResult = { ok: true; externalMessageId: string | null } | { ok: false; error: string };

/** Real Graph API send. Only reached when credentials resolved. */
export async function sendInstagramMessage(igUserId: string, recipientPsid: string, text: string, token: string): Promise<SendMessageResult> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientPsid }, message: { text }, access_token: token }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data?.error?.message === "string" ? data.error.message : `Meta send failed with HTTP ${res.status}`;
    return { ok: false, error: message };
  }
  const externalMessageId = typeof data?.message_id === "string" ? data.message_id : null;
  return { ok: true, externalMessageId };
}
