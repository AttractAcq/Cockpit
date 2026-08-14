// Stage 5C — Avatar Appearance orchestration.
//
// Appearance translates an approved Avatar Strategy into structured visual
// identity rules. It creates no images and does not approve protected-character
// mimicry, demographic invention, or visual claims unsupported by strategy.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";

type Action = "prepare" | "step" | "finalize";
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

interface AvatarReleaseRow {
  id: string;
  client_id: string;
  version: number;
  status: string;
  research_run_id: string | null;
  title: string;
  summary: string;
  authority_snapshot: Record<string, unknown>;
  approved_at: string | null;
}

interface AvatarComponentRow {
  id: string;
  client_id: string;
  release_id: string;
  component_type: string;
  component_key: string;
  title: string;
  summary: string;
  strategic_rationale: string;
  evidence_summary: string;
  structured_payload: Record<string, unknown>;
  upstream_refs: unknown[];
  generation_contract: Record<string, unknown>;
  regenerates_component_id: string | null;
  display_order: number;
}

type AppearanceAuthority =
  | {
    ok: true;
    authorityHash: string;
    activeRelease: AvatarReleaseRow;
    strategyComponent: AvatarComponentRow;
  }
  | {
    ok: false;
    status: number;
    code: string;
    message: string;
  };

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

async function loadAppearanceAuthority(sb: ServiceClient, clientId: string): Promise<AppearanceAuthority> {
  const { data: pointer, error: pointerError } = await sb.from("client_avatar_active_releases")
    .select("release_id").eq("client_id", clientId).maybeSingle();
  if (pointerError) {
    return { ok: false, status: 500, code: "AVATAR_ACTIVE_RELEASE_LOAD_FAILED", message: pointerError.message };
  }
  if (!pointer?.release_id) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_STRATEGY_REQUIRED",
      message: "Avatar Appearance requires an approved active Avatar Strategy release.",
    };
  }

  const { data: activeRelease, error: releaseError } = await sb.from("client_avatar_releases")
    .select("*").eq("client_id", clientId).eq("id", pointer.release_id).eq("status", "approved").maybeSingle();
  if (releaseError || !activeRelease) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_STRATEGY_REQUIRED",
      message: releaseError?.message ?? "The active Avatar release is not approved.",
    };
  }

  const { data: strategyComponent, error: strategyError } = await sb.from("client_avatar_components")
    .select("*")
    .eq("client_id", clientId)
    .eq("release_id", activeRelease.id)
    .eq("component_type", "avatar_strategy")
    .order("display_order")
    .limit(1)
    .maybeSingle();
  if (strategyError || !strategyComponent) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_STRATEGY_REQUIRED",
      message: strategyError?.message ?? "Approved Avatar release has no Avatar Strategy component.",
    };
  }

  const authority = {
    active_release: {
      id: activeRelease.id,
      version: activeRelease.version,
      title: activeRelease.title,
      approved_at: activeRelease.approved_at,
      authority_snapshot: activeRelease.authority_snapshot,
    },
    strategy_component: {
      id: strategyComponent.id,
      component_key: strategyComponent.component_key,
      title: strategyComponent.title,
      summary: strategyComponent.summary,
      structured_payload: strategyComponent.structured_payload,
    },
    stage: "5C_avatar_appearance",
  };

  return {
    ok: true,
    authorityHash: await sha256(JSON.stringify(authority)),
    activeRelease: activeRelease as AvatarReleaseRow,
    strategyComponent: strategyComponent as AvatarComponentRow,
  };
}

async function fetchReleaseForRun(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data, error } = await sb.from("client_avatar_releases")
    .select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).maybeSingle();
  return { data, error };
}

function snapshotStrategyComponent(strategy: AvatarComponentRow, clientId: string, releaseId: string) {
  return {
    client_id: clientId,
    release_id: releaseId,
    component_type: "avatar_strategy",
    component_key: "avatar_strategy_approved_snapshot",
    title: strategy.title,
    summary: strategy.summary,
    strategic_rationale: strategy.strategic_rationale,
    evidence_summary: strategy.evidence_summary,
    structured_payload: {
      ...strategy.structured_payload,
      carried_forward_from_component_id: strategy.id,
      carried_forward_for_stage_5c: true,
    },
    upstream_refs: strategy.upstream_refs,
    generation_contract: {
      ...strategy.generation_contract,
      carried_forward_snapshot: true,
    },
    regenerates_component_id: strategy.id,
    display_order: 1,
  };
}

