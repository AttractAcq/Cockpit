// Programme Stage C runtime: register a client source document.
//
// This is what lets Phase 1 generate from more than form fields. A document may
// arrive as stored file, external URL, or text pasted by an operator.
//
// Writes only to client_source_documents. Extraction and chunking are a
// separate call to process-source-document.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

const SOURCE_KINDS = [
  "client_form", "uploaded_document", "website_page", "service_page", "review",
  "existing_marketing", "sales_document", "offer_document", "brand_document",
  "competitor_reference", "project_proof",
] as const;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string; source_kind?: string; original_filename?: string;
    source_url?: string; storage_bucket?: string; storage_path?: string;
    mime_type?: string; byte_size?: number; text?: string;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const kind = (body.source_kind ?? "").trim();
  const text = (body.text ?? "").trim();
  const url = (body.source_url ?? "").trim();
  const path = (body.storage_path ?? "").trim();

  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!SOURCE_KINDS.includes(kind as typeof SOURCE_KINDS[number])) {
    return json({ code: "INVALID_SOURCE_KIND", allowed: SOURCE_KINDS }, 400);
  }
  if (text.length === 0 && url.length === 0 && path.length === 0) {
    return json({
      code: "LOCATOR_REQUIRED",
      message: "Supply pasted text, a source_url, or a storage_path.",
    }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  // Hash the most specific thing available so dedupe is meaningful: the content
  // itself when we have it, otherwise the locator.
  const hashInput = text.length > 0 ? text : (url.length > 0 ? url : path);
  const contentHash = await sha256Hex(hashInput);

  const { data: existing } = await sb
    .from("client_source_documents")
    .select("id, processing_status")
    .eq("client_id", clientId)
    .eq("content_hash", contentHash)
    .maybeSingle();
  if (existing) {
    return json({
      duplicate: true,
      document_id: existing.id,
      processing_status: existing.processing_status,
      message: "This document is already registered for this client.",
    }, 200);
  }

  const { data: doc, error } = await sb
    .from("client_source_documents")
    .insert({
      client_id: clientId,
      source_kind: kind,
      original_filename: body.original_filename ?? null,
      source_url: url.length > 0 ? url : null,
      storage_bucket: body.storage_bucket ?? null,
      storage_path: path.length > 0 ? path : null,
      mime_type: body.mime_type ?? null,
      byte_size: body.byte_size ?? null,
      content_hash: contentHash,
      // Text supplied inline is stored but NOT marked extracted: chunking is
      // process-source-document's job, so status stays honest.
      extracted_text: text.length > 0 ? text : null,
      processing_status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await sb.from("client_source_documents")
        .select("id").eq("client_id", clientId).eq("content_hash", contentHash).maybeSingle();
      if (raced) return json({ duplicate: true, document_id: raced.id }, 200);
    }
    return json({ code: "INSERT_FAILED", message: error.message }, 500);
  }

  await audit(sb, "source_document.registered", "client_source_documents", doc.id as string, {
    client_id: clientId, source_kind: kind, has_inline_text: text.length > 0,
  });

  return json({
    duplicate: false,
    document_id: doc.id,
    processing_status: "pending",
    needs_extraction: true,
  }, 201);
});
