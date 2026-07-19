// meta-webhook: verify_jwt MUST be false — Meta sends unauthenticated requests.
// Handles: Instagram DMs (message_received) + Meta Ads leadgen events.
// Always returns HTTP 200 to Meta — non-200 causes retry storms.

import { svc, agentEvent } from "../_shared/aa.ts";

// ── Types ────────────────────────────────────────────────────────────────────

type MetaAttachment = { type: string; payload: { url?: string } };
type MetaMessage    = { mid: string; text?: string; attachments?: MetaAttachment[] };
type MetaMessaging  = { sender: { id: string }; recipient: { id: string }; timestamp: number; message?: MetaMessage };
type MetaLeadValue  = { ad_id: string; form_id: string; leadgen_id: string; page_id: string; created_time: number };
type MetaChange     = { field: string; value: MetaLeadValue };
type MetaEntry      = { id: string; time?: number; messaging?: MetaMessaging[]; changes?: MetaChange[] };
type MetaPayload    = { object: string; entry?: MetaEntry[] };

// ── Helpers ───────────────────────────────────────────────────────────────────

const plain200 = (body = "received") =>
  new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });

// ── Handler ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // ── GET: Meta webhook verification challenge ────────────────────────────────
  if (req.method === "GET") {
    const p         = new URL(req.url).searchParams;
    const mode      = p.get("hub.mode");
    const token     = p.get("hub.verify_token");
    const challenge = p.get("hub.challenge");
    const expected  = Deno.env.get("AA_META_VERIFY_TOKEN");

    if (mode === "subscribe" && expected && token === expected && challenge) {
      return plain200(challenge); // plain text, HTTP 200, exactly hub.challenge — nothing else
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // ── POST: Event processing ──────────────────────────────────────────────────
  // Parse body — any parse error still returns 200 so Meta doesn't retry
  let payload: MetaPayload | null = null;
  try { payload = await req.json() as MetaPayload; } catch { /* ignore */ }

  if (!payload || (payload.object !== "instagram" && payload.object !== "page")) {
    return plain200(); // ack unknown objects immediately
  }

  const sb = svc();

  for (const entry of payload.entry ?? []) {
    // Instagram direct messages (entry.messaging array)
    for (const msg of entry.messaging ?? []) {
      if (!msg.message) continue;
      try { await handleIgMessage(sb, msg); }
      catch (e) { console.error("[meta-webhook] ig_message error:", e); }
    }

    // Leadgen events (entry.changes array, field="leadgen")
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      try { await handleLeadgen(sb, change.value); }
      catch (e) { console.error("[meta-webhook] leadgen error:", e); }
    }
  }

  return plain200();
});

// ── Instagram DM handler ──────────────────────────────────────────────────────
//
// Entity threading:
//   entities.notes_signals->>'ig_page_id' = msg.recipient.id (the client page that received the DM)
// conversations.entity_id is NOT NULL, so we skip conversation creation if no entity match.
// Unmatched DMs are logged to agent_events + triage_items for manual linking.