async function prepare(sb: ServiceClient, clientId: string, userId: string) {
  const authority = await loadAppearanceAuthority(sb, clientId);
  if (!authority.ok) return json({ ok: false, mode: "blocked", ...authority }, authority.status);

  const { data: openRuns, error: openError } = await sb.from("client_research_runs")
    .select("*")
    .eq("client_id", clientId)
    .eq("research_domain", "avatar_system")
    .eq("configuration_snapshot->>avatar_stage", "appearance")
    .in("status", ["queued", "running", "waiting_provider", "failed"])
    .order("created_at", { ascending: false })
    .limit(10);
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
    return json({ ok: true, mode: "resumed", message: "Resuming Avatar Appearance.", research_run_id: run.id, release_id: release.id, steps: steps ?? [] });
  }

  const { data: latestRelease, error: latestError } = await sb.from("client_avatar_releases")
    .select("version").eq("client_id", clientId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (latestError) return json({ ok: false, mode: "blocked", message: latestError.message }, 500);
  const version = ((latestRelease as { version?: number } | null)?.version ?? 0) + 1;

  const { data: run, error: runError } = await sb.from("client_research_runs").insert({
    client_id: clientId,
    research_domain: "avatar_system",
    intelligence_domain: null,
    status: "queued",
    idempotency_key: `avatar_system:appearance:${authority.authorityHash.slice(0, 40)}:v${version}`,
    provider: "system",
    model: "stage_5c_avatar_appearance_scaffold",
    prompt_digest: authority.authorityHash,
    configuration_snapshot: {
      avatar_stage: "appearance",
      authority_hash: authority.authorityHash,
      source_avatar_release_id: authority.activeRelease.id,
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      output_contract: "avatar_appearance",
      generation_scope: "structured_visual_identity_no_media_generation",
    },
    created_by: userId,
  }).select("*").single();
  if (runError) return json({ ok: false, mode: "blocked", message: runError.message }, 500);

  const { data: release, error: releaseError } = await sb.from("client_avatar_releases").insert({
    client_id: clientId,
    version,
    status: "draft",
    research_run_id: run.id,
    title: `Avatar Appearance v${version}`,
    summary: "Draft Appearance component scaffolded from approved Avatar Strategy. Human review is required before downstream media use.",
    authority_snapshot: {
      authority_hash: authority.authorityHash,
      source_avatar_release: {
        id: authority.activeRelease.id,
        version: authority.activeRelease.version,
        title: authority.activeRelease.title,
        approved_at: authority.activeRelease.approved_at,
      },
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      separation_of_concerns: {
        appearance: "visual_identity_rules",
        excluded: ["actual_image_generation", "voice_generation", "environment_generation", "content_ideation"],
      },
    },
    created_by: userId,
  }).select("*").single();
  if (releaseError) {
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "AVATAR_APPEARANCE_RELEASE_CREATE_FAILED",
      failure_message: releaseError.message,
      retryable: false,
    }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
  }

  const { data: step, error: stepError } = await sb.from("client_research_steps").insert({
    client_id: clientId,
    research_run_id: run.id,
    step_key: "avatar_appearance",
    step_order: 1,
    title: "Avatar appearance",
  }).select("*").single();
  if (stepError) return json({ ok: false, mode: "blocked", message: stepError.message }, 500);

  await audit(sb, "avatar_appearance.prepared", "client_avatar_releases", release.id, {
    client_id: clientId,
    research_run_id: run.id,
    source_avatar_release_id: authority.activeRelease.id,
  });
  return json({ ok: true, mode: "prepared", message: "Avatar Appearance workflow prepared.", research_run_id: run.id, release_id: release.id, steps: [step] });
}

