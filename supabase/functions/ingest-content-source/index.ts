// Programme Stage E runtime: canonical source ingestion.
//
// One entry point for all four supply streams. Every stream resolves to the
// same canonical content_sources identity (client_id + sha256 of raw content).
//
// This function writes ONLY to content_sources, manual_ideas and proof_items.
// It never touches calendar_cells, calendar_slots, content_items, production
// briefs, assets or distribution. The supply side cannot reach the Calendar.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

type SourceKind =
  | "manual_idea"
  | "proof_item"
  | "research_candidate"
  | "performance_insight";

const SOURCE_KINDS: readonly SourceKind[] = [
  "manual_idea",
  "proof_item",
  "research_candidate",
  "performance_insight",
];

interface IngestBody {
  client_id?: string;
  source_kind?: SourceKind;
  title?: string;
  summary?: string | null;
  raw_content?: string;
  external_ref?: string | null;
  payload?: Record<string, unknown>;
  ideation_candidate_id?: string | null;
  performance_insight_id?: string | null;
  source_document_id?: string | null;
  proof_item_id?: string | null;
  /** manual_idea only */
  notes?: string | null;
  /** proof_item only */
  proof_kind?: string;
  claim?: string;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Mirrors content_sources_adapter_check so we fail before hitting the database. */
export function linkageValid(kind: SourceKind, body: IngestBody): boolean {
  const ideation = body.ideation_candidate_id ?? null;
  const insight = body.performance_insight_id ?? null;
  const proof = body.proof_item_id ?? null;
  switch (kind) {
    case "manual_idea":
      return ideation === null && insight === null && proof === null;
    case "proof_item":
      return ideation === null && insight === null;
    case "research_candidate":
      return insight === null && proof === null;
    case "performance_insight":
      return ideation === null && proof === null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return json({ code: "INVALID_JSON", message: "Request body must be JSON." }, 400);
  }

  const clientId = (body.client_id ?? "").trim();
  const kind = body.source_kind as SourceKind | undefined;
  const title = (body.title ?? "").trim();
  const rawContent = body.raw_content ?? "";

  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!kind || !SOURCE_KINDS.includes(kind)) {
    return json({ code: "INVALID_SOURCE_KIND", allowed: SOURCE_KINDS }, 400);
  }
  if (title.length < 1 || title.length > 400) {
    return json({ code: "INVALID_TITLE", message: "title must be 1-400 characters." }, 400);
  }
  if (rawContent.length < 1) {
    return json({ code: "RAW_CONTENT_REQUIRED", message: "raw_content must not be empty." }, 400);
  }
  if (!linkageValid(kind, body)) {
    return json(
      { code: "INVALID_ADAPTER_LINKAGE", message: `linkage supplied does not match source_kind ${kind}.` },
      400,
    );
  }
  if (kind === "proof_item" && !(body.claim ?? "").trim()) {
    return json({ code: "PROOF_CLAIM_REQUIRED" }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) {
    return json({ code: access.code, message: access.message }, access.status);
  }

  const sb = svc();
  const rawHash = await sha256Hex(rawContent);

  // Idempotent by canonical identity: re-submitting the same material for the
  // same client returns the existing source rather than creating a duplicate.
  const { data: existing, error: existingError } = await sb
    .from("content_sources")
    .select("id, source_kind, processing_status")
    .eq("client_id", clientId)
    .eq("raw_content_hash", rawHash)
    .maybeSingle();
  if (existingError) {
    return json({ code: "LOOKUP_FAILED", message: existingError.message }, 500);
  }
  if (existing) {
    return json({
      duplicate: true,
      content_source_id: existing.id,
      source_kind: existing.source_kind,
      processing_status: existing.processing_status,
      message: "An identical source already exists for this client.",
    }, 200);
  }

  let proofItemId = body.proof_item_id ?? null;

  const { data: source, error: insertError } = await sb
    .from("content_sources")
    .insert({
      client_id: clientId,
      source_kind: kind,
      title,
      summary: body.summary ?? null,
      raw_content: rawContent,
      raw_content_hash: rawHash,
      payload: body.payload ?? {},
      external_ref: body.external_ref ?? null,
      ideation_candidate_id: body.ideation_candidate_id ?? null,
      performance_insight_id: body.performance_insight_id ?? null,
      source_document_id: body.source_document_id ?? null,
      proof_item_id: proofItemId,
      processing_status: "pending",
      created_by: access.userId,
    })
    .select("id")
    .single();

  if (insertError) {
    // Concurrent submission of identical material loses the race benignly.
    if (insertError.code === "23505") {
      const { data: raced } = await sb
        .from("content_sources")
        .select("id")
        .eq("client_id", clientId)
        .eq("raw_content_hash", rawHash)
        .maybeSingle();
      if (raced) {
        return json({ duplicate: true, content_source_id: raced.id, message: "Concurrent duplicate." }, 200);
      }
    }
    return json({ code: "INSERT_FAILED", message: insertError.message }, 500);
  }

  const sourceId = source.id as string;
  const created: Record<string, string> = { content_source_id: sourceId };

  try {
    if (kind === "manual_idea") {
      const { data: idea, error: ideaError } = await sb
        .from("manual_ideas")
        .insert({
          client_id: clientId,
          content_source_id: sourceId,
          body: rawContent,
          submitted_by: access.userId,
        })
        .select("id")
        .single();
      if (ideaError) throw new Error(`manual_ideas: ${ideaError.message}`);
      created.manual_idea_id = idea.id as string;
    }

    if (kind === "proof_item" && !proofItemId) {
      const { data: proof, error: proofError } = await sb
        .from("proof_items")
        .insert({
          client_id: clientId,
          content_source_id: sourceId,
          proof_kind: body.proof_kind ?? "artefact",
          claim: (body.claim ?? "").trim(),
          // Fails closed: proof enters unverified, without consent, and unused.
          verification_status: "unverified",
          consent_status: "not_obtained",
          usage_state: "unused",
        })
        .select("id")
        .single();
      if (proofError) throw new Error(`proof_items: ${proofError.message}`);
      proofItemId = proof.id as string;
      created.proof_item_id = proofItemId;
      await sb.from("content_sources").update({ proof_item_id: proofItemId }).eq("id", sourceId);
    }
  } catch (e) {
    // Never leave a half-built source behind.
    await sb.from("content_sources").delete().eq("id", sourceId);
    return json(
      { code: "DETAIL_INSERT_FAILED", message: e instanceof Error ? e.message : String(e) },
      500,
    );
  }

  await audit(sb, "content_source.ingested", "content_sources", sourceId, {
    source_kind: kind,
    client_id: clientId,
  });

  return json({ duplicate: false, ...created, processing_status: "pending" }, 201);
});
