// Phase 4B — Offers orchestration.
//
// Main Offers define the foundational commercial engine. Seasonal Offers adapt
// approved Main Offers around approved Campaign Intelligence periods. This
// function creates review-gated scaffolds only; it does not create content
// ideas, campaign periods, or unreviewed commercial facts.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";

type Action = "prepare" | "step" | "finalize";
type OfferType = "main" | "seasonal";
type ServiceClient = ReturnType<typeof svc>;

interface ResearchStepRow {
  id: string;
  client_id: string;
  research_run_id: string;
  step_key: string;
  step_order: number;
  title: string;
  status: string;
  attempt_count: number;
  maximum_attempts: number;
  failure_code: string | null;
  failure_message: string | null;
  output_summary: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
}

interface MainOfferRow {
  id: string;
  offer_name: string;
  offer_role: string;
  offer_stage: string;
  promised_outcome: string;
  mechanism: string;
  display_order: number;
}

interface CampaignPeriodRow {
  id: string;
  title: string;
  strategic_theme: string;
  timing_label: string;
  pain_point_salience: string[];
  desired_outcome: string;
  positioning_direction: string;
  campaign_objective: string;
  display_order: number;
}

interface SeasonalSelection {
  campaign_period_id?: string;
  main_offer_id?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compact(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n[truncated]`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 90) || "offer";
}

function cleanUuid(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function selectionFromSnapshot(snapshot: Record<string, unknown> | null | undefined): SeasonalSelection {
  const raw = snapshot?.seasonal_selection;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const selection = raw as Record<string, unknown>;
  return {
    campaign_period_id: typeof selection.campaign_period_id === "string" ? selection.campaign_period_id : undefined,
    main_offer_id: typeof selection.main_offer_id === "string" ? selection.main_offer_id : undefined,
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function stepProgress(sb: ServiceClient, researchRunId: string) {
  const { data, error } = await sb.from("client_research_steps")
    .select("status,attempt_count,maximum_attempts").eq("research_run_id", researchRunId);
  if (error) throw new Error(error.message);
  const steps = data ?? [];
  const completed = steps.filter((step) => step.status === "completed").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const recoverable = steps.some((step) =>
    step.status === "queued" ||
    step.status === "running" ||
    step.status === "waiting_provider" ||
    (step.status === "failed" && step.attempt_count < step.maximum_attempts)
  );
  return { completed, failed, total: steps.length, terminal: !recoverable };
}

async function loadMainAuthority(sb: ServiceClient, clientId: string) {
  const { data: inputs, error: inputError } = await sb.from("client_inputs")
    .select("offer_details,business_description,target_customer").eq("client_id", clientId).maybeSingle();
  if (inputError) return { ok: false as const, status: 500, message: inputError.message };
  const offerDetails = typeof inputs?.offer_details === "string" ? inputs.offer_details.trim() : "";
  if (!offerDetails) {
    return {
      ok: false as const,
      status: 409,
      code: "OFFER_DETAILS_REQUIRED",
      message: "Main Offers require saved offer_details before a reviewable offer architecture can be scaffolded.",
    };
  }

  const { data: brandPointer } = await sb.from("client_intelligence_active_releases")
    .select("release_id").eq("client_id", clientId).eq("intelligence_domain", "brand_strategist").maybeSingle();
  const { data: brandRelease } = brandPointer?.release_id
    ? await sb.from("client_intelligence_releases")
      .select("id,version,title,summary,approved_at").eq("client_id", clientId).eq("id", brandPointer.release_id).eq("status", "approved").maybeSingle()
    : { data: null };

  const authority = {
    offer_details: offerDetails,
    business_description: inputs?.business_description ?? null,
    target_customer: inputs?.target_customer ?? null,
    brand_strategist: brandRelease ?? null,
  };
  return {
    ok: true as const,
    authorityHash: await sha256(JSON.stringify(authority)),
    offerDetails,
    brandRelease: brandRelease ?? null,
  };
}

async function loadSeasonalAuthority(sb: ServiceClient, clientId: string, selection: SeasonalSelection) {
  const selectedCampaignPeriodId = cleanUuid(selection.campaign_period_id);
  const selectedMainOfferId = cleanUuid(selection.main_offer_id);
  if (!selectedCampaignPeriodId) {
    return {
      ok: false as const,
      status: 400,
      code: "CAMPAIGN_PERIOD_SELECTION_REQUIRED",
      message: "Seasonal Offers require selecting one approved Campaign Intelligence period.",
    };
  }
  if (!selectedMainOfferId) {
    return {
      ok: false as const,
      status: 400,
      code: "MAIN_OFFER_SELECTION_REQUIRED",
      message: "Seasonal Offers require selecting one approved Main Offer.",
    };
  }

  const { data: campaignPointer, error: campaignPointerError } = await sb.from("client_campaign_intelligence_active_releases")
    .select("release_id").eq("client_id", clientId).maybeSingle();
  if (campaignPointerError) return { ok: false as const, status: 500, message: campaignPointerError.message };
  if (!campaignPointer?.release_id) {
    return {
      ok: false as const,
      status: 409,
      code: "APPROVED_CAMPAIGN_INTELLIGENCE_REQUIRED",
      message: "Seasonal Offers require an approved active Campaign Intelligence release.",
    };
  }

  const { data: campaignRelease, error: campaignReleaseError } = await sb.from("client_campaign_intelligence_releases")
    .select("id,version,title,summary,approved_at").eq("client_id", clientId).eq("id", campaignPointer.release_id).eq("status", "approved").maybeSingle();
  if (campaignReleaseError || !campaignRelease) {
    return { ok: false as const, status: 409, code: "APPROVED_CAMPAIGN_INTELLIGENCE_REQUIRED", message: campaignReleaseError?.message ?? "Campaign Intelligence release is not approved." };
  }

  const { data: periods, error: periodError } = await sb.from("client_campaign_periods")
    .select("id,title,strategic_theme,timing_label,pain_point_salience,desired_outcome,positioning_direction,campaign_objective,display_order")
    .eq("client_id", clientId).eq("release_id", campaignRelease.id).order("display_order");
  if (periodError) return { ok: false as const, status: 500, message: periodError.message };
  if ((periods ?? []).length === 0) {
    return { ok: false as const, status: 409, code: "CAMPAIGN_PERIODS_REQUIRED", message: "Seasonal Offers require approved Campaign Intelligence periods." };
  }
  const selectedPeriod = (periods ?? []).find((period) => period.id === selectedCampaignPeriodId);
  if (!selectedPeriod) {
    return {
      ok: false as const,
      status: 409,
      code: "CAMPAIGN_PERIOD_SELECTION_INVALID",
      message: "Selected Campaign Intelligence period does not belong to the approved active Campaign Intelligence release.",
    };
  }

  const { data: mainPointer } = await sb.from("client_offer_architecture_active_releases")
    .select("release_id").eq("client_id", clientId).maybeSingle();
  const { data: mainRelease } = mainPointer?.release_id
    ? await sb.from("client_offer_architecture_releases")
      .select("id,version,title,summary,approved_at").eq("client_id", clientId).eq("id", mainPointer.release_id).eq("status", "approved").maybeSingle()
    : { data: null };
  if (!mainRelease) {
    return {
      ok: false as const,
      status: 409,
      code: "APPROVED_MAIN_OFFERS_REQUIRED",
      message: "Seasonal Offers require an approved active Main Offers release.",
    };
  }
  const mainOffers = mainRelease
    ? (await sb.from("client_main_offers")
      .select("id,offer_name,offer_role,offer_stage,promised_outcome,mechanism,display_order").eq("client_id", clientId).eq("release_id", mainRelease.id).order("display_order")).data ?? []
    : [];
  const selectedMainOffer = mainOffers.find((offer) => offer.id === selectedMainOfferId);
  if (!selectedMainOffer) {
    return {
      ok: false as const,
      status: 409,
      code: "MAIN_OFFER_SELECTION_INVALID",
      message: "Selected Main Offer does not belong to the approved active Main Offers release.",
    };
  }

  const authority = {
    campaign_release: campaignRelease,
    selected_campaign_period: selectedPeriod,
    main_offer_release: mainRelease,
    selected_main_offer: selectedMainOffer,
  };
  return {
    ok: true as const,
    authorityHash: await sha256(JSON.stringify(authority)),
    campaignRelease,
    periods: [selectedPeriod] as CampaignPeriodRow[],
    mainRelease,
    mainOffers: mainOffers as MainOfferRow[],
    selectedPeriod: selectedPeriod as CampaignPeriodRow,
    selectedMainOffer: selectedMainOffer as MainOfferRow,
    selection: {
      campaign_period_id: selectedCampaignPeriodId,
      main_offer_id: selectedMainOfferId,
    },
  };
}

async function fetchReleaseForRun(sb: ServiceClient, clientId: string, researchRunId: string, offerType: OfferType) {
  if (offerType === "main") {
    const { data, error } = await sb.from("client_offer_architecture_releases")
      .select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).maybeSingle();
    return { data, error };
  }
  const { data, error } = await sb.from("client_seasonal_offer_releases")
    .select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).maybeSingle();
  return { data, error };
}

async function prepare(sb: ServiceClient, clientId: string, userId: string, offerType: OfferType, selection: SeasonalSelection) {
  const authority = offerType === "main"
    ? await loadMainAuthority(sb, clientId)
    : await loadSeasonalAuthority(sb, clientId, selection);
  if (!authority.ok) return json({ ok: false, mode: "blocked", ...authority }, authority.status);

  const { data: openRuns, error: openError } = await sb.from("client_research_runs")
    .select("*").eq("client_id", clientId).eq("research_domain", "offer_system")
    .in("status", ["queued", "running", "waiting_provider", "failed"])
    .order("created_at", { ascending: false }).limit(10);
  if (openError) return json({ ok: false, mode: "blocked", message: openError.message }, 500);

  for (const run of openRuns ?? []) {
    if (run.prompt_digest !== authority.authorityHash || run.configuration_snapshot?.offer_type !== offerType) continue;
    const { data: release } = await fetchReleaseForRun(sb, clientId, run.id, offerType);
    if (!release || release.status === "needs_review") continue;
    const { data: steps, error: stepError } = await sb.from("client_research_steps")
      .select("*").eq("research_run_id", run.id).order("step_order");
    if (stepError) return json({ ok: false, mode: "blocked", message: stepError.message }, 500);
    const hasExhaustedFailure = (steps ?? []).some((step) => step.status === "failed" && step.attempt_count >= step.maximum_attempts);
    if (hasExhaustedFailure) continue;
    await sb.from("client_research_runs").update({ status: "queued", retryable: false, failure_code: null, failure_message: null }).eq("id", run.id);
    return json({ ok: true, mode: "resumed", message: `Resuming ${offerType} Offers.`, research_run_id: run.id, release_id: release.id, steps: steps ?? [] });
  }

  const seasonalSelection = "selection" in authority ? authority.selection : null;
  const releaseTable = offerType === "main" ? "client_offer_architecture_releases" : "client_seasonal_offer_releases";
  const { data: latestRelease, error: latestError } = await sb.from(releaseTable)
    .select("version").eq("client_id", clientId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (latestError) return json({ ok: false, mode: "blocked", message: latestError.message }, 500);
  const version = ((latestRelease as { version?: number } | null)?.version ?? 0) + 1;
  const idempotencyKey = `offer_system:${offerType}:${authority.authorityHash.slice(0, 40)}:v${version}`;
  const { data: run, error: runError } = await sb.from("client_research_runs").insert({
    client_id: clientId,
    research_domain: "offer_system",
    intelligence_domain: null,
    status: "queued",
    idempotency_key: idempotencyKey,
    provider: "system",
    model: `stage_4b_${offerType}_offers_scaffold`,
    prompt_digest: authority.authorityHash,
    configuration_snapshot: {
      offer_type: offerType,
      authority_hash: authority.authorityHash,
      seasonal_selection: seasonalSelection,
      output_contract: offerType === "main" ? "main_offers_and_money_model" : "seasonal_offer_packaging",
    },
    created_by: userId,
  }).select("*").single();
  if (runError) return json({ ok: false, mode: "blocked", message: runError.message }, 500);

  if (offerType === "main") {
    const { data: release, error: releaseError } = await sb.from("client_offer_architecture_releases").insert({
      client_id: clientId,
      version,
      status: "draft",
      research_run_id: run.id,
      title: `Main Offers v${version}`,
      summary: "Draft Main Offers architecture scaffolded from saved offer details. Human review is required before downstream use.",
      authority_snapshot: {
        authority_hash: authority.authorityHash,
        source: "client_inputs.offer_details",
        brand_strategist: authority.brandRelease,
        separation_of_concerns: { main_offers: "commercial_engine", excluded: ["campaign_intelligence", "seasonal_packaging", "content_ideation"] },
      },
      created_by: userId,
    }).select("*").single();
    if (releaseError) {
      await sb.from("client_research_runs").update({ status: "failed", failure_code: "RELEASE_CREATE_FAILED", failure_message: releaseError.message, retryable: false }).eq("id", run.id);
      return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
    }
    const { data: step, error: stepError } = await sb.from("client_research_steps").insert({
      client_id: clientId,
      research_run_id: run.id,
      step_key: "main_offer_architecture",
      step_order: 1,
      title: "Main offer architecture",
    }).select("*").single();
    if (stepError) return json({ ok: false, mode: "blocked", message: stepError.message }, 500);
    await audit(sb, "main_offers.prepared", "client_offer_architecture_releases", release.id, { client_id: clientId, research_run_id: run.id });
    return json({ ok: true, mode: "prepared", message: "Main Offers workflow prepared.", research_run_id: run.id, release_id: release.id, steps: [step] });
  }

  const { data: release, error: releaseError } = await sb.from("client_seasonal_offer_releases").insert({
    client_id: clientId,
    version,
    status: "draft",
    research_run_id: run.id,
    campaign_intelligence_release_id: authority.campaignRelease.id,
    main_offer_release_id: authority.mainRelease?.id ?? null,
    title: `Seasonal Offers v${version}`,
    summary: "Draft Seasonal Offers packaging scaffolded from approved Campaign Intelligence. Human review is required before downstream use.",
    authority_snapshot: {
      authority_hash: authority.authorityHash,
      campaign_intelligence_release: authority.campaignRelease,
      main_offer_release: authority.mainRelease,
      selected_campaign_period_id: authority.selection.campaign_period_id,
      selected_main_offer_id: authority.selection.main_offer_id,
      separation_of_concerns: { seasonal_offers: "contextual_packaging", excluded: ["campaign_calendar_generation", "main_offer_architecture_generation", "content_ideation"] },
    },
    created_by: userId,
  }).select("*").single();
  if (releaseError) {
    await sb.from("client_research_runs").update({ status: "failed", failure_code: "RELEASE_CREATE_FAILED", failure_message: releaseError.message, retryable: false }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
  }
  const { data: step, error: stepError } = await sb.from("client_research_steps").insert({
    client_id: clientId,
    research_run_id: run.id,
    step_key: "seasonal_offer_packaging",
    step_order: 1,
    title: "Seasonal offer packaging",
  }).select("*").single();
  if (stepError) return json({ ok: false, mode: "blocked", message: stepError.message }, 500);
  await audit(sb, "seasonal_offers.prepared", "client_seasonal_offer_releases", release.id, { client_id: clientId, research_run_id: run.id });
  return json({ ok: true, mode: "prepared", message: "Seasonal Offers workflow prepared.", research_run_id: run.id, release_id: release.id, steps: [step] });
}

async function runMainStep(sb: ServiceClient, clientId: string, releaseId: string, offerDetails: string) {
  const { error: moneyDeleteError } = await sb.from("client_money_model_components").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (moneyDeleteError) throw new Error(moneyDeleteError.message);
  const { error: offerDeleteError } = await sb.from("client_main_offers").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (offerDeleteError) throw new Error(offerDeleteError.message);

  const excerpt = compact(offerDetails, 3500);
  const { error: offerError } = await sb.from("client_main_offers").insert({
    client_id: clientId,
    release_id: releaseId,
    offer_key: "core_offer_architecture_review",
    offer_name: "Core offer architecture review",
    offer_role: "core_front_end",
    offer_stage: "foundational",
    customer_segment: "Review against approved Avatar OS before approval.",
    problem_addressed: "Review saved offer details and approved Intelligence before approval.",
    promised_outcome: "Human review required before any outcome claim is approved.",
    mechanism: "Review the delivery mechanism from saved offer details before approval.",
    dream_outcome: "Review the specific dream outcome from saved offer details and approved Avatar OS before approval.",
    perceived_likelihood: "Review proof, mechanism clarity, and eligibility before approving likelihood claims.",
    time_delay: "Human review required before promising speed, timeline, or time-to-result.",
    effort_sacrifice: "Review implementation burden, customer effort, handoff requirements, and operational trade-offs.",
    price_risk_friction: "Review price, payment terms, risk, switching cost, and decision friction before approval.",
    value_stack: ["review_required"],
    bonus_stack: ["review_required"],
    risk_reversal: "Human review required before risk reversal, guarantees, or assurances are approved.",
    guarantee: "Human review required before any guarantee or risk reversal is approved.",
    pricing_model: "Review saved offer details; do not infer pricing.",
    delivery_model: "Review saved offer details; do not infer delivery capacity.",
    eligibility: "Human review required before qualification criteria are approved.",
    proof_requirements: "Approved proof must support any claim before downstream use.",
    offer_sequence_note: "Review where this offer sits relative to upsells, downsells, continuity, and reactivation.",
    money_model_notes: "Review the wider economic engine before approving monetisation mechanics.",
    constraints: "No invented results, guarantees, scarcity, pricing, bonuses, upsells, downsells, or continuity mechanics.",
    payload: {
      source_offer_details_excerpt: excerpt,
      value_equation: {
        dream_outcome: "human_review_required",
        perceived_likelihood: "human_review_required",
        time_delay: "human_review_required",
        effort_sacrifice: "human_review_required",
      },
      money_model_scope: ["front_end", "upsell", "downsell", "continuity", "sequencing"],
      stage_4b_scaffold: true,
      human_review_required: true,
    },
    display_order: 1,
  });
  if (offerError) throw new Error(offerError.message);

  const components = [
    ["front_end_engine", "front_end", "Front-end economic engine review", "Clarify what is fundamentally sold and how the buying decision is made."],
    ["ascension_path", "offer_sequence", "Ascension path review", "Clarify upsells, downsells, or sequencing only where supported by approved commercial authority."],
    ["continuity_model", "continuity", "Continuity model review", "Clarify retention or recurring revenue mechanics only where supported."],
    ["risk_value_equation", "monetization_mechanic", "Value/risk equation review", "Review value stack, likelihood, time delay, effort, sacrifice, and claim boundaries before approval."],
  ];
  const { error: componentError } = await sb.from("client_money_model_components").insert(components.map(([componentKey, componentType, title, description], index) => ({
    client_id: clientId,
    release_id: releaseId,
    component_key: componentKey,
    component_type: componentType,
    title,
    description,
    trigger_condition: "Human review required.",
    commercial_role: "Commercial architecture scaffold.",
    dependency_note: "Must be reconciled with saved offer details and approved Intelligence before approval.",
    payload: { stage_4b_scaffold: true, human_review_required: true },
    display_order: index + 1,
  })));
  if (componentError) throw new Error(componentError.message);
  return { offer_count: 1, component_count: components.length };
}

async function runSeasonalStep(
  sb: ServiceClient,
  clientId: string,
  releaseId: string,
  periods: CampaignPeriodRow[],
  mainOffers: MainOfferRow[],
) {
  const { error: deleteError } = await sb.from("client_seasonal_offers").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (deleteError) throw new Error(deleteError.message);
  const linkedMainOffer = mainOffers[0];
  if (!linkedMainOffer) throw new Error("Selected approved Main Offer is required before Seasonal Offers can be scaffolded.");
  const { error: insertError } = await sb.from("client_seasonal_offers").insert(periods.map((period) => ({
    client_id: clientId,
    release_id: releaseId,
    campaign_period_id: period.id,
    main_offer_id: linkedMainOffer.id,
    seasonal_offer_key: `${slug(period.title)}_${period.display_order}`,
    title: `${period.title} offer packaging review`,
    campaign_period_title: period.title,
    offer_angle: compact(period.strategic_theme, 1000),
    packaging_direction: `Adapt "${linkedMainOffer.offer_name}" to this campaign context during human review.`,
    urgency_driver: "Review the timing context before approving any urgency or reason-to-act-now.",
    bonus_direction: "Human review required before bonuses or value-stack changes are approved.",
    positioning_direction: compact(period.positioning_direction || "Review positioning against Campaign Intelligence.", 2000),
    mechanism_direction: "Do not change the underlying delivery mechanism unless approved Main Offers support it.",
    reason_to_act_now: compact(period.campaign_objective || "Review why this moment should change action priority.", 2000),
    cta_direction: "Human review required before approving CTA, conversion path, or commercial ask.",
    offer_risk: "Risk review required: seasonal packaging cannot introduce unsupported urgency, guarantees, proof, pricing, or mechanism changes.",
    constraints: "No invented scarcity, guarantees, discounts, bonuses, pricing, deadlines, proof, or content ideas.",
    payload: {
      campaign_period: {
        id: period.id,
        timing_label: period.timing_label,
        pain_point_salience: period.pain_point_salience,
        desired_outcome: period.desired_outcome,
      },
      linked_main_offer: {
        id: linkedMainOffer.id,
        offer_name: linkedMainOffer.offer_name,
        offer_role: linkedMainOffer.offer_role,
        offer_stage: linkedMainOffer.offer_stage,
        promised_outcome: linkedMainOffer.promised_outcome,
        mechanism: linkedMainOffer.mechanism,
      },
      selected_campaign_period_id: period.id,
      selected_main_offer_id: linkedMainOffer.id,
      does_not_rewrite_main_offer: true,
      promotion_required_for_core_offer_changes: true,
      stage_4b_scaffold: true,
      human_review_required: true,
    },
    display_order: 1,
  })));
  if (insertError) throw new Error(insertError.message);
  return { seasonal_offer_count: periods.length, linked_main_offer_count: periods.length };
}

async function runStep(sb: ServiceClient, clientId: string, researchRunId: string, offerType: OfferType) {
  const { data: run, error: runError } = await sb.from("client_research_runs")
    .select("*").eq("id", researchRunId).eq("client_id", clientId).eq("research_domain", "offer_system").maybeSingle();
  if (runError || !run) return json({ ok: false, terminal: true, message: runError?.message ?? "Offers research run not found." }, 404);
  if (run.configuration_snapshot?.offer_type !== offerType) return json({ ok: false, terminal: true, message: "Offer type does not match the research run." }, 409);
  if (run.status === "completed" || run.status === "completed_partial" || run.status === "cancelled") {
    return json({ ok: true, terminal: true, message: "Offers research is already terminal.", research_run_id: researchRunId, progress: await stepProgress(sb, researchRunId) });
  }

  const { data: release, error: releaseError } = await fetchReleaseForRun(sb, clientId, researchRunId, offerType);
  if (releaseError || !release || release.status !== "draft") {
    return json({ ok: false, terminal: true, message: releaseError?.message ?? "Draft Offers release not found." }, 409);
  }

  const leaseOwner = `offers:${offerType}:${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await sb.rpc("claim_client_research_step", {
    p_research_run_id: researchRunId,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (claimError) return json({ ok: false, terminal: true, message: claimError.message, research_run_id: researchRunId }, 500);
  if (!claimed) {
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: progress.completed > 0 && progress.terminal, terminal: progress.terminal, message: progress.terminal ? "No recoverable Offers steps remain." : "Another worker owns the next Offers step.", research_run_id: researchRunId, release_id: release.id, progress });
  }

  const step = claimed as ResearchStepRow;
  await sb.from("client_research_runs").update({
    status: "running",
    started_at: run.started_at ?? new Date().toISOString(),
    retryable: false,
    failure_code: null,
    failure_message: null,
  }).eq("id", researchRunId);

  try {
    const authority = offerType === "main"
      ? await loadMainAuthority(sb, clientId)
      : await loadSeasonalAuthority(sb, clientId, selectionFromSnapshot(run.configuration_snapshot));
    if (!authority.ok) throw new Error(authority.message);
    if (run.prompt_digest !== authority.authorityHash) {
      throw new Error("Offers authority changed after this run began. Start a new run from the current authority.");
    }
    const outputSummary = offerType === "main"
      ? await runMainStep(sb, clientId, release.id, authority.offerDetails)
      : await runSeasonalStep(sb, clientId, release.id, authority.periods, authority.mainOffers);

    await sb.from("client_research_steps").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      output_summary: { ...outputSummary, scaffold: true },
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({ source_count: Object.values(outputSummary).reduce((total, value) => total + (typeof value === "number" ? value : 0), 0) }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: true, terminal: progress.terminal, message: `${offerType === "main" ? "Main" : "Seasonal"} Offers scaffold completed.`, research_run_id: researchRunId, release_id: release.id, progress });
  } catch (error) {
    const message = compact(errorMessage(error), 2000);
    await sb.from("client_research_steps").update({
      status: "failed",
      attempt_count: step.maximum_attempts,
      failure_code: "OFFERS_STEP_FAILED",
      failure_message: message,
      lease_owner: null,
      lease_expires_at: null,
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "OFFERS_STEP_FAILED",
      failure_message: message,
      retryable: false,
    }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: false, terminal: true, message, research_run_id: researchRunId, release_id: release.id, progress }, 500);
  }
}

