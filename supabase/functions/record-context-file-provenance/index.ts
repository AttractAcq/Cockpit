// Programme Stage C runtime: record what a context file was actually built from.
//
// Deliberately DERIVED, not model-reported. The model is never asked to state
// its own citations, because a model asserting where a claim came from is
// exactly how an unsupported claim acquires a false provenance. This records
// only sources that demonstrably exist for the client at the time of recording:
// populated client input fields, extracted documents, and completed research.
//
// Human-approved inferences are entered separately and are NEVER touched here.
//
// Writes only to client_context_file_citations and client_context_file_playbooks.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

const SKIP_FIELDS = new Set([
  "id", "client_id", "created_at", "updated_at", "uploaded_file_refs", "social_links",
]);

function excerpt(value: string, max = 400): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; file_number?: number };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }
  const clientId = (body.client_id ?? "").trim();
  const fileNumber = body.file_number;
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (typeof fileNumber !== "number") return json({ code: "FILE_NUMBER_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: file, error: fileErr } = await sb
    .from("client_context_files")
    .select("id, version, status")
    .eq("client_id", clientId)
    .eq("file_number", fileNumber)
    .maybeSingle();
  if (fileErr) return json({ code: "LOOKUP_FAILED", message: fileErr.message }, 500);
  if (!file) return json({ code: "CONTEXT_FILE_NOT_FOUND" }, 404);

  const fileId = file.id as string;
  const fileVersion = (file.version as number) ?? 1;

  const [inputsRes, docsRes, researchRes, playbooksRes] = await Promise.all([
    sb.from("client_inputs").select("*").eq("client_id", clientId).maybeSingle(),
    sb.from("client_source_documents").select("id, source_kind, original_filename, source_url, extracted_text")
      .eq("client_id", clientId).eq("processing_status", "extracted"),
    sb.from("client_research_sources").select("id, title, evidence_text").eq("client_id", clientId),
    sb.from("playbook_versions").select("id, playbook_id, version, content_hash").eq("status", "active"),
  ]);

  const citations: Array<Record<string, unknown>> = [];

  if (inputsRes.data) {
    for (const [field, value] of Object.entries(inputsRes.data as Record<string, unknown>)) {
      if (SKIP_FIELDS.has(field)) continue;
      if (typeof value !== "string") continue;
      if (value.trim().length === 0) continue;
      citations.push({
        client_id: clientId,
        context_file_id: fileId,
        context_file_version: fileVersion,
        claim_excerpt: excerpt(value),
        source_type: "client_input",
        client_input_field: field,
      });
    }
  }

  for (const doc of (docsRes.data ?? []) as Array<Record<string, unknown>>) {
    const label = (doc.original_filename as string) ?? (doc.source_url as string) ?? (doc.source_kind as string);
    citations.push({
      client_id: clientId,
      context_file_id: fileId,
      context_file_version: fileVersion,
      claim_excerpt: excerpt(`${label}: ${(doc.extracted_text as string) ?? ""}`),
      source_type: "source_document",
      source_document_id: doc.id,
    });
  }

  for (const r of (researchRes.data ?? []) as Array<Record<string, unknown>>) {
    citations.push({
      client_id: clientId,
      context_file_id: fileId,
      context_file_version: fileVersion,
      claim_excerpt: excerpt(`${r.title as string}: ${(r.evidence_text as string) ?? ""}`),
      source_type: "research_source",
      research_source_id: r.id,
    });
  }

  // Rebuild derived citations only. An approved_inference is a human decision
  // and must survive re-derivation untouched.
  const { error: delErr } = await sb
    .from("client_context_file_citations")
    .delete()
    .eq("context_file_id", fileId)
    .eq("context_file_version", fileVersion)
    .neq("source_type", "approved_inference");
  if (delErr) return json({ code: "CLEAR_FAILED", message: delErr.message }, 500);

  if (citations.length > 0) {
    const { error: insErr } = await sb.from("client_context_file_citations").insert(citations);
    if (insErr) return json({ code: "CITATION_INSERT_FAILED", message: insErr.message }, 500);
  }

  const playbookRows = ((playbooksRes.data ?? []) as Array<Record<string, unknown>>).map((pv) => ({
    client_id: clientId,
    context_file_id: fileId,
    context_file_version: fileVersion,
    playbook_id: pv.playbook_id,
    playbook_version_id: pv.id,
    playbook_version: pv.version,
    playbook_content_hash: pv.content_hash,
    applied_sections: [],
  }));

  let playbooksRecorded = 0;
  if (playbookRows.length > 0) {
    const { error: pbErr } = await sb
      .from("client_context_file_playbooks")
      .upsert(playbookRows, { onConflict: "context_file_id,context_file_version,playbook_version_id" });
    if (pbErr) return json({ code: "PLAYBOOK_LINK_FAILED", message: pbErr.message }, 500);
    playbooksRecorded = playbookRows.length;
  }

  await audit(sb, "context_file.provenance_recorded", "client_context_files", fileId, {
    client_id: clientId, file_number: fileNumber, citations: citations.length, playbooks: playbooksRecorded,
  });

  return json({
    context_file_id: fileId,
    context_file_version: fileVersion,
    citations_recorded: citations.length,
    playbooks_recorded: playbooksRecorded,
    // Honest signal: with no active playbook version, authority is unrecorded.
    playbook_authority_missing: playbooksRecorded === 0,
  }, 200);
});
