// Stage 5C — Avatar Environment, Voice, and Creative Direction orchestration.
//
// Avatar World defines where the approved avatar appears, how it sounds or
// behaves, and the repeatable audiovisual grammar around avatar-led content.
// It requires approved Strategy and Appearance, carries them forward, and adds
// Environment, Voice & Personality, and Creative Direction components. It
// generates no images, video, audio, voices, scripts, or content ideas.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";

type Action = "prepare" | "step" | "finalize";
type ServiceClient = ReturnType<typeof svc>;
type RequiredComponentType = "avatar_strategy" | "appearance";

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

type WorldAuthority =
  | {
    ok: true;
    authorityHash: string;
    activeRelease: AvatarReleaseRow;
    strategyComponent: AvatarComponentRow;
    appearanceComponent: AvatarComponentRow;
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

function payloadText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : "review_required";
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

async function loadComponent(
  sb: ServiceClient,
  clientId: string,
  releaseId: string,
  componentType: RequiredComponentType,
): Promise<AvatarComponentRow | null> {
  const { data, error } = await sb.from("client_avatar_components")
    .select("*")
    .eq("client_id", clientId)
    .eq("release_id", releaseId)
    .eq("component_type", componentType)
    .order("display_order")
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as AvatarComponentRow;
}

async function loadWorldAuthority(sb: ServiceClient, clientId: string): Promise<WorldAuthority> {
  const { data: pointer, error: pointerError } = await sb.from("client_avatar_active_releases")
    .select("release_id").eq("client_id", clientId).maybeSingle();
  if (pointerError) {
    return { ok: false, status: 500, code: "AVATAR_ACTIVE_RELEASE_LOAD_FAILED", message: pointerError.message };
  }
  if (!pointer?.release_id) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_APPEARANCE_REQUIRED",
      message: "Avatar World requires an approved active Avatar release with Strategy and Appearance.",
    };
  }

  const { data: activeRelease, error: releaseError } = await sb.from("client_avatar_releases")
    .select("*").eq("client_id", clientId).eq("id", pointer.release_id).eq("status", "approved").maybeSingle();
  if (releaseError || !activeRelease) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_APPEARANCE_REQUIRED",
      message: releaseError?.message ?? "The active Avatar release is not approved.",
    };
  }

  const [strategyComponent, appearanceComponent] = await Promise.all([
    loadComponent(sb, clientId, activeRelease.id, "avatar_strategy"),
    loadComponent(sb, clientId, activeRelease.id, "appearance"),
  ]);
  if (!strategyComponent || !appearanceComponent) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_APPEARANCE_REQUIRED",
      message: "Avatar World requires approved Strategy and Appearance components before Environment or Voice can be scaffolded.",
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
      structured_payload: strategyComponent.structured_payload,
    },
    appearance_component: {
      id: appearanceComponent.id,
      component_key: appearanceComponent.component_key,
      structured_payload: appearanceComponent.structured_payload,
    },
    stage: "5C_avatar_world_and_creative_direction",
  };

  return {
    ok: true,
    authorityHash: await sha256(JSON.stringify(authority)),
    activeRelease: activeRelease as AvatarReleaseRow,
    strategyComponent,
    appearanceComponent,
  };
}

async function fetchReleaseForRun(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data, error } = await sb.from("client_avatar_releases")
    .select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).maybeSingle();
  return { data, error };
}

function snapshotComponent(
  component: AvatarComponentRow,
  clientId: string,
  releaseId: string,
  componentKey: string,
  displayOrder: number,
) {
  return {
    client_id: clientId,
    release_id: releaseId,
    component_type: component.component_type,
    component_key: componentKey,
    title: component.title,
    summary: component.summary,
    strategic_rationale: component.strategic_rationale,
    evidence_summary: component.evidence_summary,
    structured_payload: {
      ...component.structured_payload,
      carried_forward_from_component_id: component.id,
      carried_forward_for_stage_5c: true,
    },
    upstream_refs: component.upstream_refs,
    generation_contract: {
      ...component.generation_contract,
      carried_forward_snapshot: true,
    },
    regenerates_component_id: component.id,
    display_order: displayOrder,
  };
}

