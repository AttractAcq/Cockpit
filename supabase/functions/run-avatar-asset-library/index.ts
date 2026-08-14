// Stage 5D — Avatar Asset Library foundations.
//
// Asset Library foundations define the reusable production asset inventory and
// prompt-pack slots that approved Avatar OS can later generate. This workflow
// creates no media, writes no storage objects, and does not insert
// client_avatar_assets rows. Actual asset generation belongs to
// generate-avatar-asset in the next build step.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";

type Action = "prepare" | "step" | "finalize";
type ServiceClient = ReturnType<typeof svc>;
type RequiredComponentType =
  | "avatar_strategy"
  | "appearance"
  | "environment"
  | "voice_personality"
  | "creative_direction"
  | "knowledge_expertise"
  | "content_format";

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

type AssetLibraryAuthority =
  | {
    ok: true;
    authorityHash: string;
    activeRelease: AvatarReleaseRow;
    components: Record<RequiredComponentType, AvatarComponentRow>;
  }
  | {
    ok: false;
    status: number;
    code: string;
    message: string;
  };

const REQUIRED_COMPONENTS: RequiredComponentType[] = [
  "avatar_strategy",
  "appearance",
  "environment",
  "voice_personality",
  "creative_direction",
  "knowledge_expertise",
  "content_format",
];

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

