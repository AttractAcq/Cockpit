// Programme Stage F — score one Content Opportunity against the universal,
// slot-independent rubric. Writes only content_opportunity_scores (history)
// and the denormalised score/score_method pointer on content_opportunities.
//
// The model supplies each of the 8 dimension scores; it is never trusted for
// the overall score. computeOverallScore (the single authoritative
// implementation, shared with the frontend) computes that from the
// dimensions server-side. A model-supplied "overall_score" or "rank" field
// in the response is ignored even if present.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { callAnthropic, hasAnthropicKey, isAiEnabled, DEFAULT_AI_MODEL } from "../_shared/anthropic.ts";
import {
  OPPORTUNITY_SCORE_DIMENSIONS,
  OPPORTUNITY_SCORE_METHOD,
  computeOverallScore,
  type OpportunityDimensionScores,
} from "../_shared/opportunity-intelligence.ts";

function buildPrompt(input: {
  title: string;
  angle: string | null;
  rationale: string | null;
  coreClaim: string | null;
  audience: string | null;
  funnelStage: string | null;
  contextExcerpts: string;
}): { system: string; user: string } {
  const dimensionList = OPPORTUNITY_SCORE_DIMENSIONS.map((d) => `- ${d.key}: ${d.label}`).join("\n");
  const system =
    "You are the Content Opportunity scoring model for Attract Acquisition's Cockpit. " +
    "Score exactly the dimensions listed, each 0-100. Do NOT compute or output an overall score or rank — " +
    "the platform computes that deterministically from your dimension scores. Output ONLY a JSON object, " +
    "no prose, no markdown fence.";

  const user = `OPPORTUNITY
Title: ${input.title}
Angle: ${input.angle ?? "(none)"}
Rationale: ${input.rationale ?? "(none)"}
Core claim: ${input.coreClaim ?? "(none)"}
Audience: ${input.audience ?? "(none)"}
Funnel stage: ${input.funnelStage ?? "(none)"}

APPROVED BUSINESS CONTEXT (excerpts, for grounding only):
${input.contextExcerpts.slice(0, 3000)}

Score these dimensions, each an integer 0-100:
${dimensionList}

Return a JSON object with exactly these keys: ${OPPORTUNITY_SCORE_DIMENSIONS.map((d) => d.key).join(", ")},
rationale (string), strengths (string array), risks (string array).`;

  return { system, user };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const tryParse = (candidate: string): Record<string, unknown> | null => {
    try {
      const value = JSON.parse(candidate);
      return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  };
  const raw = tryParse(text.trim());
  if (raw) return raw;
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) {
    const parsed = tryParse(fenced[1]);
    if (parsed) return parsed;
  }
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) {
    const parsed = tryParse(text.slice(s, e + 1));
    if (parsed) return parsed;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; content_opportunity_id?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const opportunityId = (body.content_opportunity_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!opportunityId) return json({ code: "CONTENT_OPPORTUNITY_ID_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  if (!isAiEnabled() || !hasAnthropicKey()) {
    return json({ code: "AI_GENERATION_DISABLED", message: "AI scoring is not enabled for this environment." }, 503);
  }

  const sb = svc();

  const { data: opp, error: oppError } = await sb
    .from("content_opportunities")
    .select("id, client_id, title, angle, rationale, core_claim, audience, funnel_stage, status, eligibility_status")
    .eq("id", opportunityId)
    .maybeSingle();
  if (oppError) return json({ code: "LOOKUP_FAILED", message: oppError.message }, 500);
  if (!opp) return json({ code: "OPPORTUNITY_NOT_FOUND" }, 404);
  if (opp.client_id !== clientId) return json({ code: "CROSS_CLIENT_OPPORTUNITY" }, 403);
  if (opp.eligibility_status === "ineligible") {
    return json({ code: "OPPORTUNITY_INELIGIBLE", message: "Ineligible Opportunities are not scored." }, 409);
  }
  if (opp.status === "rejected" || opp.status === "expired") {
    return json({ code: "OPPORTUNITY_NOT_SCORABLE", message: `Opportunity status is ${opp.status}.` }, 409);
  }

  const { data: contextRows } = await sb
    .from("client_context_files")
    .select("file_name, content_md")
    .eq("client_id", clientId)
    .eq("status", "approved")
    .in("file_number", [1, 2, 3]);
  const contextExcerpts = (contextRows ?? [])
    .map((f) => `[${f.file_name}]\n${String(f.content_md ?? "").slice(0, 800)}`)
    .join("\n\n") || "(no approved context files available)";

  const { system, user } = buildPrompt({
    title: opp.title,
    angle: opp.angle,
    rationale: opp.rationale,
    coreClaim: opp.core_claim,
    audience: opp.audience,
    funnelStage: opp.funnel_stage,
    contextExcerpts,
  });

  const aiResult = await callAnthropic({ system, user, maxTokens: 1500, timeoutMs: 45000 });
  if (!aiResult.ok) {
    return json({ code: aiResult.code, message: aiResult.error, retryable: aiResult.retryable }, 502);
  }

  const parsed = extractJsonObject(aiResult.text);
  if (!parsed) {
    return json({ code: "SCORING_RESPONSE_INVALID", message: "The model did not return a valid JSON object." }, 502);
  }

  const dimensions = {} as OpportunityDimensionScores;
  for (const dim of OPPORTUNITY_SCORE_DIMENSIONS) {
    const value = parsed[dim.key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
      return json({
        code: "SCORING_DIMENSION_INVALID",
        message: `Dimension "${dim.key}" was missing or out of range.`,
      }, 502);
    }
    dimensions[dim.key] = value;
  }

  let overallScore: number;
  try {
    overallScore = computeOverallScore(dimensions);
  } catch (e) {
    return json({ code: "SCORE_COMPUTATION_FAILED", message: (e as Error).message }, 502);
  }

  const rationale = typeof parsed.rationale === "string" ? parsed.rationale : null;
  const strengths = Array.isArray(parsed.strengths) ? (parsed.strengths as unknown[]).filter((s) => typeof s === "string") as string[] : [];
  const risks = Array.isArray(parsed.risks) ? (parsed.risks as unknown[]).filter((s) => typeof s === "string") as string[] : [];

  const { data: scoreRow, error: scoreError } = await sb
    .from("content_opportunity_scores")
    .insert({
      client_id: clientId,
      content_opportunity_id: opportunityId,
      ...dimensions,
      overall_score: overallScore,
      score_method: OPPORTUNITY_SCORE_METHOD,
      rationale,
      strengths,
      risks,
      provider: "anthropic",
      model: DEFAULT_AI_MODEL,
      created_by: access.userId,
    })
    .select("*")
    .single();
  if (scoreError) return json({ code: "INSERT_FAILED", message: scoreError.message }, 500);

  const { error: updateError } = await sb
    .from("content_opportunities")
    .update({ score: overallScore, score_method: OPPORTUNITY_SCORE_METHOD })
    .eq("id", opportunityId);
  if (updateError) {
    return json({ code: "POINTER_UPDATE_FAILED", message: updateError.message, score: scoreRow }, 500);
  }

  await audit(sb, "content_opportunity.scored", "content_opportunities", opportunityId, {
    client_id: clientId,
    overall_score: overallScore,
    score_id: scoreRow.id,
  });

  return json({ ok: true, content_opportunity_id: opportunityId, score: scoreRow }, 201);
});