async function prepare(sb: ServiceClient, clientId: string, userId: string) {
  const authority = await loadWorldAuthority(sb, clientId);
  if (!authority.ok) return json({ ok: false, mode: "blocked", ...authority }, authority.status);

  const { data: openRuns, error: openError } = await sb.from("client_research_runs")
    .select("*")
    .eq("client_id", clientId)
    .eq("research_domain", "avatar_system")
    .eq("configuration_snapshot->>avatar_stage", "world")
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
    return json({ ok: true, mode: "resumed", message: "Resuming Avatar World.", research_run_id: run.id, release_id: release.id, steps: steps ?? [] });
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
    idempotency_key: `avatar_system:world:${authority.authorityHash.slice(0, 40)}:v${version}`,
    provider: "system",
    model: "stage_5c_avatar_world_scaffold",
    prompt_digest: authority.authorityHash,
    configuration_snapshot: {
      avatar_stage: "world",
      authority_hash: authority.authorityHash,
      source_avatar_release_id: authority.activeRelease.id,
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      source_avatar_appearance_component_id: authority.appearanceComponent.id,
      output_contract: "avatar_environment_voice_personality_and_creative_direction",
      generation_scope: "structured_world_voice_and_creative_direction_no_media_or_script_generation",
    },
    created_by: userId,
  }).select("*").single();
  if (runError) return json({ ok: false, mode: "blocked", message: runError.message }, 500);

  const { data: release, error: releaseError } = await sb.from("client_avatar_releases").insert({
    client_id: clientId,
    version,
    status: "draft",
    research_run_id: run.id,
    title: `Avatar World v${version}`,
    summary: "Draft Environment, Voice & Personality, and Creative Direction components scaffolded from approved Avatar Strategy and Appearance. Human review is required before downstream media or scripting use.",
    authority_snapshot: {
      authority_hash: authority.authorityHash,
      source_avatar_release: {
        id: authority.activeRelease.id,
        version: authority.activeRelease.version,
        title: authority.activeRelease.title,
        approved_at: authority.activeRelease.approved_at,
      },
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      source_avatar_appearance_component_id: authority.appearanceComponent.id,
      separation_of_concerns: {
        environment: "recurring_visual_world",
        voice_personality: "communication_behaviour",
        creative_direction: "visual_and_audiovisual_grammar",
        excluded: ["actual_media_generation", "voice_cloning", "script_generation", "content_ideation"],
      },
    },
    created_by: userId,
  }).select("*").single();
  if (releaseError) {
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "AVATAR_WORLD_RELEASE_CREATE_FAILED",
      failure_message: releaseError.message,
      retryable: false,
    }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
  }

  const { data: step, error: stepError } = await sb.from("client_research_steps").insert({
    client_id: clientId,
    research_run_id: run.id,
    step_key: "avatar_world",
    step_order: 1,
    title: "Avatar environment, voice, and creative direction",
  }).select("*").single();
  if (stepError) return json({ ok: false, mode: "blocked", message: stepError.message }, 500);

  await audit(sb, "avatar_world.prepared", "client_avatar_releases", release.id, {
    client_id: clientId,
    research_run_id: run.id,
    source_avatar_release_id: authority.activeRelease.id,
  });
  return json({ ok: true, mode: "prepared", message: "Avatar World workflow prepared.", research_run_id: run.id, release_id: release.id, steps: [step] });
}