async function loadAssetLibraryAuthority(sb: ServiceClient, clientId: string): Promise<AssetLibraryAuthority> {
  const { data: pointer, error: pointerError } = await sb.from("client_avatar_active_releases")
    .select("release_id").eq("client_id", clientId).maybeSingle();
  if (pointerError) {
    return { ok: false, status: 500, code: "AVATAR_ACTIVE_RELEASE_LOAD_FAILED", message: pointerError.message };
  }
  if (!pointer?.release_id) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_OPERATING_CONTEXT_REQUIRED",
      message: "Avatar Asset Library requires an approved active Avatar release with the complete show-bible component stack.",
    };
  }

  const { data: activeRelease, error: releaseError } = await sb.from("client_avatar_releases")
    .select("*").eq("client_id", clientId).eq("id", pointer.release_id).eq("status", "approved").maybeSingle();
  if (releaseError || !activeRelease) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_OPERATING_CONTEXT_REQUIRED",
      message: releaseError?.message ?? "The active Avatar release is not approved.",
    };
  }

  const loaded = await Promise.all(REQUIRED_COMPONENTS.map((componentType) =>
    loadComponent(sb, clientId, activeRelease.id, componentType)
  ));
  const missing = REQUIRED_COMPONENTS.filter((_, index) => !loaded[index]);
  if (missing.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_OPERATING_CONTEXT_REQUIRED",
      message: `Avatar Asset Library requires approved components first: ${missing.join(", ")}.`,
    };
  }

  const components = Object.fromEntries(REQUIRED_COMPONENTS.map((componentType, index) => [
    componentType,
    loaded[index] as AvatarComponentRow,
  ])) as Record<RequiredComponentType, AvatarComponentRow>;

  const authority = {
    active_release: {
      id: activeRelease.id,
      version: activeRelease.version,
      title: activeRelease.title,
      approved_at: activeRelease.approved_at,
      authority_snapshot: activeRelease.authority_snapshot,
    },
    components: Object.fromEntries(REQUIRED_COMPONENTS.map((componentType) => [
      componentType,
      {
        id: components[componentType].id,
        component_key: components[componentType].component_key,
        structured_payload: components[componentType].structured_payload,
      },
    ])),
    stage: "5D_avatar_asset_library_foundations",
  };

  return {
    ok: true,
    authorityHash: await sha256(JSON.stringify(authority)),
    activeRelease: activeRelease as AvatarReleaseRow,
    components,
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
      carried_forward_for_stage_5d_assets: true,
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
  const authority = await loadAssetLibraryAuthority(sb, clientId);
  if (!authority.ok) return json({ ok: false, mode: "blocked", ...authority }, authority.status);

  const { data: openRuns, error: openError } = await sb.from("client_research_runs")
    .select("*")
    .eq("client_id", clientId)
    .eq("research_domain", "avatar_system")
    .eq("configuration_snapshot->>avatar_stage", "asset_library")
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
    return json({ ok: true, mode: "resumed", message: "Resuming Avatar Asset Library.", research_run_id: run.id, release_id: release.id, steps: steps ?? [] });
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
    idempotency_key: `avatar_system:asset_library:${authority.authorityHash.slice(0, 40)}:v${version}`,
    provider: "system",
    model: "stage_5d_avatar_asset_library_foundation",
    prompt_digest: authority.authorityHash,
    configuration_snapshot: {
      avatar_stage: "asset_library",
      authority_hash: authority.authorityHash,
      source_avatar_release_id: authority.activeRelease.id,
      source_component_ids: REQUIRED_COMPONENTS.map((componentType) => authority.components[componentType].id),
      output_contract: "avatar_asset_library_foundation",
      generation_scope: "structured_asset_inventory_no_asset_generation_or_storage_write",
    },
    created_by: userId,
  }).select("*").single();
  if (runError) return json({ ok: false, mode: "blocked", message: runError.message }, 500);

  const { data: release, error: releaseError } = await sb.from("client_avatar_releases").insert({
    client_id: clientId,
    version,
    status: "draft",
    research_run_id: run.id,
    title: `Avatar Asset Library v${version}`,
    summary: "Draft reusable Avatar Asset Library foundation. Human review is required before any asset generation job can consume these slots.",
    authority_snapshot: {
      authority_hash: authority.authorityHash,
      source_avatar_release: {
        id: authority.activeRelease.id,
        version: authority.activeRelease.version,
        title: authority.activeRelease.title,
        approved_at: authority.activeRelease.approved_at,
      },
      source_component_ids: REQUIRED_COMPONENTS.map((componentType) => authority.components[componentType].id),
      separation_of_concerns: {
        asset_library: "planned_reusable_production_assets_and_prompt_slots",
        excluded: ["image_generation", "video_generation", "voice_generation", "storage_writes", "client_avatar_assets_rows"],
      },
    },
    created_by: userId,
  }).select("*").single();
  if (releaseError) {
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "AVATAR_ASSET_LIBRARY_RELEASE_CREATE_FAILED",
      failure_message: releaseError.message,
      retryable: false,
    }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
  }

  const { data: step, error: stepError } = await sb.from("client_research_steps").insert({
    client_id: clientId,
    research_run_id: run.id,
    step_key: "avatar_asset_library",
    step_order: 1,
    title: "Avatar asset library foundations",
  }).select("*").single();
  if (stepError) return json({ ok: false, mode: "blocked", message: stepError.message }, 500);

  await audit(sb, "avatar_asset_library.prepared", "client_avatar_releases", release.id, {
    client_id: clientId,
    research_run_id: run.id,
    source_avatar_release_id: authority.activeRelease.id,
  });
  return json({ ok: true, mode: "prepared", message: "Avatar Asset Library workflow prepared.", research_run_id: run.id, release_id: release.id, steps: [step] });
}

