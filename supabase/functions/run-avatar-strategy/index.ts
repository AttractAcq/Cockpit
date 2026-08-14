// Stage 5B — Avatar Strategy orchestration.
//
// Avatar Strategy defines whether and how an owned communication identity should
// exist for a client. This scaffold does not generate images, mimic existing IP,
// invent expertise, or produce content ideas. It creates review-gated strategic
// structure from approved upstream authority.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";

type Action = "prepare" | "step" | "finalize";
type ServiceClient = ReturnType<typeof svc>;

const REQUIRED_INTELLIGENCE_DOMAINS = ["market_os", "avatar_os", "brand_strategist"] as const;
const OPTIONAL_INTELLIGENCE_DOMAINS = ["competitor_os", "association_os"] as const;

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

interface AuthorityReleaseRef {
  domain: string;
  release_id: string;
  version: number;
  title: string;
  summary: string;
  approved_at: string | null;
}

interface AvatarAuthority {
  ok: true;
  authorityHash: string;
  clientInputs: {
    business_description: string | null;
    target_customer: string | null;
    offer_details: string | null;
    constraints_approval_rules: string | null;
  };
  requiredReleases: AuthorityReleaseRef[];
  optionalReleases: AuthorityReleaseRef[];
  campaignRelease: AuthorityReleaseRef | null;
  mainOfferRelease: AuthorityReleaseRef | null;
  seasonalOfferRelease: AuthorityReleaseRef | null;
}

