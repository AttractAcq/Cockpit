// Programme Stage G — generate a proposed Calendar for a period: match the
// best eligible, scored Content Opportunity to every open Calendar Slot.
// Writes only content_calendar_proposals / content_calendar_proposal_slots.
// Nothing here touches Content Items, Calendar Slot status, or Opportunity
// status — the proposal is advisory until approve-calendar-proposal commits it.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import {
  pickBestMatch,
  buildMatchRationale,
  type MatchableOpportunity,
  type MatchableSlot,
  type MatchableRequirement,
} from "../_shared/calendar-planning.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; period_start?: string; period_end?: string; mode?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const periodStart = (body.period_start ?? "").trim();
  const periodEnd = (body.period_end ?? "").trim();
  const mode = (body.mode ?? "assisted").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!periodStart || !periodEnd || Number.isNaN(Date.parse(periodStart)) || Number.isNaN(Date.parse(periodEnd))) {
    return json({ code: "INVALID_PERIOD" }, 400);
  }
  if (Date.parse(periodEnd) < Date.parse(periodStart)) return json({ code: "INVALID_PERIOD" }, 400);
  if (!["manual", "assisted", "automatic"].includes(mode)) return json({ code: "INVALID_MODE" }, 400);
  if (mode === "automatic") {
    // "Cockpit commits only where client policy permits" — no such policy
    // configuration exists in the schema yet. Rather than guess a default,
    // fail closed and require assisted/manual until that policy exists.
    return json({
      code: "AUTOMATIC_MODE_NOT_AVAILABLE",
      message: "Automatic commit requires a client policy configuration that does not exist yet. Use assisted or manual mode.",
    }, 501);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: slots, error: slotsError } = await sb
    .from("calendar_slots")
    .select("id, content_requirement_id, scheduled_for, platform, objective, funnel_stage, audience_stage, preferred_source_type, required_proof_strength")
    .eq("client_id", clientId)
    .eq("status", "open")
    .eq("is_operational", true)
    .gte("scheduled_for", periodStart)
    .lte("scheduled_for", periodEnd)
    .order("scheduled_for");
  if (slotsError) return json({ code: "LOOKUP_FAILED", message: slotsError.message }, 500);
  if (!slots || slots.length === 0) {
    return json({ code: "NO_OPEN_SLOTS", message: "No open, operational Calendar Slots exist in this period." }, 409);
  }

  const requirementIds = [...new Set(slots.map((s) => s.content_requirement_id))];
  const { data: requirements, error: reqError } = await sb
    .from("content_requirements")
    .select("id, asset_format, channel")
    .in("id", requirementIds);
  if (reqError) return json({ code: "LOOKUP_FAILED", message: reqError.message }, 500);
  const requirementById = new Map((requirements ?? []).map((r) => [r.id, r]));

  // Candidate pool: eligible Opportunities not already committed and not
  // already claimed by another active (draft) proposal.
  const [oppsRes, scoresRes, claimedRes] = await Promise.all([
    sb.from("content_opportunities")
      .select("id, origin, audience, funnel_stage, candidate_formats, candidate_channels, visual_potential, production_requirements, expires_at, duplicate_of_opportunity_id, status")
      .eq("client_id", clientId)
      .eq("eligibility_status", "eligible")
      .in("status", ["shortlisted", "selected"]),
    sb.from("content_opportunity_scores")
      .select("content_opportunity_id, proof_strength, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    sb.from("content_calendar_proposal_slots")
      .select("content_opportunity_id, content_calendar_proposals!inner(status)")
      .eq("client_id", clientId)
      .eq("content_calendar_proposals.status", "draft")
      .not("content_opportunity_id", "is", null),
  ]);
  if (oppsRes.error) return json({ code: "LOOKUP_FAILED", message: oppsRes.error.message }, 500);
  if (scoresRes.error) return json({ code: "LOOKUP_FAILED", message: scoresRes.error.message }, 500);
  if (claimedRes.error) return json({ code: "LOOKUP_FAILED", message: claimedRes.error.message }, 500);

  const latestProofStrength = new Map<string, number>();
  for (const row of scoresRes.data ?? []) {
    if (!latestProofStrength.has(row.content_opportunity_id)) {
      latestProofStrength.set(row.content_opportunity_id, row.proof_strength);
    }
  }
  const alreadyClaimed = new Set(
    (claimedRes.data ?? [])
      .map((r) => r.content_opportunity_id as string | null)
      .filter((id): id is string => id !== null),
  );

  const candidates: MatchableOpportunity[] = (oppsRes.data ?? []).map((o) => ({
    id: o.id,
    origin: o.origin,
    audience: o.audience,
    funnel_stage: o.funnel_stage,
    candidate_formats: o.candidate_formats ?? [],
    candidate_channels: o.candidate_channels ?? [],
    visual_potential: o.visual_potential,
    production_requirements: o.production_requirements,
    expires_at: o.expires_at,
    duplicate_of_opportunity_id: o.duplicate_of_opportunity_id,
    proof_strength: latestProofStrength.get(o.id) ?? null,
  }));

  const { data: proposal, error: proposalError } = await sb
    .from("content_calendar_proposals")
    .insert({
      client_id: clientId,
      period_start: periodStart,
      period_end: periodEnd,
      status: "draft",
      mode,
      generated_at: new Date().toISOString(),
      created_by: access.userId,
    })
    .select("id, edit_revision")
    .single();
  if (proposalError) return json({ code: "INSERT_FAILED", message: proposalError.message }, 500);

  const claimedThisRun = new Set(alreadyClaimed);
  const slotRows: Array<Record<string, unknown>> = [];

  for (const slot of slots) {
    const requirement = requirementById.get(slot.content_requirement_id) as MatchableRequirement | undefined;
    if (!requirement) {
      slotRows.push({
        client_id: clientId, proposal_id: proposal.id, calendar_slot_id: slot.id,
        content_opportunity_id: null, conflict_status: "clear",
        match_rationale: "No matching content_requirement found for this slot.",
      });
      continue;
    }
    const matchableSlot: MatchableSlot = {
      platform: slot.platform, objective: slot.objective, funnel_stage: slot.funnel_stage,
      audience_stage: slot.audience_stage, preferred_source_type: slot.preferred_source_type as MatchableSlot["preferred_source_type"],
      required_proof_strength: slot.required_proof_strength as MatchableSlot["required_proof_strength"],
      scheduled_for: slot.scheduled_for,
    };
    const best = pickBestMatch(matchableSlot, requirement, candidates, claimedThisRun);
    if (mode === "manual" || !best) {
      slotRows.push({
        client_id: clientId, proposal_id: proposal.id, calendar_slot_id: slot.id,
        content_opportunity_id: null, conflict_status: "clear",
      });
      continue;
    }
    claimedThisRun.add(best.opportunity.id);
    slotRows.push({
      client_id: clientId, proposal_id: proposal.id, calendar_slot_id: slot.id,
      content_opportunity_id: best.opportunity.id,
      original_content_opportunity_id: best.opportunity.id,
      match_score: best.result.overallScore,
      match_rationale: buildMatchRationale(best.result),
      conflict_status: "clear",
      placement_source: "model",
    });
  }

  const { data: insertedSlots, error: slotsInsertError } = await sb
    .from("content_calendar_proposal_slots")
    .insert(slotRows)
    .select("*");
  if (slotsInsertError) {
    await sb.from("content_calendar_proposals").delete().eq("id", proposal.id);
    return json({ code: "SLOT_INSERT_FAILED", message: slotsInsertError.message }, 500);
  }

  await audit(sb, "content_calendar_proposal.created", "content_calendar_proposals", proposal.id, {
    client_id: clientId, period_start: periodStart, period_end: periodEnd, mode,
    slot_count: slots.length,
    assigned_count: slotRows.filter((r) => r.content_opportunity_id).length,
  });

  return json({
    ok: true,
    proposal_id: proposal.id,
    edit_revision: proposal.edit_revision,
    slots: insertedSlots,
    slot_count: slots.length,
    assigned_count: slotRows.filter((r) => r.content_opportunity_id).length,
  }, 201);
});