async function runAppearanceStep(sb: ServiceClient, clientId: string, releaseId: string, authority: Extract<AppearanceAuthority, { ok: true }>) {
  const { error: assetDeleteError } = await sb.from("client_avatar_assets").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (assetDeleteError) throw new Error(assetDeleteError.message);
  const { error: componentDeleteError } = await sb.from("client_avatar_components").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (componentDeleteError) throw new Error(componentDeleteError.message);

  const { error: strategyCopyError } = await sb.from("client_avatar_components").insert(
    snapshotStrategyComponent(authority.strategyComponent, clientId, releaseId),
  );
  if (strategyCopyError) throw new Error(strategyCopyError.message);

  const strategyPayload = authority.strategyComponent.structured_payload;
  const concept = typeof strategyPayload.avatar_concept === "string" ? strategyPayload.avatar_concept : "review_required";
  const archetype = typeof strategyPayload.avatar_archetype === "string" ? strategyPayload.avatar_archetype : "review_required";
  const audienceRelationship = typeof strategyPayload.audience_relationship === "string" ? strategyPayload.audience_relationship : "review_required";

  const { data: appearance, error: appearanceError } = await sb.from("client_avatar_components").insert({
    client_id: clientId,
    release_id: releaseId,
    component_type: "appearance",
    component_key: "appearance_review",
    title: "Appearance review",
    summary: "Structured visual identity scaffold for the approved Avatar Strategy. Human review must convert review-required fields into canonical appearance rules before image generation.",
    strategic_rationale: "Appearance anchors recognition. It should make the communication identity reproducible across future image and video generation while staying aligned to ICP relatability, proof boundaries, and rights safety.",
    evidence_summary: `Generated from approved ${authority.activeRelease.title} and its Avatar Strategy component. No visual attributes are approved until reviewed.`,
    structured_payload: {
      appearance_is_ready_for_media_generation: false,
      source_avatar_release_id: authority.activeRelease.id,
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      visual_concept_alignment: concept,
      archetype_alignment: archetype,
      audience_relationship_alignment: audienceRelationship,
      face_direction: "review_required",
      apparent_age_direction: "review_required",
      body_type_direction: "review_required",
      hair_direction: "review_required",
      facial_hair_direction: "review_required",
      clothing_direction: "review_required",
      accessory_direction: "review_required",
      distinguishing_characteristics: ["review_required"],
      expression_set: ["neutral", "explaining", "curious", "confident", "lightly amused"],
      pose_set: ["direct-to-camera", "three-quarter explaining", "hands-visible teaching", "reaction pose"],
      canonical_visual_rules: ["review_required"],
      negative_prompt_boundaries: [
        "Do not mimic protected existing characters.",
        "Do not imply ethnicity, health, religion, politics, or other sensitive traits unless explicitly supplied and approved.",
        "Do not add logos, uniforms, credentials, or regulated professional markers unless approved.",
      ],
      reference_prompt_pack: {
        character_reference_prompt: "review_required",
        consistency_prompt: "review_required",
        wardrobe_prompt: "review_required",
        expression_prompt: "review_required",
      },
      regeneration_scope: {
        component_retry_supported: true,
        granular_retry_fields: [
          "face_direction",
          "clothing_direction",
          "accessory_direction",
          "expression_set",
          "pose_set",
          "reference_prompt_pack",
        ],
      },
      stage_5c_scaffold: true,
      human_review_required: true,
      no_media_generation_in_stage_5c: true,
    },
    upstream_refs: [
      {
        source_domain: "avatar_os",
        source_release_id: authority.activeRelease.id,
        source_component_id: authority.strategyComponent.id,
        relationship: "approved_avatar_strategy",
      },
    ],
    generation_contract: {
      component_retry_supported: true,
      full_regeneration_supported: true,
      non_destructive_versioning_required: true,
      no_image_generation: true,
      no_voice_generation: true,
      no_invented_sensitive_traits: true,
      no_existing_character_ip_without_rights_review: true,
      downstream_media_generation_requires_approval: true,
    },
    display_order: 2,
  }).select("*").single();
  if (appearanceError) throw new Error(appearanceError.message);
  return { component_count: 2, appearance_component_id: appearance.id, asset_count: 0 };
}

