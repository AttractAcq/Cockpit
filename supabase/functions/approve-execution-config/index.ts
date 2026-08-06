// Programme Stage D runtime: human approval and deterministic derivation.
//
// This is the only path that turns a structured execution config into
// operational demand. It mirrors client_execution_configs_approval_check rather
// than trusting it alone: approval is refused unless reconciliation passed and
// a real human approver is recorded.
//
// On approval it derives content_requirements and calendar_slots from the
// config using the same pure functions the frontend and the contract tests use,
// so the plan the operator reviewed is exactly the plan that gets written.
//
// Derivation is idempotent. Requirements already derived for a config are never
// duplicated, and fulfilled_count on an existing requirement is never reset —
// re-running must not destroy delivery progress.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import {
  deriveContentRequirements,
  generateCalendarSlots,
  requirementKey,
  type ExecutionConfig,
} from "../../../src/types/execution-config.ts";

const APPROVER_FUNCTION = "approve-execution-config";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { execution_config_id?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }
  const configId = (body.execution_config_id ?? "").trim();
  if (!configId) return json({ code: "EXECUTION_CONFIG_ID_REQUIRED" }, 400);

  const sb = svc();

  const { data: cfg, error: cfgErr } = await sb
    .from("client_execution_configs")
    .select("id, client_id, execution_month, config_version, status, config, reconciliation_status")
    .eq("id", configId)
    .maybeSingle();
  if (cfgErr) return json({ code: "LOOKUP_FAILED", message: cfgErr.message }, 500);
  if (!cfg) return json({ code: "EXECUTION_CONFIG_NOT_FOUND" }, 404);

  // Authorise against the config's own client, so a caller cannot approve
  // across a tenant boundary by supplying someone else's config id.
  const access = await validateIdeationAccess(req.headers.get("Authorization"), cfg.client_id as string);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  if (cfg.status === "approved") {
    return json({
      already_approved: true,
      execution_config_id: configId,
      message: "This config is already approved.",
    }, 200);
  }
  if (cfg.status === "superseded" || cfg.status === "rejected") {
    return json({
      code: "CONFIG_NOT_APPROVABLE",
      message: `A ${cfg.status} config cannot be approved. Generate a new one from current authority.`,
    }, 409);
  }
  if (cfg.reconciliation_status !== "passed") {
    return json({
      code: "RECONCILIATION_NOT_PASSED",
      message: "The structured config contradicts the approved Execution files. Resolve the blocking checks and regenerate before approving.",
      reconciliation_status: cfg.reconciliation_status,
    }, 409);
  }

  const clientId = cfg.client_id as string;
  const month = cfg.execution_month as string;
  const config = cfg.config as ExecutionConfig;
  const now = new Date().toISOString();

  // Only one approved config may exist per client and month
  // (client_execution_configs_single_approved). Supersede the incumbent first.
  const { data: incumbents, error: incErr } = await sb
    .from("client_execution_configs")
    .select("id")
    .eq("client_id", clientId).eq("execution_month", month).eq("status", "approved");
  if (incErr) return json({ code: "LOOKUP_FAILED", message: incErr.message }, 500);

  const supersededIds = (incumbents ?? []).map((r) => r.id as string);
  if (supersededIds.length > 0) {
    const { error: supErr } = await sb
      .from("client_execution_configs")
      .update({ status: "superseded", updated_at: now })
      .in("id", supersededIds);
    if (supErr) return json({ code: "SUPERSEDE_FAILED", message: supErr.message }, 500);

    // A superseded plan must stop driving production, but its history stays
    // readable. Only untouched slots are stood down: a reserved or filled slot
    // represents committed work and is left exactly as it is.
    const { data: oldReqs } = await sb
      .from("content_requirements").select("id").in("execution_config_id", supersededIds);
    const oldReqIds = (oldReqs ?? []).map((r) => r.id as string);
    if (oldReqIds.length > 0) {
      const { error: deactErr } = await sb
        .from("calendar_slots")
        .update({ is_operational: false, updated_at: now })
        .in("content_requirement_id", oldReqIds)
        .eq("status", "open");
      if (deactErr) return json({ code: "DEACTIVATE_FAILED", message: deactErr.message }, 500);
    }
  }

  const { error: approveErr } = await sb
    .from("client_execution_configs")
    .update({
      status: "approved",
      approved_by: access.userId,
      approved_at: now,
      supersedes_config_id: supersededIds[0] ?? null,
      updated_at: now,
    })
    .eq("id", configId);
  if (approveErr) {
    // The database approval check is the real gate; surface its refusal plainly.
    return json({ code: "APPROVAL_REJECTED", message: approveErr.message }, 409);
  }

  // --- deterministic derivation -------------------------------------------
  const derivedRequirements = deriveContentRequirements(config, cfg.config_version as number);
  const derivedSlots = generateCalendarSlots(config, true);

  // Idempotent: if this config already has requirements, derivation ran before.
  const { data: alreadyDerived, error: derivedErr } = await sb
    .from("content_requirements")
    .select("id, platform, channel, asset_format")
    .eq("execution_config_id", configId);
  if (derivedErr) return json({ code: "LOOKUP_FAILED", message: derivedErr.message }, 500);

  const requirementIdByKey = new Map<string, string>();
  for (const row of alreadyDerived ?? []) {
    requirementIdByKey.set(
      requirementKey({
        platform: row.platform as string,
        channel: row.channel as string,
        asset_format: row.asset_format as string,
      }),
      row.id as string,
    );
  }

  const missing = derivedRequirements.filter((r) => !requirementIdByKey.has(requirementKey(r)));
  if (missing.length > 0) {
    const { data: insertedReqs, error: reqErr } = await sb
      .from("content_requirements")
      .insert(missing.map((r) => ({
        client_id: clientId,
        execution_config_id: configId,
        period_start: r.period_start,
        period_end: r.period_end,
        platform: r.platform,
        asset_format: r.asset_format,
        channel: r.channel,
        required_count: r.required_count,
        cadence: r.cadence,
        objective_mix: r.objective_mix,
        preferred_origins: r.preferred_origins,
        requirement_set_version: r.requirement_set_version,
        execution_version: cfg.config_version as number,
      })))
      .select("id, platform, channel, asset_format");
    if (reqErr) return json({ code: "REQUIREMENT_INSERT_FAILED", message: reqErr.message }, 500);
    for (const row of insertedReqs ?? []) {
      requirementIdByKey.set(
        requirementKey({
          platform: row.platform as string,
          channel: row.channel as string,
          asset_format: row.asset_format as string,
        }),
        row.id as string,
      );
    }
  }

  // Slot identity is (content_requirement_id, scheduled_for, slot_index), a
  // real unique constraint, so this upsert is safe to repeat.
  const slotRows = derivedSlots.map((s) => {
    const reqId = requirementIdByKey.get(s.requirement_key);
    return reqId
      ? {
        client_id: clientId,
        content_requirement_id: reqId,
        scheduled_for: s.scheduled_for,
        slot_index: s.slot_index,
        platform: s.platform,
        objective: s.objective,
        content_pillar: s.content_pillar,
        funnel_stage: s.funnel_stage,
        audience_stage: s.audience_stage,
        offer_ref: s.offer_ref,
        preferred_source_type: s.preferred_source_type,
        required_proof_strength: s.required_proof_strength,
        production_constraints: s.production_constraints,
        approval_policy: s.approval_policy,
        is_operational: true,
      }
      : null;
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  if (slotRows.length !== derivedSlots.length) {
    return json({
      code: "SLOT_REQUIREMENT_UNRESOLVED",
      message: "A generated slot did not resolve to a requirement. No slots were written.",
    }, 500);
  }

  const { error: slotErr } = await sb
    .from("calendar_slots")
    .upsert(slotRows, { onConflict: "content_requirement_id,scheduled_for,slot_index" });
  if (slotErr) return json({ code: "SLOT_UPSERT_FAILED", message: slotErr.message }, 500);

  await audit(sb, "execution_config.approved", "client_execution_configs", configId, {
    client_id: clientId,
    execution_month: month,
    approved_by: access.userId,
    requirements: derivedRequirements.length,
    slots: derivedSlots.length,
    superseded: supersededIds,
    approver_function: APPROVER_FUNCTION,
  });

  return json({
    execution_config_id: configId,
    status: "approved",
    execution_month: month,
    config_version: cfg.config_version,
    superseded_config_ids: supersededIds,
    requirements_derived: derivedRequirements.length,
    requirements_created: missing.length,
    slots_written: slotRows.length,
    slots_operational: true,
  }, 200);
});