async function runWorldStep(sb: ServiceClient, clientId: string, releaseId: string, authority: Extract<WorldAuthority, { ok: true }>) {
  const { error: assetDeleteError } = await sb.from("client_avatar_assets").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (assetDeleteError) throw new Error(assetDeleteError.message);
  const { error: componentDeleteError } = await sb.from("client_avatar_components").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (componentDeleteError) throw new Error(componentDeleteError.message);

  const { error: snapshotError } = await sb.from("client_avatar_components").insert([
    snapshotComponent(authority.strategyComponent, clientId, releaseId, "avatar_strategy_approved_snapshot", 1),
    snapshotComponent(authority.appearanceComponent, clientId, releaseId, "appearance_approved_snapshot", 2),
  ]);
  if (snapshotError) throw new Error(snapshotError.message);

  const strategyPayload = authority.strategyComponent.structured_payload;
  const appearancePayload = authority.appearanceComponent.structured_payload;
  const concept = payloadText(strategyPayload, "avatar_concept");
  const clothing = payloadText(appearancePayload, "clothing_direction");

  const { data: environment, error: environmentError } = await sb.from("client_avatar_components").insert({
    client_id: clientId,
    release_id: releaseId,
    component_type: "environment",
    component_key: "environment_review",
    title: "Environment review",
    summary: "Structured recurring environment scaffold for avatar-led production. Human review must define the canonical set before image or video generation.",
    strategic_rationale: "Environment gives the communication identity a repeatable world. It should support familiarity, category credibility, ICP relatability, and visual consistency without becoming the whole brand.",
    evidence_summary: `Generated from approved ${authority.activeRelease.title}, including Avatar Strategy and Appearance. No set, prop, or visual environment is approved until reviewed.`,
    structured_payload: {
      source_avatar_release_id: authority.activeRelease.id,
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      source_avatar_appearance_component_id: authority.appearanceComponent.id,
      environment_is_ready_for_media_generation: false,
      avatar_concept_alignment: concept,
      wardrobe_alignment: clothing,
      primary_environment_concept: "review_required",
      recurring_sets: ["review_required"],
      set_layout_notes: "review_required",
      props_and_tools: ["review_required"],
      background_elements: ["review_required"],
      lighting_direction: "review_required",
      visual_atmosphere: "review_required",
      camera_framing_context: ["talking-head", "workbench/desk explanation", "demonstration close-up", "reaction cutaway"],
      environment_prompt_pack: {
        primary_set_prompt: "review_required",
        prop_consistency_prompt: "review_required",
        lighting_prompt: "review_required",
        background_negative_prompt: "review_required",
      },
      negative_prompt_boundaries: [
        "Do not add client proof, logos, certifications, awards, or regulated markers unless approved.",
        "Do not create unsafe, misleading, or implausible working environments.",
        "Do not imply a real location, facility, or client-owned asset unless supplied and approved.",
      ],
      granular_retry_fields: [
        "primary_environment_concept",
        "recurring_sets",
        "props_and_tools",
        "lighting_direction",
        "environment_prompt_pack",
      ],
      stage_5c_scaffold: true,
      human_review_required: true,
      no_media_generation_in_stage_5c: true,
    },
    upstream_refs: [
      {
        source_domain: "avatar_os",
        source_release_id: authority.activeRelease.id,
        source_component_ids: [authority.strategyComponent.id, authority.appearanceComponent.id],
        relationship: "approved_strategy_and_appearance",
      },
    ],
    generation_contract: {
      component_retry_supported: true,
      full_regeneration_supported: true,
      non_destructive_versioning_required: true,
      no_image_generation: true,
      no_video_generation: true,
      no_invented_real_locations_or_credentials: true,
      downstream_media_generation_requires_approval: true,
    },
    display_order: 3,
  }).select("*").single();
  if (environmentError) throw new Error(environmentError.message);

  const { data: voice, error: voiceError } = await sb.from("client_avatar_components").insert({
    client_id: clientId,
    release_id: releaseId,
    component_type: "voice_personality",
    component_key: "voice_personality_review",
    title: "Voice & Personality review",
    summary: "Structured communication behaviour scaffold for the avatar. Human review must define approved voice, vocabulary, mannerisms, teaching style, and boundaries before scripts or voice generation.",
    strategic_rationale: "Voice and personality make the avatar feel consistent across content. They should strengthen education, trust, and audience affinity while staying grounded in approved expertise and proof.",
    evidence_summary: `Generated from approved ${authority.activeRelease.title}, including Avatar Strategy and Appearance. No accent, slang, catchphrase, or voice-generation direction is approved until reviewed.`,
    structured_payload: {
      source_avatar_release_id: authority.activeRelease.id,
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      source_avatar_appearance_component_id: authority.appearanceComponent.id,
      voice_is_ready_for_script_generation: false,
      avatar_concept_alignment: concept,
      audience_relationship_alignment: payloadText(strategyPayload, "audience_relationship"),
      accent_direction: "review_required",
      vocabulary_direction: "review_required",
      slang_direction: "review_required",
      technical_sophistication: "review_required",
      sentence_structure: "review_required",
      humour_direction: "review_required",
      confidence_warmth_directness: "review_required",
      energy_level: "review_required",
      local_language_usage: "review_required",
      recurring_phrases: ["review_required"],
      mannerisms: ["review_required"],
      teaching_style: "review_required",
      storytelling_style: "review_required",
      do_say: ["review_required"],
      do_not_say: [
        "Do not invent proof, outcomes, credentials, or technical expertise.",
        "Do not imitate a protected character, real person, or trademarked voice.",
        "Do not use sensitive-trait stereotypes or forced dialect.",
      ],
      voice_prompt_pack: {
        script_voice_prompt: "review_required",
        dialogue_consistency_prompt: "review_required",
        voice_generation_direction: "review_required",
        forbidden_voice_markers: "review_required",
      },
      granular_retry_fields: [
        "accent_direction",
        "vocabulary_direction",
        "humour_direction",
        "recurring_phrases",
        "mannerisms",
        "voice_prompt_pack",
      ],
      stage_5c_scaffold: true,
      human_review_required: true,
      no_audio_generation_in_stage_5c: true,
      no_script_generation_in_stage_5c: true,
    },
    upstream_refs: [
      {
        source_domain: "avatar_os",
        source_release_id: authority.activeRelease.id,
        source_component_ids: [authority.strategyComponent.id, authority.appearanceComponent.id],
        relationship: "approved_strategy_and_appearance",
      },
    ],
    generation_contract: {
      component_retry_supported: true,
      full_regeneration_supported: true,
      non_destructive_versioning_required: true,
      no_voice_generation: true,
      no_audio_generation: true,
      no_script_generation: true,
      no_voice_cloning_without_rights_review: true,
      no_existing_character_ip_without_rights_review: true,
      downstream_script_or_voice_generation_requires_approval: true,
    },
    display_order: 4,
  }).select("*").single();
  if (voiceError) throw new Error(voiceError.message);

  const { data: creative, error: creativeError } = await sb.from("client_avatar_components").insert({
    client_id: clientId,
    release_id: releaseId,
    component_type: "creative_direction",
    component_key: "creative_direction_review",
    title: "Creative Direction review",
    summary: "Structured visual and audiovisual grammar scaffold for avatar-led content. Human review must define canonical camera, editing, graphic, sound, and motion rules before downstream production use.",
    strategic_rationale: "Creative Direction keeps avatar-led production recognisable across many assets. It should reinforce the approved avatar world and voice without forcing every content item to become avatar-led.",
    evidence_summary: `Generated from approved ${authority.activeRelease.title}, including Avatar Strategy and Appearance. No shot style, editing rule, typography treatment, or sound direction is approved until reviewed.`,
    structured_payload: {
      source_avatar_release_id: authority.activeRelease.id,
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      source_avatar_appearance_component_id: authority.appearanceComponent.id,
      creative_direction_is_ready_for_production: false,
      avatar_concept_alignment: concept,
      environment_alignment: "review_required",
      voice_alignment: payloadText(strategyPayload, "personality_direction"),
      camera_style: "review_required",
      shot_types: ["talking-head", "demonstration close-up", "reaction cutaway", "proof callout"],
      framing_rules: ["review_required"],
      camera_movement: ["review_required"],
      editing_pace: "review_required",
      colour_tendencies: ["review_required"],
      graphical_overlays: ["review_required"],
      typography_treatment: "review_required",
      transition_style: "review_required",
      sound_design_direction: "review_required",
      music_direction: "review_required",
      recurring_motifs: ["review_required"],
      creative_prompt_pack: {
        visual_style_prompt: "review_required",
        edit_rhythm_prompt: "review_required",
        overlay_prompt: "review_required",
        sound_direction_prompt: "review_required",
      },
      creative_guardrails: [
        "Do not imply production assets, brand marks, locations, proof, or credentials that have not been approved.",
        "Do not force avatar-led treatment onto every downstream content item.",
        "Do not generate video, images, audio, scripts, or storyboards in this component scaffold.",
      ],
      granular_retry_fields: [
        "camera_style",
        "shot_types",
        "editing_pace",
        "graphical_overlays",
        "sound_design_direction",
        "creative_prompt_pack",
      ],
      stage_5c_scaffold: true,
      human_review_required: true,
      no_media_generation_in_stage_5c: true,
      no_script_generation_in_stage_5c: true,
    },
    upstream_refs: [
      {
        source_domain: "avatar_os",
        source_release_id: authority.activeRelease.id,
        source_component_ids: [authority.strategyComponent.id, authority.appearanceComponent.id],
        relationship: "approved_strategy_and_appearance",
      },
    ],
    generation_contract: {
      component_retry_supported: true,
      full_regeneration_supported: true,
      non_destructive_versioning_required: true,
      no_image_generation: true,
      no_video_generation: true,
      no_audio_generation: true,
      no_script_generation: true,
      no_storyboard_generation: true,
      downstream_production_requires_approval: true,
    },
    display_order: 5,
  }).select("*").single();
  if (creativeError) throw new Error(creativeError.message);

  return {
    component_count: 5,
    environment_component_id: environment.id,
    voice_personality_component_id: voice.id,
    creative_direction_component_id: creative.id,
    asset_count: 0,
  };
}