interface BlockedAuthority {
  ok: false;
  status: number;
  code: string;
  message: string;
  missing_domains?: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compact(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n[truncated]`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

async function loadIntelligenceRelease(
  sb: ServiceClient,
  clientId: string,
  domain: string,
): Promise<AuthorityReleaseRef | null> {
  const { data: pointer, error: pointerError } = await sb.from("client_intelligence_active_releases")
    .select("release_id").eq("client_id", clientId).eq("intelligence_domain", domain).maybeSingle();
  if (pointerError || !pointer?.release_id) return null;

  const { data: release, error: releaseError } = await sb.from("client_intelligence_releases")
    .select("id,version,title,summary,approved_at")
    .eq("client_id", clientId).eq("id", pointer.release_id).eq("status", "approved").maybeSingle();
  if (releaseError || !release) return null;
  return {
    domain,
    release_id: release.id,
    version: release.version,
    title: release.title,
    summary: release.summary,
    approved_at: release.approved_at,
  };
}

async function loadReleaseFromPointer(
  sb: ServiceClient,
  clientId: string,
  pointerTable: string,
  releaseTable: string,
  domain: string,
): Promise<AuthorityReleaseRef | null> {
  const { data: pointer, error: pointerError } = await sb.from(pointerTable)
    .select("release_id").eq("client_id", clientId).maybeSingle();
  if (pointerError || !pointer?.release_id) return null;

  const { data: release, error: releaseError } = await sb.from(releaseTable)
    .select("id,version,title,summary,approved_at")
    .eq("client_id", clientId).eq("id", pointer.release_id).eq("status", "approved").maybeSingle();
  if (releaseError || !release) return null;
  return {
    domain,
    release_id: release.id,
    version: release.version,
    title: release.title,
    summary: release.summary,
    approved_at: release.approved_at,
  };
}

async function loadAvatarAuthority(sb: ServiceClient, clientId: string): Promise<AvatarAuthority | BlockedAuthority> {
  const { data: inputs, error: inputError } = await sb.from("client_inputs")
    .select("business_description,target_customer,offer_details,constraints_approval_rules")
    .eq("client_id", clientId).maybeSingle();
  if (inputError) {
    return { ok: false, status: 500, code: "AVATAR_CONTEXT_LOAD_FAILED", message: inputError.message };
  }

  const clientInputs = {
    business_description: stringOrNull(inputs?.business_description),
    target_customer: stringOrNull(inputs?.target_customer),
    offer_details: stringOrNull(inputs?.offer_details),
    constraints_approval_rules: stringOrNull(inputs?.constraints_approval_rules),
  };

  if (!clientInputs.business_description && !clientInputs.target_customer) {
    return {
      ok: false,
      status: 409,
      code: "AVATAR_CONTEXT_REQUIRED",
      message: "Avatar Strategy requires saved business_description or target_customer context before a reviewable communication identity can be scaffolded.",
    };
  }

  const requiredResults = await Promise.all(REQUIRED_INTELLIGENCE_DOMAINS.map((domain) =>
    loadIntelligenceRelease(sb, clientId, domain)
  ));
  const missingDomains = REQUIRED_INTELLIGENCE_DOMAINS.filter((_, index) => !requiredResults[index]);
  if (missingDomains.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_UPSTREAM_REQUIRED",
      message: "Avatar Strategy requires approved active Market OS, Intelligence Avatar OS, and Brand Strategist authority.",
      missing_domains: missingDomains,
    };
  }

  const optionalReleases = (await Promise.all(OPTIONAL_INTELLIGENCE_DOMAINS.map((domain) =>
    loadIntelligenceRelease(sb, clientId, domain)
  ))).filter((release): release is AuthorityReleaseRef => release !== null);

  const [campaignRelease, mainOfferRelease, seasonalOfferRelease] = await Promise.all([
    loadReleaseFromPointer(sb, clientId, "client_campaign_intelligence_active_releases", "client_campaign_intelligence_releases", "campaign_intelligence"),
    loadReleaseFromPointer(sb, clientId, "client_offer_architecture_active_releases", "client_offer_architecture_releases", "main_offers"),
    loadReleaseFromPointer(sb, clientId, "client_seasonal_offer_active_releases", "client_seasonal_offer_releases", "seasonal_offers"),
  ]);

  const authorityWithoutHash = {
    client_inputs: clientInputs,
    required_releases: requiredResults,
    optional_releases: optionalReleases,
    campaign_release: campaignRelease,
    main_offer_release: mainOfferRelease,
    seasonal_offer_release: seasonalOfferRelease,
    stage: "5B_avatar_strategy",
  };

  return {
    ok: true,
    authorityHash: await sha256(JSON.stringify(authorityWithoutHash)),
    clientInputs,
    requiredReleases: requiredResults.filter((release): release is AuthorityReleaseRef => release !== null),
    optionalReleases,
    campaignRelease,
    mainOfferRelease,
    seasonalOfferRelease,
  };
}

async function fetchReleaseForRun(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data, error } = await sb.from("client_avatar_releases")
    .select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).maybeSingle();
  return { data, error };
}

function releaseRefs(authority: AvatarAuthority): AuthorityReleaseRef[] {
  return [
    ...authority.requiredReleases,
    ...authority.optionalReleases,
    authority.campaignRelease,
    authority.mainOfferRelease,
    authority.seasonalOfferRelease,
  ].filter((release): release is AuthorityReleaseRef => release !== null);
}

async function prepare(sb: ServiceClient, clientId: string, userId: string) {
  const authority = await loadAvatarAuthority(sb, clientId);
  if (!authority.ok) return json({ ok: false, mode: "blocked", ...authority }, authority.status);

  const { data: openRuns, error: openError } = await sb.from("client_research_runs")
    .select("*").eq("client_id", clientId).eq("research_domain", "avatar_system")
    .in("status", ["queued", "running", "waiting_provider", "failed"])
    .order("created_at", { ascending: false }).limit(10);
  if (openError) return json({ ok: false, mode: "blocked", message: openError.message }, 500);

  for (const run of openRuns ?? []) {
    if (run.prompt_digest !== authority.authorityHash) continue;
    const { data: release } = await fetchReleaseForRun(sb, clientId, run.id);
    if (!release || release.status === "needs_review") continue;
    const { data: steps, error: stepError } = await sb.from("client_research_steps")
      .select("*").eq("research_run_id", run.id).order("step_order");
    if (stepError) return json({ ok: false, mode: "blocked", message: stepError.message }, 500);
    const hasExhaustedFailure = (steps ?? []).some((step) => step.status === "failed" && step.attempt_count >= step.maximum_attempts);
    if (hasExhaustedFailure) continue;
    await sb.from("client_research_runs").update({ status: "queued", retryable: false, failure_code: null, failure_message: null }).eq("id", run.id);
    return json({ ok: true, mode: "resumed", message: "Resuming Avatar Strategy.", research_run_id: run.id, release_id: release.id, steps: steps ?? [] });
  }

  const { data: latestRelease, error: latestError } = await sb.from("client_avatar_releases")
    .select("version").eq("client_id", clientId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (latestError) return json({ ok: false, mode: "blocked", message: latestError.message }, 500);
  const version = ((latestRelease as { version?: number } | null)?.version ?? 0) + 1;
  const idempotencyKey = `avatar_system:strategy:${authority.authorityHash.slice(0, 40)}:v${version}`;

  const { data: run, error: runError } = await sb.from("client_research_runs").insert({
    client_id: clientId,
    research_domain: "avatar_system",
    intelligence_domain: null,
    status: "queued",
    idempotency_key: idempotencyKey,
    provider: "system",
    model: "stage_5b_avatar_strategy_scaffold",
    prompt_digest: authority.authorityHash,
    configuration_snapshot: {
      authority_hash: authority.authorityHash,
      output_contract: "avatar_strategy",
      generation_scope: "strategy_only_no_media_generation",
      required_intelligence_domains: REQUIRED_INTELLIGENCE_DOMAINS,
    },
    created_by: userId,
  }).select("*").single();
  if (runError) return json({ ok: false, mode: "blocked", message: runError.message }, 500);

  const { data: release, error: releaseError } = await sb.from("client_avatar_releases").insert({
    client_id: clientId,
    version,
    status: "draft",
    research_run_id: run.id,
    title: `Avatar Strategy v${version}`,
    summary: "Draft Avatar Strategy scaffolded from approved Intelligence. Human review is required before downstream use.",
    authority_snapshot: {
      authority_hash: authority.authorityHash,
      required_releases: authority.requiredReleases,
      optional_releases: authority.optionalReleases,
      campaign_intelligence_release: authority.campaignRelease,
      main_offer_release: authority.mainOfferRelease,
      seasonal_offer_release: authority.seasonalOfferRelease,
      separation_of_concerns: {
        avatar_os: "owned_communication_identity_and_creative_world",
        proof: "substance",
        excluded: ["proof_replacement", "offer_generation", "content_ideation", "media_asset_generation"],
      },
    },
    created_by: userId,
  }).select("*").single();
  if (releaseError) {
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "AVATAR_RELEASE_CREATE_FAILED",
      failure_message: releaseError.message,
      retryable: false,
    }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
  }

  const { data: step, error: stepError } = await sb.from("client_research_steps").insert({
    client_id: clientId,
    research_run_id: run.id,
    step_key: "avatar_strategy",
    step_order: 1,
    title: "Avatar strategy",
  }).select("*").single();
  if (stepError) return json({ ok: false, mode: "blocked", message: stepError.message }, 500);

  await audit(sb, "avatar_os.prepared", "client_avatar_releases", release.id, {
    client_id: clientId,
    research_run_id: run.id,
    required_release_count: authority.requiredReleases.length,
  });
  return json({ ok: true, mode: "prepared", message: "Avatar Strategy workflow prepared.", research_run_id: run.id, release_id: release.id, steps: [step] });
}

async function runAvatarStrategyStep(sb: ServiceClient, clientId: string, releaseId: string, authority: AvatarAuthority) {
  const { error: assetDeleteError } = await sb.from("client_avatar_assets").delete()
    .eq("client_id", clientId).eq("release_id", releaseId);
  if (assetDeleteError) throw new Error(assetDeleteError.message);
  const { error: componentDeleteError } = await sb.from("client_avatar_components").delete()
    .eq("client_id", clientId).eq("release_id", releaseId);
  if (componentDeleteError) throw new Error(componentDeleteError.message);

  const inputSummary = [
    authority.clientInputs.business_description ? `Business context: ${compact(authority.clientInputs.business_description, 900)}` : null,
    authority.clientInputs.target_customer ? `Target customer: ${compact(authority.clientInputs.target_customer, 900)}` : null,
    authority.clientInputs.offer_details ? `Offer context exists and must be reviewed before commercial claims are approved.` : null,
    authority.clientInputs.constraints_approval_rules ? `Approval constraints exist and must govern downstream production.` : null,
  ].filter((item): item is string => item !== null);

  const refs = releaseRefs(authority);
  const { data: component, error: componentError } = await sb.from("client_avatar_components").insert({
    client_id: clientId,
    release_id: releaseId,
    component_type: "avatar_strategy",
    component_key: "avatar_strategy_review",
    title: "Avatar strategy review",
    summary: "Review whether an owned communication identity should exist for this client, what strategic role it should play, and which proof/rights boundaries must hold.",
    strategic_rationale: "Avatar OS is a delivery and familiarity layer. It should make proof, education, expertise, and recurring content more recognizable without replacing proof or becoming the whole brand.",
    evidence_summary: `Scaffolded from ${authority.requiredReleases.length} required approved Intelligence release(s): ${authority.requiredReleases.map((release) => release.title).join(", ")}. Human review must convert this scaffold into a concrete avatar concept before approval.`,
    structured_payload: {
      avatar_is_appropriate: "review_required",
      avatar_recommendation: "human_review_required",
      avatar_concept: "review_required",
      avatar_archetype: "review_required",
      role_within_brand: "owned_communication_identity",
      strategic_role: "Make approved proof, education, and expertise more relatable, recognizable, and repeatable.",
      audience_relationship: "review_required",
      personality_direction: "review_required",
      broad_identity: "review_required",
      icp_fit: "review_required",
      relatability_rationale: "review_required",
      proof_relationship: "Proof remains substance; avatar and creative identity are delivery.",
      education_role: "review_required",
      commercial_role: "Support trust, authority, attention, and conversion indirectly through stronger communication.",
      optional_content_level_usage: true,
      not_every_asset_should_use_avatar: true,
      no_media_generation_in_stage_5b: true,
      rights_safety_notes: [
        "Existing character references require legal and commercial rights review before use.",
        "Do not mimic protected characters, voices, likenesses, or branded worlds without approval.",
        "Original IP is the preferred durable route unless rights are explicitly secured.",
      ],
      downstream_usage_guidance: {
        ideation_optional: true,
        production_optional: true,
        script_generation: "Use only after approval and only within approved proof, knowledge, and voice boundaries.",
        image_video_generation: "Requires approved Appearance, Environment, Creative Direction, and Assets components in later stages.",
      },
      upstream_context_digest: inputSummary,
      stage_5b_scaffold: true,
      human_review_required: true,
    },
    upstream_refs: refs.map((release) => ({
      source_domain: release.domain,
      source_release_id: release.release_id,
      version: release.version,
      title: release.title,
      approved_at: release.approved_at,
      relationship: release.domain === "avatar_os" ? "icp_intelligence" : "strategic_context",
    })),
    generation_contract: {
      component_retry_supported: true,
      full_regeneration_supported: true,
      non_destructive_versioning_required: true,
      no_image_generation: true,
      no_voice_generation: true,
      no_invented_proof: true,
      no_invented_expertise: true,
      no_existing_character_ip_without_rights_review: true,
      downstream_authority_requires_approval: true,
    },
    display_order: 1,
  }).select("*").single();
  if (componentError) throw new Error(componentError.message);
  return { component_count: 1, asset_count: 0, avatar_strategy_component_id: component.id };
}

async function runStep(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data: run, error: runError } = await sb.from("client_research_runs")
    .select("*").eq("id", researchRunId).eq("client_id", clientId).eq("research_domain", "avatar_system").maybeSingle();
  if (runError || !run) return json({ ok: false, terminal: true, message: runError?.message ?? "Avatar Strategy research run not found." }, 404);
  if (run.status === "completed" || run.status === "completed_partial" || run.status === "cancelled") {
    return json({ ok: true, terminal: true, message: "Avatar Strategy research is already terminal.", research_run_id: researchRunId, progress: await stepProgress(sb, researchRunId) });
  }

  const { data: release, error: releaseError } = await fetchReleaseForRun(sb, clientId, researchRunId);
  if (releaseError || !release || release.status !== "draft") {
    return json({ ok: false, terminal: true, message: releaseError?.message ?? "Draft Avatar release not found." }, 409);
  }

  const leaseOwner = `avatar_strategy:${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await sb.rpc("claim_client_research_step", {
    p_research_run_id: researchRunId,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (claimError) return json({ ok: false, terminal: true, message: claimError.message, research_run_id: researchRunId }, 500);
  if (!claimed) {
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: progress.completed > 0 && progress.terminal, terminal: progress.terminal, message: progress.terminal ? "No recoverable Avatar Strategy steps remain." : "Another worker owns the next Avatar Strategy step.", research_run_id: researchRunId, release_id: release.id, progress });
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
    const authority = await loadAvatarAuthority(sb, clientId);
    if (!authority.ok) throw new Error(authority.message);
    if (run.prompt_digest !== authority.authorityHash) {
      throw new Error("Avatar Strategy authority changed after this run began. Start a new run from current approved authority.");
    }
    const outputSummary = await runAvatarStrategyStep(sb, clientId, release.id, authority);
    await sb.from("client_research_steps").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      output_summary: { ...outputSummary, scaffold: true },
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({
      source_count: outputSummary.component_count,
    }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: true, terminal: progress.terminal, message: "Avatar Strategy scaffold completed.", research_run_id: researchRunId, release_id: release.id, progress });
  } catch (error) {
    const message = compact(errorMessage(error), 2000);
    await sb.from("client_research_steps").update({
      status: "failed",
      attempt_count: step.maximum_attempts,
      failure_code: "AVATAR_STRATEGY_STEP_FAILED",
      failure_message: message,
      lease_owner: null,
      lease_expires_at: null,
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "AVATAR_STRATEGY_STEP_FAILED",
      failure_message: message,
      retryable: false,
    }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: false, terminal: true, message, research_run_id: researchRunId, release_id: release.id, progress }, 500);
  }
}

