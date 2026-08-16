// Ideation nav consolidation, Phase 1: manual / proof-led content commit.
//
// Owned by the Ideation tab, not Content Supply — content_sources ingestion
// (ingest-content-source) is documented as never writing to the Calendar or
// production system, and that boundary is untouched here. This function lets
// an operator commit a manually-typed or proof-led idea straight to the
// operational Calendar (organic_master/story_master + calendar_cells),
// alongside — not through — the AI-generation candidate/scoring/proposal
// pipeline (client_ideation_candidates is provenance-locked to real AI runs
// and cannot honestly represent a manual entry).
//
// The single atomic RPC commit_manual_content does every write; this
// function only validates input and access.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

const ASSET_TYPES = new Set(["reel", "carousel", "static", "story"]);
const ORIGINS = new Set(["manual", "proof_led"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface CommitBody {
  client_id?: string;
  asset_type?: string;
  working_title?: string;
  hook?: string;
  core_message?: string;
  cta?: string;
  psychological_angle?: string | null;
  distribution_date?: string;
  origin?: string;
  content_source_id?: string | null;
}

function statusForRpcError(message: string): number {
  if (message.includes("FORBIDDEN")) return 403;
  if (message.includes("NOT_FOUND")) return 404;
  if (
    message.includes("ALREADY_COMMITTED") ||
    message.includes("KIND_MISMATCH") ||
    message.includes("PROOF_NOT_USABLE") ||
    message.includes("CALENDAR_CONFLICT")
  ) {
    return 409;
  }
  if (
    message.includes("REQUIRED_FIELD_MISSING") ||
    message.includes("INVALID_ORIGIN") ||
    message.includes("UNSUPPORTED_ASSET_TYPE")
  ) {
    return 400;
  }
  return 500;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: CommitBody;
  try {
    body = await req.json();
  } catch {
    return json({ code: "INVALID_JSON", message: "Request body must be JSON." }, 400);
  }

  const clientId = (body.client_id ?? "").trim();
  const assetType = (body.asset_type ?? "").trim();
  const workingTitle = (body.working_title ?? "").trim();
  const hook = (body.hook ?? "").trim();
  const coreMessage = (body.core_message ?? "").trim();
  const cta = (body.cta ?? "").trim();
  const psychologicalAngle = body.psychological_angle?.trim() || null;
  const distributionDate = (body.distribution_date ?? "").trim();
  const origin = (body.origin ?? "").trim();
  const contentSourceId = body.content_source_id?.trim() || null;

  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!ASSET_TYPES.has(assetType)) {
    return json({ code: "INVALID_ASSET_TYPE", allowed: [...ASSET_TYPES] }, 400);
  }
  if (!ORIGINS.has(origin)) {
    return json({ code: "INVALID_ORIGIN", allowed: [...ORIGINS] }, 400);
  }
  if (!DATE_PATTERN.test(distributionDate)) {
    return json({ code: "INVALID_DISTRIBUTION_DATE", message: "Expected YYYY-MM-DD." }, 400);
  }
  if (!workingTitle || !hook || !coreMessage || !cta) {
    return json({
      code: "REQUIRED_FIELD_MISSING",
      message: "working_title, hook, core_message and cta are all required.",
    }, 400);
  }
  if (origin === "proof_led" && !contentSourceId) {
    return json({
      code: "PROOF_SOURCE_REQUIRED",
      message: "A proof-led item must reference the content_sources row it came from.",
    }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) {
    return json({ code: access.code, message: access.message }, access.status);
  }

  const sb = svc();
  const { data, error } = await sb.rpc("commit_manual_content", {
    p_client_id: clientId,
    p_actor_id: access.userId,
    p_asset_type: assetType,
    p_working_title: workingTitle,
    p_hook: hook,
    p_core_message: coreMessage,
    p_cta: cta,
    p_psychological_angle: psychologicalAngle,
    p_distribution_date: distributionDate,
    p_origin: origin,
    p_content_source_id: contentSourceId,
  });

  if (error) {
    return json({ code: "COMMIT_FAILED", message: error.message }, statusForRpcError(error.message));
  }

  await audit(sb, "manual_content.committed", data.master_table as string, data.master_id as string, {
    client_id: clientId,
    ref: data.ref,
    asset_type: assetType,
    origin,
    content_source_id: contentSourceId,
  });

  return json(data, 201);
});
