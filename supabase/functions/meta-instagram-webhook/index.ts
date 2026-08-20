// Stage 2 Phase 10 — Communications Hub. verify_jwt MUST be false: Meta
// sends unauthenticated requests, authenticated instead by
// hub.verify_token (GET handshake) and X-Hub-Signature-256 (POST body
// HMAC). Deliberately a fresh function, not a revival of the retired
// meta-webhook (which referenced the retired entities/conversations
// schema) -- new code, new tables (comms_identities/comms_messages), same
// hard-won operational lesson from that legacy code: always answer Meta
// with HTTP 200 once the signature is valid, even if per-message
// processing fails, or Meta retry-storms the delivery.

import { svc } from "../_shared/aa.ts";
import { verifyMetaSignature } from "../_shared/comms-meta.ts";

interface MetaAttachment { type: string; payload: { url?: string } }
interface MetaMessage { mid: string; text?: string; is_echo?: boolean; attachments?: MetaAttachment[] }
interface MetaMessaging { sender: { id: string }; recipient: { id: string }; timestamp: number; message?: MetaMessage }
interface MetaEntry { id: string; time?: number; messaging?: MetaMessaging[] }
interface MetaPayload { object: string; entry?: MetaEntry[] }

const plain200 = (body = "received") => new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Methods": "GET, POST, OPTIONS" } });
  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    const expected = Deno.env.get("AA_META_VERIFY_TOKEN");
    if (params.get("hub.mode") === "subscribe" && expected && params.get("hub.verify_token") === expected && params.get("hub.challenge")) {
      return plain200(params.get("hub.challenge")!);
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  const appSecret = Deno.env.get("META_APP_SECRET");
  const rawBody = await req.text();
  if (!appSecret) {
    console.error("[meta-instagram-webhook] META_APP_SECRET is not configured -- refusing to process (fail closed).");
    return new Response("Not configured", { status: 503 });
  }
  const validSignature = await verifyMetaSignature(rawBody, req.headers.get("X-Hub-Signature-256"), appSecret);
  if (!validSignature) {
    console.error("[meta-instagram-webhook] invalid X-Hub-Signature-256 -- rejecting.");
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: MetaPayload | null = null;
  try { payload = JSON.parse(rawBody) as MetaPayload; } catch { /* fall through to plain200 below */ }

  if (!payload || payload.object !== "instagram") return plain200();

  const sb = svc();
  for (const entry of payload.entry ?? []) {
    for (const msg of entry.messaging ?? []) {
      if (!msg.message || msg.message.is_echo) continue; // echoes of our own sends are recorded by send-instagram-message instead
      const text = msg.message.text;
      if (!text) continue; // v1 is text-only; attachment-only messages are not yet ingested
      try {
        await sb.rpc("record_comms_message", {
          p_platform: "instagram",
          p_external_user_id: msg.sender.id,
          p_direction: "inbound",
          p_body: text,
          p_external_message_id: msg.message.mid,
          p_occurred_at: new Date(msg.timestamp).toISOString(),
        });
      } catch (e) {
        console.error("[meta-instagram-webhook] record_comms_message failed:", e);
      }
    }
  }

  return plain200();
});