async function runAssetLibraryStep(
  sb: ServiceClient,
  clientId: string,
  releaseId: string,
  authority: Extract<AssetLibraryAuthority, { ok: true }>,
) {
  const { error: assetDeleteError } = await sb.from("client_avatar_assets").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (assetDeleteError) throw new Error(assetDeleteError.message);
  const { error: componentDeleteError } = await sb.from("client_avatar_components").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (componentDeleteError) throw new Error(componentDeleteError.message);

  const snapshots = REQUIRED_COMPONENTS.map((componentType, index) =>
    snapshotComponent(authority.components[componentType], clientId, releaseId, `${componentType}_approved_snapshot`, index + 1)
  );
  const { error: snapshotError } = await sb.from("client_avatar_components").insert(snapshots);
  if (snapshotError) throw new Error(snapshotError.message);

  const appearancePayload = authority.components.appearance.structured_payload;
  const environmentPayload = authority.components.environment.structured_payload;
  const voicePayload = authority.components.voice_personality.structured_payload;
  const creativePayload = authority.components.creative_direction.structured_payload;
  const knowledgePayload = authority.components.knowledge_expertise.structured_payload;
  const formatPayload = authority.components.content_format.structured_payload;

  const plannedSlots = [
    {
      asset_type: "canonical_image",
      title: "Canonical avatar image",
      purpose: "Primary visual reference for the approved avatar identity.",
      source_component_types: ["appearance", "creative_direction"],
      status: "not_generated",
    },
    {
      asset_type: "pose_reference",
      title: "Pose reference set",
      purpose: "Reusable body-language and gesture references for production.",
      source_component_types: ["appearance", "voice_personality", "creative_direction"],
      status: "not_generated",
    },
    {
      asset_type: "expression_reference",
      title: "Expression reference set",
      purpose: "Approved emotional and teaching expressions for avatar-led content.",
      source_component_types: ["appearance", "voice_personality"],
      status: "not_generated",
    },
    {
      asset_type: "environment_reference",
      title: "Environment reference",
      purpose: "Canonical recurring set or world reference.",
      source_component_types: ["environment", "creative_direction"],
      status: "not_generated",
    },
    {
      asset_type: "prompt_pack",
      title: "Production prompt pack",
      purpose: "Reusable prompts assembled from approved appearance, environment, voice, creative direction, knowledge, and format rules.",
      source_component_types: REQUIRED_COMPONENTS,
      status: "not_generated",
    },
    {
      asset_type: "voice_reference",
      title: "Voice notes / reference",
      purpose: "Approved voice notes for script and audio workflows without cloning or audio generation.",
      source_component_types: ["voice_personality", "knowledge_expertise"],
      status: "not_generated",
    },
    {
      asset_type: "production_reference",
      title: "Production prompt template",
      purpose: "Reusable production-brief reference for downstream avatar-led production.",
      source_component_types: ["creative_direction", "content_format", "knowledge_expertise"],
      status: "not_generated",
    },
    {
      asset_type: "character_sheet",
      title: "Character sheet",
      purpose: "Consolidated visual and behavioural identity sheet.",
      source_component_types: ["avatar_strategy", "appearance", "voice_personality"],
      status: "not_generated",
    },
    {
      asset_type: "environment_sheet",
      title: "Environment sheet",
      purpose: "Consolidated recurring set and visual-world sheet.",
      source_component_types: ["environment", "creative_direction"],
      status: "not_generated",
    },
  ];

  const { data: component, error: componentError } = await sb.from("client_avatar_components").insert({
    client_id: clientId,
    release_id: releaseId,
    component_type: "asset_library",
    component_key: "asset_library_review",
    title: "Asset Library review",
    summary: "Reusable Avatar Asset Library foundation. It defines the production asset slots and prompt-pack structure that Step 3 can generate after approval.",
    strategic_rationale: "The Asset Library bridges approved Avatar OS authority into production without making asset generation automatic. It keeps media generation review-gated and tied to approved components.",
    evidence_summary: `Generated from approved ${authority.activeRelease.title}. No media, audio, storage object, or client_avatar_assets row is created by this foundation workflow.`,
    structured_payload: {
      source_avatar_release_id: authority.activeRelease.id,
      source_component_ids: REQUIRED_COMPONENTS.map((componentType) => authority.components[componentType].id),
      asset_library_is_ready_for_generation: false,
      asset_generation_enabled: false,
      canonical_appearance_reference: payloadText(appearancePayload, "visual_concept_alignment"),
      canonical_environment_reference: payloadText(environmentPayload, "primary_environment_concept"),
      canonical_voice_reference: payloadText(voicePayload, "teaching_style"),
      canonical_creative_reference: payloadText(creativePayload, "camera_style"),
      knowledge_boundary_reference: payloadText(knowledgePayload, "required_evidence_policy"),
      content_format_reference: "reusable_formats" in formatPayload ? formatPayload.reusable_formats : "review_required",
      planned_asset_slots: plannedSlots,
      prompt_pack_foundation: {
        character_consistency_prompt: "review_required",
        environment_consistency_prompt: "review_required",
        voice_and_knowledge_boundary_prompt: "review_required",
        creative_direction_prompt: "review_required",
        production_prompt_template: "review_required",
      },
      asset_generation_guardrails: [
        "Do not generate images, video, audio, voice references, or storage objects in this foundation step.",
        "Do not create client_avatar_assets rows until generate-avatar-asset is implemented and invoked.",
        "Do not use unapproved proof, credentials, locations, logos, or client claims in asset prompts.",
        "Do not generate or imitate protected characters, real people, trademarked worlds, or cloned voices without rights review.",
      ],
      downstream_generation_requirements: [
        "Active approved Avatar Asset Library release.",
        "One explicit generate-avatar-asset request per asset.",
        "Asset row remains draft or needs_review until human approval.",
        "Storage path or external URL required for visual/audio/reference assets.",
      ],
      stage_5d_asset_library_foundation: true,
      human_review_required: true,
      no_image_generation_in_stage_5d: true,
      no_video_generation_in_stage_5d: true,
      no_audio_generation_in_stage_5d: true,
      no_storage_write_in_stage_5d: true,
      no_asset_rows_created_in_stage_5d: true,
    },
    upstream_refs: [
      {
        source_domain: "avatar_os",
        source_release_id: authority.activeRelease.id,
        source_component_ids: REQUIRED_COMPONENTS.map((componentType) => authority.components[componentType].id),
        relationship: "approved_avatar_show_bible_authority",
      },
    ],
    generation_contract: {
      component_retry_supported: true,
      full_regeneration_supported: true,
      non_destructive_versioning_required: true,
      no_image_generation: true,
      no_video_generation: true,
      no_audio_generation: true,
      no_storage_write: true,
      no_client_avatar_assets_insert: true,
      generate_avatar_asset_required_for_asset_rows: true,
      downstream_asset_generation_requires_approval: true,
    },
    display_order: 8,
  }).select("*").single();
  if (componentError) throw new Error(componentError.message);

  return {
    component_count: 8,
    asset_library_component_id: component.id,
    planned_asset_slot_count: plannedSlots.length,
    asset_count: 0,
  };
}