async function finalize(sb: ServiceClient, clientId: string, researchRunId: string, offerType: OfferType) {
  const [runResult, releaseResult] = await Promise.all([
    sb.from("client_research_runs").select("*").eq("id", researchRunId).eq("client_id", clientId).eq("research_domain", "offer_system").maybeSingle(),
    fetchReleaseForRun(sb, clientId, researchRunId, offerType),
  ]);
  if (runResult.error || !runResult.data || releaseResult.error || !releaseResult.data) {
    return json({ ok: false, message: runResult.error?.message ?? releaseResult.error?.message ?? "Offers run or release not found." }, 404);
  }
  if (runResult.data.configuration_snapshot?.offer_type !== offerType) {
    return json({ ok: false, message: "Offer type does not match the research run." }, 409);
  }
  const progress = await stepProgress(sb, researchRunId);
  if (!progress.terminal || progress.completed === 0) {
    return json({ ok: false, message: "Offers cannot be finalised while recoverable work remains or no step completed.", progress }, 409);
  }
  const countQuery = offerType === "main"
    ? sb.from("client_main_offers").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("release_id", releaseResult.data.id)
    : sb.from("client_seasonal_offers").select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("release_id", releaseResult.data.id);
  const { count, error: countError } = await countQuery;
  if (countError) return json({ ok: false, message: countError.message }, 500);
  if ((count ?? 0) === 0) return json({ ok: false, message: "Offers release has no offer rows." }, 409);

  const now = new Date().toISOString();
  const status = progress.failed > 0 ? "completed_partial" : "completed";
  const updatePayload = {
    status: "needs_review",
    summary: offerType === "main"
      ? "Draft Main Offers architecture ready for human review. Downstream systems must only consume it after approval."
      : "Draft Seasonal Offers packaging ready for human review. Downstream systems must only consume it after approval.",
    generated_at: now,
    submitted_at: now,
  };
  const updateRelease = offerType === "main"
    ? sb.from("client_offer_architecture_releases").update(updatePayload).eq("id", releaseResult.data.id).select("*").single()
    : sb.from("client_seasonal_offer_releases").update(updatePayload).eq("id", releaseResult.data.id).select("*").single();
  const { data: updatedRelease, error: releaseUpdateError } = await updateRelease;
  if (releaseUpdateError) return json({ ok: false, message: releaseUpdateError.message }, 500);
  const { data: updatedRun, error: runUpdateError } = await sb.from("client_research_runs").update({
    status,
    completed_at: now,
    failure_code: progress.failed > 0 ? "OFFERS_PARTIAL" : null,
    failure_message: progress.failed > 0 ? `${progress.failed} Offers step(s) did not complete.` : null,
    retryable: false,
  }).eq("id", researchRunId).select("*").single();
  if (runUpdateError) return json({ ok: false, message: runUpdateError.message }, 500);
  await audit(sb, `${offerType === "main" ? "main_offers" : "seasonal_offers"}.submitted_for_review`, offerType === "main" ? "client_offer_architecture_releases" : "client_seasonal_offer_releases", updatedRelease.id, {
    client_id: clientId,
    research_run_id: researchRunId,
    offer_count: count,
  });
  return json({ ok: true, message: `${offerType === "main" ? "Main" : "Seasonal"} Offers are ready for human review.`, release: updatedRelease, run: updatedRun });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);

  let body: {
    action?: Action;
    offer_type?: OfferType;
    client_id?: string;
    research_run_id?: string;
    campaign_period_id?: string;
    main_offer_id?: string;
  };
  try { body = await req.json(); }
  catch { return json({ ok: false, message: "Invalid JSON body." }, 400); }
  const clientId = (body.client_id ?? "").trim();
  const action = body.action;
  const offerType = body.offer_type;
  if (!clientId) return json({ ok: false, message: "client_id is required." }, 400);
  if (!action || !new Set<Action>(["prepare", "step", "finalize"]).has(action)) {
    return json({ ok: false, message: "action must be prepare, step, or finalize." }, 400);
  }
  if (!offerType || !new Set<OfferType>(["main", "seasonal"]).has(offerType)) {
    return json({ ok: false, message: "offer_type must be main or seasonal." }, 400);
  }

  const access = await validateIntelligenceAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ ok: false, code: access.code, message: access.message }, access.status);
  const sb = svc();
  try {
    if (action === "prepare") {
      return await prepare(sb, clientId, access.userId, offerType, {
        campaign_period_id: body.campaign_period_id,
        main_offer_id: body.main_offer_id,
      });
    }
    const researchRunId = (body.research_run_id ?? "").trim();
    if (!researchRunId) return json({ ok: false, message: "research_run_id is required." }, 400);
    if (action === "step") return await runStep(sb, clientId, researchRunId, offerType);
    return await finalize(sb, clientId, researchRunId, offerType);
  } catch (error) {
    return json({ ok: false, message: errorMessage(error) }, 500);
  }
});
