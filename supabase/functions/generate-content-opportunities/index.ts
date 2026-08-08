// Programme Stage F — generate Content Opportunities from one canonical
// content_source. Writes only to content_opportunities and
// content_opportunity_sources (same write boundary as create-content-opportunity).
//
// Deliberately single-source per call, matching create-content-opportunity's
// primary-source shape. Hybrid (multi-source) Opportunities remain available
// through that existing manual endpoint; AI-driven hybrid synthesis is a
// noted deferral — see the Stage F implementation report.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { callAnthropic, hasAnthropicKey, isAiEnabled, DEFAULT_AI_MODEL } from "../_shared/anthropic.ts";
import {
  extractJsonArray,
  validateGeneratedCandidate,
  checkEligibility,
  checkDuplicate,
  type GeneratedOpportunityCandidate,
} from "../_shared/opportunity-intelligence.ts";

const MAX_CANDIDATES = 3;
const SCORE_METHOD_GENERATOR = "stage_f_generator_v1";

function buildPrompt(input: {
  sourceKind: string;
  sourceTitle: string;
  sourceSummary: string | null;
  sourceContent: string;
  contextExcerpts: string;
}): { system: string; user: string } {
  const system =
    "You are the Content Opportunity generator for Attract Acquisition's Cockpit. " +
    "You convert one raw content source into 1-3 candidate Content Opportunities for a service business. " +
    "Never invent facts, results, metrics or claims that are not present in the source or the approved " +
    "business context provided. If a candidate opportunity would require a claim the source does not " +
    "actually support, set claim_unsupported to true for that candidate rather than softening or omitting " +
    "the claim. Output ONLY a JSON array, no prose, no markdown fence.";

  const user = `SOURCE (kind: ${input.sourceKind})
Title: ${input.sourceTitle}
Summary: ${input.sourceSummary ?? "(none)"}
Content:
${input.sourceContent.slice(0, 6000)}

APPROVED BUSINESS CONTEXT (excerpts, for grounding only — do not restate verbatim):
${input.contextExcerpts.slice(0, 4000)}

Return a JSON array of 1 to ${MAX_CANDIDATES} candidate objects, each with exactly these keys:
title (string, required, <=400 chars), angle, rationale, core_claim, hook_direction, audience,
pain_or_objection, belief_before, belief_after, objective, offer_relationship, funnel_stage,
candidate_formats (string array), candidate_channels (string array), cta_direction,
visual_potential (integer 1-5 or null), production_requirements (string or null),
claim_unsupported (boolean — true only if this candidate's core_claim is not actually backed by the source).`;

  return { system, user };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; content_source_id?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const sourceId = (body.content_source_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!sourceId) return json({ code: "CONTENT_SOURCE_ID_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  if (!isAiEnabled() || !hasAnthropicKey()) {
    return json({ code: "AI_GENERATION_DISABLED", message: "AI generation is not enabled for this environment." }, 503);
  }

  const sb = svc();

  const { data: source, error: sourceError } = await sb
    .from("content_sources")
    .select("id, client_id, source_kind, title, summary, raw_content, proof_item_id")
    .eq("id", sourceId)
    .maybeSingle();
  if (sourceError) return json({ code: "LOOKUP_FAILED", message: sourceError.message }, 500);
  if (!source) return json({ code: "SOURCE_NOT_FOUND" }, 404);
  if (source.client_id !== clientId) return json({ code: "CROSS_CLIENT_SOURCE" }, 403);
  if (!source.raw_content || source.raw_content.trim().length === 0) {
    return json({ code: "SOURCE_HAS_NO_CONTENT", message: "This source has no raw_content to generate from yet." }, 409);
  }

  const [clientRes, conflictsRes, contextRes, existingRes, proofRes] = await Promise.all([
    sb.from("clients").select("status").eq("id", clientId).maybeSingle(),
    sb.from("client_input_conflicts").select("id, severity, status").eq("client_id", clientId),
    sb.from("client_context_files")
      .select("file_number, file_name, content_md")
      .eq("client_id", clientId)
      .eq("status", "approved")
      .in("file_number", [1, 2, 3, 4]),
    sb.from("content_opportunities")
      .select("id, title, core_claim")
      .eq("client_id", clientId)
      .not("status", "in", "(rejected,expired)")
      .order("created_at", { ascending: false })
      .limit(200),
    source.proof_item_id
      ? sb.from("proof_items").select("verification_status, consent_status").eq("id", source.proof_item_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (clientRes.error) return json({ code: "LOOKUP_FAILED", message: clientRes.error.message }, 500);
  if (conflictsRes.error) return json({ code: "LOOKUP_FAILED", message: conflictsRes.error.message }, 500);

  const clientStatus = clientRes.data?.status ?? "prospect";
  const hasUnresolvedBlockingConflict = (conflictsRes.data ?? []).some(
    (c) => c.severity === "blocking" && (c.status === "open" || c.status === "acknowledged"),
  );
  const contextExcerpts = (contextRes.data ?? [])
    .map((f) => `[${f.file_name}]\n${String(f.content_md ?? "").slice(0, 1000)}`)
    .join("\n\n");
  const existingForDedup = (existingRes.data ?? []) as Array<{ id: string; title: string; core_claim: string | null }>;
  const proofRow = proofRes.data as { verification_status: string; consent_status: string } | null;

  const { system, user } = buildPrompt({
    sourceKind: source.source_kind,
    sourceTitle: source.title,
    sourceSummary: source.summary,
    sourceContent: source.raw_content,
    contextExcerpts: contextExcerpts || "(no approved context files available)",
  });

  const aiResult = await callAnthropic({ system, user, maxTokens: 4000, timeoutMs: 60000 });
  if (!aiResult.ok) {
    return json({ code: aiResult.code, message: aiResult.error, retryable: aiResult.retryable }, 502);
  }

  const rawArray = extractJsonArray(aiResult.text);
  if (!rawArray || rawArray.length === 0) {
    return json({ code: "GENERATION_RESPONSE_INVALID", message: "The model did not return a valid JSON array." }, 502);
  }

  const candidates: GeneratedOpportunityCandidate[] = [];
  for (const raw of rawArray.slice(0, MAX_CANDIDATES)) {
    const validated = validateGeneratedCandidate(raw);
    if (validated) candidates.push(validated);
  }
  if (candidates.length === 0) {
    return json({ code: "NO_VALID_CANDIDATES", message: "No generated candidate passed schema validation." }, 502);
  }

  const eligibilityCtx = {
    clientStatus,
    requiresConsent: source.source_kind === "proof_item",
    consentStatus: proofRow?.consent_status ?? null,
    requiresVerifiedProof: source.source_kind === "proof_item",
    proofVerificationStatus: (proofRow?.verification_status as "unverified" | "verified" | "rejected" | undefined) ?? null,
    hasUnresolvedBlockingConflict,
  };

  const generated: Array<{
    content_opportunity_id: string;
    title: string;
    eligibility_status: "eligible" | "ineligible";
    eligibility_reason: string | null;
    duplicate_of_opportunity_id: string | null;
  }> = [];

  for (const candidate of candidates) {
    const eligibility = checkEligibility(candidate, eligibilityCtx);
    const dedup = checkDuplicate(candidate, existingForDedup);

    const insertRow = {
      client_id: clientId,
      title: candidate.title,
      angle: candidate.angle,
      rationale: candidate.rationale,
      status: eligibility.status === "ineligible" ? "rejected" : "draft",
      origin: source.source_kind === "manual_idea" ? "manual"
        : source.source_kind === "proof_item" ? "proof"
        : source.source_kind === "research_candidate" ? "research"
        : "performance",
      core_claim: candidate.core_claim,
      hook_direction: candidate.hook_direction,
      audience: candidate.audience,
      pain_or_objection: candidate.pain_or_objection,
      belief_before: candidate.belief_before,
      belief_after: candidate.belief_after,
      objective: candidate.objective,
      offer_relationship: candidate.offer_relationship,
      funnel_stage: candidate.funnel_stage,
      candidate_formats: candidate.candidate_formats,
      candidate_channels: candidate.candidate_channels,
      cta_direction: candidate.cta_direction,
      visual_potential: candidate.visual_potential,
      production_requirements: candidate.production_requirements,
      eligibility_status: eligibility.status,
      eligibility_reason: eligibility.reason,
      eligibility_checked_at: new Date().toISOString(),
      rejected_reason: eligibility.status === "ineligible" ? eligibility.reason : null,
      duplicate_of_opportunity_id: dedup.duplicateOfId,
      dedup_reason: dedup.reason,
      generated_by: "ai",
      provider: "anthropic",
      model: DEFAULT_AI_MODEL,
      score_method: SCORE_METHOD_GENERATOR,
      created_by: access.userId,
    };

    const { data: inserted, error: insertError } = await sb
      .from("content_opportunities")
      .insert(insertRow)
      .select("id, title, eligibility_status, eligibility_reason, duplicate_of_opportunity_id")
      .single();
    if (insertError) {
      return json({ code: "INSERT_FAILED", message: insertError.message, partial_results: generated }, 500);
    }

    const { error: linkError } = await sb.from("content_opportunity_sources").insert({
      client_id: clientId,
      content_opportunity_id: inserted.id,
      content_source_id: sourceId,
      contribution: "primary",
    });
    if (linkError) {
      await sb.from("content_opportunities").delete().eq("id", inserted.id);
      return json({ code: "LINK_FAILED", message: linkError.message, partial_results: generated }, 500);
    }

    await audit(sb, "content_opportunity.generated", "content_opportunities", inserted.id, {
      client_id: clientId,
      content_source_id: sourceId,
      eligibility_status: inserted.eligibility_status,
      duplicate_of_opportunity_id: inserted.duplicate_of_opportunity_id,
    });

    generated.push({
      content_opportunity_id: inserted.id,
      title: inserted.title,
      eligibility_status: inserted.eligibility_status,
      eligibility_reason: inserted.eligibility_reason,
      duplicate_of_opportunity_id: inserted.duplicate_of_opportunity_id,
    });
  }

  return json({ ok: true, content_source_id: sourceId, generated }, 201);
});