async function runStep(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data: run, error: runError } = await sb.from("client_research_runs")
    .select("*").eq("id", researchRunId).eq("client_id", clientId).eq("research_domain", "avatar_system").maybeSingle();
  if (runError || !run) return json({ ok: false, terminal: true, message: runError?.message ?? "Avatar Asset Library research run not found." }, 404);
  if (run.configuration_snapshot?.avatar_stage !== "asset_library") {
    return json({ ok: false, terminal: true, message: "Avatar Asset Library stage does not match the research run." }, 409);
  }
  if (run.status === "completed" || run.status === "completed_partial" || run.status === "cancelled") {
    return json({ ok: true, terminal: true, message: "Avatar Asset Library research is already terminal.", research_run_id: researchRunId, progress: await stepProgress(sb, researchRunId) });
  }

  const { data: release, error: releaseError } = await fetchReleaseForRun(sb, clientId, researchRunId);
  if (releaseError || !release || release.status !== "draft") {
    return json({ ok: false, terminal: true, message: releaseError?.message ?? "Draft Avatar Asset Library release not found." }, 409);
  }

  const leaseOwner = `avatar_asset_library:${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await sb.rpc("claim_client_research_step", {
    p_research_run_id: researchRunId,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (claimError) return json({ ok: false, terminal: true, message: claimError.message, research_run_id: researchRunId }, 500);
  if (!claimed) {
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: progress.completed > 0 && progress.terminal, terminal: progress.terminal, message: progress.terminal ? "No recoverable Avatar Asset Library steps remain." : "Another worker owns the next Avatar Asset Library step.", research_run_id: researchRunId, release_id: release.id, progress });
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
    const authority = await loadAssetLibraryAuthority(sb, clientId);
    if (!authority.ok) throw new Error(authority.message);
    if (run.prompt_digest !== authority.authorityHash) {
      throw new Error("Avatar Asset Library authority changed after this run began. Start a new run from the current approved Avatar operating context.");
    }
    const outputSummary = await runAssetLibraryStep(sb, clientId, release.id, authority);
    await sb.from("client_research_steps").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      output_summary: { ...outputSummary, scaffold: true },
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({ source_count: outputSummary.component_count }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: true, terminal: progress.terminal, message: "Avatar Asset Library foundation completed.", research_run_id: researchRunId, release_id: release.id, progress });
  } catch (error) {
    const message = compact(errorMessage(error), 2000);
    await sb.from("client_research_steps").update({
      status: "failed",
      attempt_count: step.maximum_attempts,
      failure_code: "AVATAR_ASSET_LIBRARY_STEP_FAILED",
      failure_message: message,
      lease_owner: null,
      lease_expires_at: null,
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "AVATAR_ASSET_LIBRARY_STEP_FAILED",
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
    return json({ ok: false, message: runResult.error?.message ?? releaseResult.error?.message ?? "Avatar Asset Library run or release not found." }, 404);
  }
  if (runResult.data.configuration_snapshot?.avatar_stage !== "asset_library") {
    return json({ ok: false, message: "Avatar Asset Library stage does not match the research run." }, 409);
  }

  const progress = await stepProgress(sb, researchRunId);
  if (!progress.terminal || progress.completed === 0) {
    return json({ ok: false, message: "Avatar Asset Library cannot be finalised while recoverable work remains or no step completed.", progress }, 409);
  }

  const { data: components, error: componentError } = await sb.from("client_avatar_components")
    .select("component_type")
    .eq("client_id", clientId)
    .eq("release_id", releaseResult.data.id)
    .eq("component_type", "asset_library");
  if (componentError) return json({ ok: false, message: componentError.message }, 500);
  if ((components ?? []).length !== 1) {
    return json({ ok: false, message: "Avatar release requires one Asset Library component." }, 409);
  }

  const { count: assetCount, error: assetCountError } = await sb.from("client_avatar_assets")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("release_id", releaseResult.data.id);
  if (assetCountError) return json({ ok: false, message: assetCountError.message }, 500);
  if ((assetCount ?? 0) > 0) {
    return json({ ok: false, message: "Avatar Asset Library foundation cannot create asset rows. Use generate-avatar-asset in the next step." }, 409);
  }

  const now = new Date().toISOString();
  const status = progress.failed > 0 ? "completed_partial" : "completed";
  const { data: updatedRelease, error: releaseUpdateError } = await sb.from("client_avatar_releases").update({
    status: "needs_review",
    summary: "Draft Avatar Asset Library foundation ready for human review. No generated assets exist yet; Step 3 must create review-gated asset rows explicitly.",
    generated_at: now,
    submitted_at: now,
  }).eq("id", releaseResult.data.id).select("*").single();
  if (releaseUpdateError) return json({ ok: false, message: releaseUpdateError.message }, 500);

  const { data: updatedRun, error: runUpdateError } = await sb.from("client_research_runs").update({
    status,
    completed_at: now,
    failure_code: progress.failed > 0 ? "AVATAR_ASSET_LIBRARY_PARTIAL" : null,
    failure_message: progress.failed > 0 ? `${progress.failed} Avatar Asset Library step(s) did not complete.` : null,
    retryable: false,
  }).eq("id", researchRunId).select("*").single();
  if (runUpdateError) return json({ ok: false, message: runUpdateError.message }, 500);

  await audit(sb, "avatar_asset_library.submitted_for_review", "client_avatar_releases", updatedRelease.id, {
    client_id: clientId,
    research_run_id: researchRunId,
    asset_count: assetCount ?? 0,
  });
  return json({ ok: true, message: "Avatar Asset Library foundation is ready for human review.", release: updatedRelease, run: updatedRun });
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