async function handleIgMessage(
  sb: ReturnType<typeof svc>,
  msg: MetaMessaging,
) {
  const senderPsid    = msg.sender.id;
  const recipientPage = msg.recipient.id;
  const text          = msg.message?.text ?? null;
  const mediaUrl      = msg.message?.attachments?.[0]?.payload?.url ?? null;
  const sentAt        = new Date(msg.timestamp).toISOString();

  // 1. Find the entity that owns the receiving IG page
  const { data: entityRow } = await sb
    .from("entities")
    .select("id")
    .eq("notes_signals->>ig_page_id", recipientPage)
    .limit(1)
    .maybeSingle();

  const entityId = entityRow?.id ?? null;

  if (!entityId) {
    // Cannot create conversation (entity_id NOT NULL) — log and triage
    await agentEvent(sb, null, "meta-webhook", "ig_message_unmatched", {
      sender_psid: senderPsid,
      recipient_page: recipientPage,
      has_text: !!text,
    });
    await sb.from("triage_items").insert({
      source: "meta-webhook",
      priority: "high",
      status: "open",
      title: `Unmatched IG DM — page ${recipientPage}`,
      detail: `PSID ${senderPsid} sent a DM to page ${recipientPage} but no entity has notes_signals.ig_page_id matching this page. Set ig_page_id on the correct entity to enable auto-threading.`,
    });
    return;
  }

  // 2. Find or create conversation for this entity+sender pair
  const { data: existingConv } = await sb
    .from("conversations")
    .select("id")
    .eq("entity_id", entityId)
    .eq("channel", "instagram")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId: string;
  if (existingConv) {
    conversationId = existingConv.id;
  } else {
    const { data: newConv, error: convErr } = await sb
      .from("conversations")
      .insert({ entity_id: entityId, channel: "instagram", subject: "Instagram DM", status: "open" })
      .select("id")
      .single();
    if (convErr || !newConv) throw new Error(`conversation insert failed: ${convErr?.message}`);
    conversationId = newConv.id;
  }

  // 3. Insert message
  await sb.from("messages").insert({
    conversation_id: conversationId,
    direction: "inbound",
    sender: senderPsid,
    body: text,
    media_url: mediaUrl,
    sent_at: sentAt,
  });

  await agentEvent(sb, entityId, "meta-webhook", "ig_message_received", {
    psid: senderPsid,
    conversation_id: conversationId,
    has_text: !!text,
    has_media: !!mediaUrl,
  });
}

// ── Leadgen event handler ──────────────────────────────────────────────────────
//
// Entity threading:
//   campaigns.external_id = leadgen value.ad_id → get entity_id
// Writes to: agent_events and triage_items. Direct lead counter mutation is
// disabled because there is no supported increment RPC in the current schema.

async function handleLeadgen(
  sb: ReturnType<typeof svc>,
  value: MetaLeadValue,
) {
  // Find campaign by the Meta ad ID stored in campaigns.external_id
  const { data: campaign, error: campaignErr } = await sb
    .from("campaigns")
    .select("id, entity_id")
    .eq("external_id", value.ad_id)
    .maybeSingle();
  if (campaignErr) {
    console.error("[meta-webhook] leadgen campaign lookup failed:", {
      ad_id: value.ad_id,
      message: campaignErr.message,
    });
    throw new Error(`leadgen campaign lookup failed: ${campaignErr.message}`);
  }

  const entityId   = campaign?.entity_id ?? null;
  const campaignId = campaign?.id ?? null;

  const leadCounterStatus = "disabled_no_supported_rpc";

  // Log the event
  const { error: eventErr } = await sb.from("agent_events").insert({
    entity_id: entityId,
    agent: "meta-webhook",
    event_type: "leadgen_received",
    status: "processed",
    payload: {
      leadgen_id: value.leadgen_id,
      ad_id: value.ad_id,
      form_id: value.form_id,
      page_id: value.page_id,
      campaign_id: campaignId,
      lead_counter_status: leadCounterStatus,
    },
  });
  if (eventErr) {
    console.error("[meta-webhook] leadgen event insert failed:", {
      ad_id: value.ad_id,
      campaign_id: campaignId,
      message: eventErr.message,
    });
    throw new Error(`leadgen event insert failed: ${eventErr.message}`);
  }

  // Triage item so the team knows to follow up with the lead
  const { error: triageErr } = await sb.from("triage_items").insert({
    entity_id: entityId,
    source: "meta-webhook",
    priority: entityId ? "normal" : "high",
    status: "open",
    title: entityId
      ? `New Meta lead via campaign`
      : `New Meta lead — no campaign match for ad ${value.ad_id}`,
    detail: `Leadgen ID: ${value.leadgen_id}. Ad: ${value.ad_id}. Form: ${value.form_id}. Lead counter: disabled_no_supported_rpc. ${campaignId ? "" : "Set campaigns.external_id = " + value.ad_id + " to enable auto-threading."}`,
  });
  if (triageErr) {
    console.error("[meta-webhook] leadgen triage insert failed:", {
      ad_id: value.ad_id,
      campaign_id: campaignId,
      message: triageErr.message,
    });
    throw new Error(`leadgen triage insert failed: ${triageErr.message}`);
  }
}
