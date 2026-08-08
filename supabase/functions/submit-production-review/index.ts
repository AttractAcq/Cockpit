// Programme Stage I — submit a Review against a Production Job. The checks
// with a real, checkable signal (CTA presence, proof accuracy) are always
// server-computed, never trusted from the client — the rest (spelling,
// brand alignment, etc.) accept the operator's manual assessment, since no
// automated signal for them exists yet (see the Stage I implementation
// report).

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import {
  checkCtaPresent,
  checkProofAccuracy,
  QUALITY_CHECK_TYPES,
  type QualityCheckResult,
  type QualityCheckType,
} from "../_shared/production-studio.ts";

type Decision = "approved" | "changes_requested" | "rejected";
const VALID_DECISIONS: readonly Decision[] = ["approved", "changes_requested", "rejected"];

interface StructuredBriefLike {
  cta: string;
  proof_required: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string;
    production_job_id?: string;
    content_item_asset_id?: string;
    decision?: string;
    notes?: string;
    manual_checks?: Array<{ check?: string; passed?: boolean; detail?: string }>;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const jobId = (body.production_job_id ?? "").trim();
  const decision = (body.decision ?? "").trim() as Decision;
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!jobId) return json({ code: "PRODUCTION_JOB_ID_REQUIRED" }, 400);
  if (!VALID_DECISIONS.includes(decision)) {
    return json({ code: "INVALID_DECISION", message: `decision must be one of: ${VALID_DECISIONS.join(", ")}` }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: job, error: jobError } = await sb
    .from("production_jobs")
    .select("id, client_id, content_item_id, content_brief_id")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) return json({ code: "LOOKUP_FAILED", message: jobError.message }, 500);
  if (!job) return json({ code: "PRODUCTION_JOB_NOT_FOUND" }, 404);
  if (job.client_id !== clientId) return json({ code: "CROSS_CLIENT_PRODUCTION_JOB" }, 403);

  const assetId = (body.content_item_asset_id ?? "").trim() || null;
  if (assetId) {
    const { data: asset, error: assetError } = await sb
      .from("content_item_assets")
      .select("id, client_id, production_job_id")
      .eq("id", assetId)
      .maybeSingle();
    if (assetError) return json({ code: "LOOKUP_FAILED", message: assetError.message }, 500);
    if (!asset || asset.client_id !== clientId || asset.production_job_id !== jobId) {
      return json({ code: "ASSET_NOT_IN_JOB" }, 409);
    }
  }

  const checks: QualityCheckResult[] = [];

  if (job.content_brief_id) {
    const { data: brief } = await sb
      .from("content_briefs")
      .select("body")
      .eq("id", job.content_brief_id)
      .maybeSingle();
    if (brief) {
      const structured = brief.body as StructuredBriefLike;
      checks.push(checkCtaPresent(structured.cta));

      const { data: item } = await sb
        .from("content_items")
        .select("content_opportunity_id")
        .eq("id", job.content_item_id)
        .maybeSingle();

      let verifiedCount = 0;
      if (item?.content_opportunity_id) {
        const { data: sourceLinks } = await sb
          .from("content_opportunity_sources")
          .select("content_source_id")
          .eq("content_opportunity_id", item.content_opportunity_id);
        const sourceIds = (sourceLinks ?? []).map((r) => r.content_source_id);
        if (sourceIds.length > 0) {
          const { count } = await sb
            .from("proof_items")
            .select("id", { count: "exact", head: true })
            .eq("verification_status", "verified")
            .in("content_source_id", sourceIds);
          verifiedCount = count ?? 0;
        }
      }
      checks.push(checkProofAccuracy(structured.proof_required === true, verifiedCount));
    }
  }

  // Manual checks for the dimensions with no automated signal yet — recorded
  // as-supplied, clearly distinguishable from the server-computed ones above
  // by the caller inspecting which QUALITY_CHECK_TYPES appear twice.
  for (const manual of body.manual_checks ?? []) {
    if (typeof manual.check !== "string" || !QUALITY_CHECK_TYPES.includes(manual.check as QualityCheckType)) continue;
    if (typeof manual.passed !== "boolean") continue;
    checks.push({ check: manual.check as QualityCheckType, passed: manual.passed, detail: manual.detail ?? "" });
  }

  const { data: review, error: insertError } = await sb
    .from("production_reviews")
    .insert({
      client_id: clientId,
      production_job_id: jobId,
      content_item_asset_id: assetId,
      reviewer_id: access.userId,
      decision,
      notes: body.notes ?? null,
      quality_checks: checks,
    })
    .select("*")
    .single();
  if (insertError) return json({ code: "INSERT_FAILED", message: insertError.message }, 500);

  await audit(sb, "production_review.submitted", "production_reviews", review.id, {
    client_id: clientId, production_job_id: jobId, decision,
    server_computed_check_count: checks.length - (body.manual_checks?.length ?? 0),
  });

  return json({ ok: true, review }, 201);
});