async function finalize(sb: ServiceClient, clientId: string, researchRunId: string) {
  const [runResult, releaseResult] = await Promise.all([
    sb.from("client_research_runs").select("*").eq("id", researchRunId).eq("client_id", clientId).eq("research_domain", "avatar_system").maybeSingle(),
    fetchReleaseForRun(sb, clientId, researchRunId),
  ]);
  if (runResult.error || !runResult.data || releaseResult.error || !releaseResult.data) {
    return json({ ok: false, message: runResult.error?.message ?? releaseResult.error?.message ?? "Avatar Strategy run or release not found." }, 404);
  }

  const progress = await stepProgress(sb, researchRunId);
  if (!progress.terminal || progress.completed === 0) {
    return json({ ok: false, message: "Avatar Strategy cannot be finalised while recoverable work remains or no step completed.", progress }, 409);
  }

  const { count, error: countError } = await sb.from("client_avatar_components")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId).eq("release_id", releaseResult.data.id).eq("component_type", "avatar_strategy");
  if (countError) return json({ ok: false, message: countError.message }, 500);
  if ((count ?? 0) === 0) return json({ ok: false, message: "Avatar release has no Avatar Strategy component." }, 409);

  const now = new Date().toISOString();
  const status = progress.failed > 0 ? "completed_partial" : "completed";
  const { data: updatedRelease, error: releaseUpdateError } = await sb.from("client_avatar_releases").update({
    status: "needs_review",
    summary: "Draft Avatar Strategy ready for human review. Downstream systems must only consume it after approval.",
    generated_at: now,
    submitted_at: now,
  }).eq("id", releaseResult.data.id).select("*").single();
  if (releaseUpdateError) return json({ ok: false, message: releaseUpdateError.message }, 500);

  const { data: updatedRun, error: runUpdateError } = await sb.from("client_research_runs").update({
    status,
    completed_at: now,
    failure_code: progress.failed > 0 ? "AVATAR_STRATEGY_PARTIAL" : null,
    failure_message: progress.failed > 0 ? `${progress.failed} Avatar Strategy step(s) did not complete.` : null,
    retryable: false,
  }).eq("id", researchRunId).select("*").single();
  if (runUpdateError) return json({ ok: false, message: runUpdateError.message }, 500);

  await audit(sb, "avatar_os.submitted_for_review", "client_avatar_releases", updatedRelease.id, {
    client_id: clientId,
    research_run_id: researchRunId,
    component_count: count,
  });
  return json({ ok: true, message: "Avatar Strategy is ready for human review.", release: updatedRelease, run: updatedRun });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);

  let body: {
    action?: Action;
    client_id?: string;
    research_run_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: "Invalid JSON body." }, 400);
  }

  const clientId = (body.client_id ?? "").trim();
  const action = body.action;
  if (!clientId) return json({ ok: false, message: "client_id is required." }, 400);
  if (!action || !new Set<Action>(["prepare", "step", "finalize"]).has(action)) {
    return json({ ok: false, message: "action must be prepare, step, or finalize." }, 400);
  }

  const access = await validateIntelligenceAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ ok: false, code: access.code, message: access.message }, access.status);
  const sb = svc();
  try {
    if (action === "prepare") return await prepare(sb, clientId, access.userId);
    const researchRunId = (body.research_run_id ?? "").trim();
    if (!researchRunId) return json({ ok: false, message: "research_run_id is required." }, 400);
    if (action === "step") return await runStep(sb, clientId, researchRunId);
    return await finalize(sb, clientId, researchRunId);
  } catch (error) {
    return json({ ok: false, message: errorMessage(error) }, 500);
  }
});