async function runStep(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data: run, error: runError } = await sb.from("client_research_runs")
    .select("*").eq("id", researchRunId).eq("client_id", clientId).eq("research_domain", "avatar_system").maybeSingle();
  if (runError || !run) return json({ ok: false, terminal: true, message: runError?.message ?? "Avatar Appearance research run not found." }, 404);
  if (run.configuration_snapshot?.avatar_stage !== "appearance") {
    return json({ ok: false, terminal: true, message: "Avatar Appearance stage does not match the research run." }, 409);
  }
  if (run.status === "completed" || run.status === "completed_partial" || run.status === "cancelled") {
    return json({ ok: true, terminal: true, message: "Avatar Appearance research is already terminal.", research_run_id: researchRunId, progress: await stepProgress(sb, researchRunId) });
  }

  const { data: release, error: releaseError } = await fetchReleaseForRun(sb, clientId, researchRunId);
  if (releaseError || !release || release.status !== "draft") {
    return json({ ok: false, terminal: true, message: releaseError?.message ?? "Draft Avatar Appearance release not found." }, 409);
  }

  const leaseOwner = `avatar_appearance:${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await sb.rpc("claim_client_research_step", {
    p_research_run_id: researchRunId,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (claimError) return json({ ok: false, terminal: true, message: claimError.message, research_run_id: researchRunId }, 500);
  if (!claimed) {
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: progress.completed > 0 && progress.terminal, terminal: progress.terminal, message: progress.terminal ? "No recoverable Avatar Appearance steps remain." : "Another worker owns the next Avatar Appearance step.", research_run_id: researchRunId, release_id: release.id, progress });
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
    const authority = await loadAppearanceAuthority(sb, clientId);
    if (!authority.ok) throw new Error(authority.message);
    if (run.prompt_digest !== authority.authorityHash) {
      throw new Error("Avatar Appearance authority changed after this run began. Start a new run from the current approved Avatar Strategy.");
    }
    const outputSummary = await runAppearanceStep(sb, clientId, release.id, authority);
    await sb.from("client_research_steps").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      output_summary: { ...outputSummary, scaffold: true },
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({ source_count: outputSummary.component_count }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: true, terminal: progress.terminal, message: "Avatar Appearance scaffold completed.", research_run_id: researchRunId, release_id: release.id, progress });
  } catch (error) {
    const message = compact(errorMessage(error), 2000);
    await sb.from("client_research_steps").update({
      status: "failed",
      attempt_count: step.maximum_attempts,
      failure_code: "AVATAR_APPEARANCE_STEP_FAILED",
      failure_message: message,
      lease_owner: null,
      lease_expires_at: null,
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "AVATAR_APPEARANCE_STEP_FAILED",
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
    return json({ ok: false, message: runResult.error?.message ?? releaseResult.error?.message ?? "Avatar Appearance run or release not found." }, 404);
  }
  if (runResult.data.configuration_snapshot?.avatar_stage !== "appearance") {
    return json({ ok: false, message: "Avatar Appearance stage does not match the research run." }, 409);
  }

  const progress = await stepProgress(sb, researchRunId);
  if (!progress.terminal || progress.completed === 0) {
    return json({ ok: false, message: "Avatar Appearance cannot be finalised while recoverable work remains or no step completed.", progress }, 409);
  }

  const { count: appearanceCount, error: appearanceCountError } = await sb.from("client_avatar_components")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId).eq("release_id", releaseResult.data.id).eq("component_type", "appearance");
  if (appearanceCountError) return json({ ok: false, message: appearanceCountError.message }, 500);
  if ((appearanceCount ?? 0) === 0) return json({ ok: false, message: "Avatar release has no Appearance component." }, 409);

  const now = new Date().toISOString();
  const status = progress.failed > 0 ? "completed_partial" : "completed";
  const { data: updatedRelease, error: releaseUpdateError } = await sb.from("client_avatar_releases").update({
    status: "needs_review",
    summary: "Draft Avatar Appearance ready for human review. Downstream media generation must only consume it after approval.",
    generated_at: now,
    submitted_at: now,
  }).eq("id", releaseResult.data.id).select("*").single();
  if (releaseUpdateError) return json({ ok: false, message: releaseUpdateError.message }, 500);

  const { data: updatedRun, error: runUpdateError } = await sb.from("client_research_runs").update({
    status,
    completed_at: now,
    failure_code: progress.failed > 0 ? "AVATAR_APPEARANCE_PARTIAL" : null,
    failure_message: progress.failed > 0 ? `${progress.failed} Avatar Appearance step(s) did not complete.` : null,
    retryable: false,
  }).eq("id", researchRunId).select("*").single();
  if (runUpdateError) return json({ ok: false, message: runUpdateError.message }, 500);

  await audit(sb, "avatar_appearance.submitted_for_review", "client_avatar_releases", updatedRelease.id, {
    client_id: clientId,
    research_run_id: researchRunId,
    appearance_count: appearanceCount,
  });
  return json({ ok: true, message: "Avatar Appearance is ready for human review.", release: updatedRelease, run: updatedRun });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);

  let body: { action?: Action; client_id?: string; research_run_id?: string };
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
