// Programme Stage C runtime: source document text extraction and chunking.
//
// Extraction is recoverable: a failure records failure_code, increments
// attempt_count and leaves the row retryable until maximum_attempts. The row is
// never left stuck in 'extracting'.
//
// Writes only to client_source_documents and client_document_chunks.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

const MAX_CHUNK_CHARS = 4000;

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Paragraph-aware chunking. Deterministic: same text always yields same chunks. */
export function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const normalised = text.replace(/\r\n/g, "\n").trim();
  if (normalised.length === 0) return [];
  if (normalised.length <= maxChars) return [normalised];

  const paragraphs = normalised.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      if (current.trim().length > 0) { chunks.push(current.trim()); current = ""; }
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (current.length + para.length + 2 > maxChars) {
      if (current.trim().length > 0) chunks.push(current.trim());
      current = para;
    } else {
      current = current.length === 0 ? para : `${current}\n\n${para}`;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { document_id?: string; extracted_text?: string };
  try { body = await req.json(); } catch {
    return json({ code: "INVALID_JSON" }, 400);
  }
  const documentId = (body.document_id ?? "").trim();
  if (!documentId) return json({ code: "DOCUMENT_ID_REQUIRED" }, 400);

  const sb = svc();
  const { data: doc, error: docError } = await sb
    .from("client_source_documents")
    .select("id, client_id, processing_status, attempt_count, maximum_attempts, extracted_text")
    .eq("id", documentId)
    .maybeSingle();
  if (docError) return json({ code: "LOOKUP_FAILED", message: docError.message }, 500);
  if (!doc) return json({ code: "DOCUMENT_NOT_FOUND" }, 404);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), doc.client_id as string);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  if (doc.processing_status === "extracted") {
    return json({ already_extracted: true, document_id: documentId }, 200);
  }
  if (doc.processing_status === "failed" && doc.attempt_count >= doc.maximum_attempts) {
    return json({ code: "RETRY_LIMIT_REACHED", attempt_count: doc.attempt_count }, 409);
  }

  const nextAttempt = (doc.attempt_count as number) + 1;
  await sb.from("client_source_documents")
    .update({ processing_status: "extracting", attempt_count: nextAttempt })
    .eq("id", documentId);

  try {
    const text = (body.extracted_text ?? doc.extracted_text ?? "").toString();
    if (text.trim().length === 0) {
      throw Object.assign(new Error("No extractable text was supplied or stored for this document."), {
        failureCode: "NO_TEXT",
      });
    }

    const chunks = chunkText(text);
    if (chunks.length === 0) {
      throw Object.assign(new Error("Extraction produced no chunks."), { failureCode: "EMPTY_CHUNKS" });
    }

    // Re-extraction replaces chunks wholesale so indexes stay contiguous.
    await sb.from("client_document_chunks").delete().eq("source_document_id", documentId);

    const rows = [] as Array<Record<string, unknown>>;
    for (let i = 0; i < chunks.length; i += 1) {
      rows.push({
        client_id: doc.client_id,
        source_document_id: documentId,
        chunk_index: i,
        content: chunks[i],
        content_hash: await sha256Hex(chunks[i]),
        char_count: chunks[i].length,
        locator: { chunk: i, of: chunks.length },
      });
    }

    const { error: chunkError } = await sb.from("client_document_chunks").insert(rows);
    if (chunkError) {
      throw Object.assign(new Error(chunkError.message), { failureCode: "CHUNK_INSERT_FAILED" });
    }

    await sb.from("client_source_documents").update({
      processing_status: "extracted",
      extracted_text: text,
      processed_at: new Date().toISOString(),
      failure_code: null,
      failure_message: null,
    }).eq("id", documentId);

    await audit(sb, "source_document.extracted", "client_source_documents", documentId, {
      chunks: chunks.length,
      attempt: nextAttempt,
    });

    return json({ document_id: documentId, chunks: chunks.length, attempt: nextAttempt }, 200);
  } catch (e) {
    const failureCode = (e as { failureCode?: string }).failureCode ?? "EXTRACTION_FAILED";
    const message = e instanceof Error ? e.message : String(e);
    // Always land in a recoverable terminal state; never leave 'extracting'.
    await sb.from("client_source_documents").update({
      processing_status: "failed",
      failure_code: failureCode,
      failure_message: message.slice(0, 2000),
    }).eq("id", documentId);

    return json({
      code: failureCode,
      message,
      attempt: nextAttempt,
      retryable: nextAttempt < (doc.maximum_attempts as number),
    }, 422);
  }
});