async function runStep(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data: run, error: runError } = await sb.from("client_research_runs")
    .select("*").eq("id", researchRunId).eq("client_id", clientId).eq("research_domain", "avatar_system").maybeSingle();
  if (runError || !run) return json({ ok: false, terminal: true, message: runError?.message ?? "Avatar World research run not found." }, 404);
  if (run.configuration_snapshot?.avatar_stage !== "world") {
    return json({ ok: false, terminal: true, message: "Avatar World stage does not match the research run." }, 409);
  }
  if (run.status === "completed" || run.status === "completed_partial" || run.status === "cancelled") {
    return json({ ok: true, terminal: true, message: "Avatar World research is already terminal.", research_run_id: researchRunId, progress: await stepProgress(sb, researchRunId) });
  }

  const { data: release, error: releaseError } = await fetchReleaseForRun(sb, clientId, researchRunId);
  if (releaseError || !release || release.status !== "draft") {
    return json({ ok: false, terminal: true, message: releaseError?.message ?? "Draft Avatar World release not found." }, 409);
  }

  const leaseOwner = `avatar_world:${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await sb.rpc("claim_client_research_step", {
    p_research_run_id: researchRunId,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (claimError) return json({ ok: false, terminal: true, message: claimError.message, research_run_id: researchRunId }, 500);
  if (!claimed) {
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: progress.completed > 0 && progress.terminal, terminal: progress.terminal, message: progress.terminal ? "No recoverable Avatar World steps remain." : "Another worker owns the next Avatar World step.", research_run_id: researchRunId, release_id: release.id, progress });
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
    const authority = await loadWorldAuthority(sb, clientId);
    if (!authority.ok) throw new Error(authority.message);
    if (run.prompt_digest !== authority.authorityHash) {
      throw new Error("Avatar World authority changed after this run began. Start a new run from the current approved Avatar Appearance.");
    }
    const outputSummary = await runWorldStep(sb, clientId, release.id, authority);
    await sb.from("client_research_steps").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      output_summary: { ...outputSummary, scaffold: true },
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({ source_count: outputSummary.component_count }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: true, terminal: progress.terminal, message: "Avatar World and Creative Direction scaffold completed.", research_run_id: researchRunId, release_id: release.id, progress });
  } catch (error) {
    const message = compact(errorMessage(error), 2000);
    await sb.from("client_research_steps").update({
      status: "failed",
      attempt_count: step.maximum_attempts,
      failure_code: "AVATAR_WORLD_STEP_FAILED",
      failure_message: message,
      lease_owner: null,
      lease_expires_at: null,
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "AVATAR_WORLD_STEP_FAILED",
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
    return json({ ok: false, message: runResult.error?.message ?? releaseResult.error?.message ?? "Avatar World run or release not found." }, 404);
  }
  if (runResult.data.configuration_snapshot?.avatar_stage !== "world") {
    return json({ ok: false, message: "Avatar World stage does not match the research run." }, 409);
  }

  const progress = await stepProgress(sb, researchRunId);
  if (!progress.terminal || progress.completed === 0) {
    return json({ ok: false, message: "Avatar World cannot be finalised while recoverable work remains or no step completed.", progress }, 409);
  }

  const { data: components, error: componentError } = await sb.from("client_avatar_components")
    .select("component_type")
    .eq("client_id", clientId)
    .eq("release_id", releaseResult.data.id)
    .in("component_type", ["environment", "voice_personality", "creative_direction"]);
  if (componentError) return json({ ok: false, message: componentError.message }, 500);
  const componentTypes = new Set((components ?? []).map((component) => component.component_type));
  if (!componentTypes.has("environment") || !componentTypes.has("voice_personality") || !componentTypes.has("creative_direction")) {
    return json({ ok: false, message: "Avatar release requires Environment, Voice & Personality, and Creative Direction components." }, 409);
  }

  const now = new Date().toISOString();
  const status = progress.failed > 0 ? "completed_partial" : "completed";
  const { data: updatedRelease, error: releaseUpdateError } = await sb.from("client_avatar_releases").update({
    status: "needs_review",
    summary: "Draft Avatar Environment, Voice & Personality, and Creative Direction ready for human review. Downstream media, script, or voice generation must only consume them after approval.",
    generated_at: now,
    submitted_at: now,
  }).eq("id", releaseResult.data.id).select("*").single();
  if (releaseUpdateError) return json({ ok: false, message: releaseUpdateError.message }, 500);

  const { data: updatedRun, error: runUpdateError } = await sb.from("client_research_runs").update({
    status,
    completed_at: now,
    failure_code: progress.failed > 0 ? "AVATAR_WORLD_PARTIAL" : null,
    failure_message: progress.failed > 0 ? `${progress.failed} Avatar World step(s) did not complete.` : null,
    retryable: false,
  }).eq("id", researchRunId).select("*").single();
  if (runUpdateError) return json({ ok: false, message: runUpdateError.message }, 500);

  await audit(sb, "avatar_world.submitted_for_review", "client_avatar_releases", updatedRelease.id, {
    client_id: clientId,
    research_run_id: researchRunId,
    component_count: components?.length ?? 0,
  });
  return json({ ok: true, message: "Avatar World and Creative Direction are ready for human review.", release: updatedRelease, run: updatedRun });
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
