// Stage 5C — Avatar Knowledge and Content Format orchestration.
//
// Operating Context defines what the approved avatar is allowed to know and
// the reusable ways it can appear in content. It requires approved Strategy,
// Appearance, Environment, Voice & Personality, and Creative Direction
// components. It generates no scripts, content ideas, media assets, audio, or
// provider calls.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";

type Action = "prepare" | "step" | "finalize";
type ServiceClient = ReturnType<typeof svc>;
type RequiredComponentType = "avatar_strategy" | "appearance" | "environment" | "voice_personality" | "creative_direction";

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

type OperatingContextAuthority =
  | {
    ok: true;
    authorityHash: string;
    activeRelease: AvatarReleaseRow;
    strategyComponent: AvatarComponentRow;
    appearanceComponent: AvatarComponentRow;
    environmentComponent: AvatarComponentRow;
    voiceComponent: AvatarComponentRow;
    creativeComponent: AvatarComponentRow;
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

async function loadOperatingContextAuthority(sb: ServiceClient, clientId: string): Promise<OperatingContextAuthority> {
  const { data: pointer, error: pointerError } = await sb.from("client_avatar_active_releases")
    .select("release_id").eq("client_id", clientId).maybeSingle();
  if (pointerError) {
    return { ok: false, status: 500, code: "AVATAR_ACTIVE_RELEASE_LOAD_FAILED", message: pointerError.message };
  }
  if (!pointer?.release_id) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_WORLD_REQUIRED",
      message: "Avatar Operating Context requires an approved active Avatar World release.",
    };
  }

  const { data: activeRelease, error: releaseError } = await sb.from("client_avatar_releases")
    .select("*").eq("client_id", clientId).eq("id", pointer.release_id).eq("status", "approved").maybeSingle();
  if (releaseError || !activeRelease) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_WORLD_REQUIRED",
      message: releaseError?.message ?? "The active Avatar release is not approved.",
    };
  }

  const [strategyComponent, appearanceComponent, environmentComponent, voiceComponent, creativeComponent] = await Promise.all([
    loadComponent(sb, clientId, activeRelease.id, "avatar_strategy"),
    loadComponent(sb, clientId, activeRelease.id, "appearance"),
    loadComponent(sb, clientId, activeRelease.id, "environment"),
    loadComponent(sb, clientId, activeRelease.id, "voice_personality"),
    loadComponent(sb, clientId, activeRelease.id, "creative_direction"),
  ]);
  if (!strategyComponent || !appearanceComponent || !environmentComponent || !voiceComponent || !creativeComponent) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_WORLD_REQUIRED",
      message: "Avatar Operating Context requires approved Strategy, Appearance, Environment, Voice & Personality, and Creative Direction components.",
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
    environment_component: {
      id: environmentComponent.id,
      component_key: environmentComponent.component_key,
      structured_payload: environmentComponent.structured_payload,
    },
    voice_component: {
      id: voiceComponent.id,
      component_key: voiceComponent.component_key,
      structured_payload: voiceComponent.structured_payload,
    },
    creative_component: {
      id: creativeComponent.id,
      component_key: creativeComponent.component_key,
      structured_payload: creativeComponent.structured_payload,
    },
    stage: "5C_avatar_operating_context",
  };

  return {
    ok: true,
    authorityHash: await sha256(JSON.stringify(authority)),
    activeRelease: activeRelease as AvatarReleaseRow,
    strategyComponent,
    appearanceComponent,
    environmentComponent,
    voiceComponent,
    creativeComponent,
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
  const authority = await loadOperatingContextAuthority(sb, clientId);
  if (!authority.ok) return json({ ok: false, mode: "blocked", ...authority }, authority.status);

  const { data: openRuns, error: openError } = await sb.from("client_research_runs")
    .select("*")
    .eq("client_id", clientId)
    .eq("research_domain", "avatar_system")
    .eq("configuration_snapshot->>avatar_stage", "operating_context")
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
    return json({ ok: true, mode: "resumed", message: "Resuming Avatar Operating Context.", research_run_id: run.id, release_id: release.id, steps: steps ?? [] });
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
    idempotency_key: `avatar_system:operating_context:${authority.authorityHash.slice(0, 40)}:v${version}`,
    provider: "system",
    model: "stage_5c_avatar_operating_context_scaffold",
    prompt_digest: authority.authorityHash,
    configuration_snapshot: {
      avatar_stage: "operating_context",
      authority_hash: authority.authorityHash,
      source_avatar_release_id: authority.activeRelease.id,
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      source_avatar_appearance_component_id: authority.appearanceComponent.id,
      source_avatar_environment_component_id: authority.environmentComponent.id,
      source_avatar_voice_component_id: authority.voiceComponent.id,
      source_avatar_creative_component_id: authority.creativeComponent.id,
      output_contract: "avatar_knowledge_expertise_and_content_formats",
      generation_scope: "structured_operating_context_no_ideation_script_or_media_generation",
    },
    created_by: userId,
  }).select("*").single();
  if (runError) return json({ ok: false, mode: "blocked", message: runError.message }, 500);

  const { data: release, error: releaseError } = await sb.from("client_avatar_releases").insert({
    client_id: clientId,
    version,
    status: "draft",
    research_run_id: run.id,
    title: `Avatar Operating Context v${version}`,
    summary: "Draft Knowledge / Expertise and Content Format components scaffolded from approved Avatar World authority. Human review is required before downstream ideation, scripting, or production use.",
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
      source_avatar_environment_component_id: authority.environmentComponent.id,
      source_avatar_voice_component_id: authority.voiceComponent.id,
      source_avatar_creative_component_id: authority.creativeComponent.id,
      separation_of_concerns: {
        knowledge_expertise: "approved_knowledge_boundaries",
        content_format: "repeatable_presentation_mechanics",
        excluded: ["content_ideation", "script_generation", "asset_generation", "media_generation"],
      },
    },
    created_by: userId,
  }).select("*").single();
  if (releaseError) {
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "AVATAR_OPERATING_CONTEXT_RELEASE_CREATE_FAILED",
      failure_message: releaseError.message,
      retryable: false,
    }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
  }

  const { data: step, error: stepError } = await sb.from("client_research_steps").insert({
    client_id: clientId,
    research_run_id: run.id,
    step_key: "avatar_operating_context",
    step_order: 1,
    title: "Avatar knowledge and content formats",
  }).select("*").single();
  if (stepError) return json({ ok: false, mode: "blocked", message: stepError.message }, 500);

  await audit(sb, "avatar_operating_context.prepared", "client_avatar_releases", release.id, {
    client_id: clientId,
    research_run_id: run.id,
    source_avatar_release_id: authority.activeRelease.id,
  });
  return json({ ok: true, mode: "prepared", message: "Avatar Operating Context workflow prepared.", research_run_id: run.id, release_id: release.id, steps: [step] });
}

async function runOperatingContextStep(
  sb: ServiceClient,
  clientId: string,
  releaseId: string,
  authority: Extract<OperatingContextAuthority, { ok: true }>,
) {
  const { error: assetDeleteError } = await sb.from("client_avatar_assets").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (assetDeleteError) throw new Error(assetDeleteError.message);
  const { error: componentDeleteError } = await sb.from("client_avatar_components").delete().eq("client_id", clientId).eq("release_id", releaseId);
  if (componentDeleteError) throw new Error(componentDeleteError.message);

  const { error: snapshotError } = await sb.from("client_avatar_components").insert([
    snapshotComponent(authority.strategyComponent, clientId, releaseId, "avatar_strategy_approved_snapshot", 1),
    snapshotComponent(authority.appearanceComponent, clientId, releaseId, "appearance_approved_snapshot", 2),
    snapshotComponent(authority.environmentComponent, clientId, releaseId, "environment_approved_snapshot", 3),
    snapshotComponent(authority.voiceComponent, clientId, releaseId, "voice_personality_approved_snapshot", 4),
    snapshotComponent(authority.creativeComponent, clientId, releaseId, "creative_direction_approved_snapshot", 5),
  ]);
  if (snapshotError) throw new Error(snapshotError.message);

  const strategyPayload = authority.strategyComponent.structured_payload;
  const voicePayload = authority.voiceComponent.structured_payload;
  const environmentPayload = authority.environmentComponent.structured_payload;
  const creativePayload = authority.creativeComponent.structured_payload;
  const concept = payloadText(strategyPayload, "avatar_concept");
  const teachingStyle = payloadText(voicePayload, "teaching_style");
  const primaryEnvironment = payloadText(environmentPayload, "primary_environment_concept");
  const creativeDirection = payloadText(creativePayload, "camera_style");

  const { data: knowledge, error: knowledgeError } = await sb.from("client_avatar_components").insert({
    client_id: clientId,
    release_id: releaseId,
    component_type: "knowledge_expertise",
    component_key: "knowledge_expertise_review",
    title: "Knowledge / Expertise review",
    summary: "Structured knowledge-boundary scaffold for what the avatar can credibly communicate. Human review must connect it to real client proof, products, services, FAQs, methods, and approved intelligence.",
    strategic_rationale: "Knowledge / Expertise prevents the avatar from becoming a fictional expert. It defines what the communication identity can teach, where claims must be sourced, and where gaps require client input.",
    evidence_summary: `Generated from approved ${authority.activeRelease.title}. No expertise, proof, credential, case study, product claim, or regulated advice is approved until reviewed.`,
    structured_payload: {
      source_avatar_release_id: authority.activeRelease.id,
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      source_avatar_appearance_component_id: authority.appearanceComponent.id,
      source_avatar_environment_component_id: authority.environmentComponent.id,
      source_avatar_voice_component_id: authority.voiceComponent.id,
      source_avatar_creative_component_id: authority.creativeComponent.id,
      knowledge_is_ready_for_downstream_use: false,
      avatar_concept_alignment: concept,
      teaching_style_alignment: teachingStyle,
      approved_knowledge_domains: ["review_required"],
      proof_sources_to_reference: ["review_required"],
      services_products_to_reference: ["review_required"],
      proprietary_methods_to_reference: ["review_required"],
      faqs_and_customer_questions: ["review_required"],
      objections_avatar_can_address: ["review_required"],
      case_study_boundaries: ["review_required"],
      claim_boundaries: [
        "Do not state results, metrics, credentials, certifications, or case studies unless supplied and approved.",
        "Do not provide regulated professional advice unless the client has supplied approved compliant wording.",
        "Do not invent technical expertise beyond approved client materials.",
      ],
      required_evidence_policy: "Every proof, result, credential, technical assertion, or proprietary method must resolve to approved client evidence before downstream production.",
      needs_client_input_markers: [
        "missing approved services/products",
        "missing approved FAQs",
        "missing approved proof references",
        "missing approved technical boundaries",
      ],
      knowledge_prompt_pack: {
        educational_scope_prompt: "review_required",
        proof_weaving_prompt: "review_required",
        objection_response_scope_prompt: "review_required",
        forbidden_claims_prompt: "review_required",
      },
      granular_retry_fields: [
        "approved_knowledge_domains",
        "proof_sources_to_reference",
        "faqs_and_customer_questions",
        "objections_avatar_can_address",
        "claim_boundaries",
        "knowledge_prompt_pack",
      ],
      stage_5c_scaffold: true,
      human_review_required: true,
      no_content_ideation_in_stage_5c: true,
      no_script_generation_in_stage_5c: true,
    },
    upstream_refs: [
      {
        source_domain: "avatar_os",
        source_release_id: authority.activeRelease.id,
        source_component_ids: [
          authority.strategyComponent.id,
          authority.appearanceComponent.id,
          authority.environmentComponent.id,
          authority.voiceComponent.id,
          authority.creativeComponent.id,
        ],
        relationship: "approved_avatar_world_authority",
      },
    ],
    generation_contract: {
      component_retry_supported: true,
      full_regeneration_supported: true,
      non_destructive_versioning_required: true,
      no_content_ideation: true,
      no_script_generation: true,
      no_media_generation: true,
      no_invented_proof_or_expertise: true,
      downstream_ideation_or_production_requires_approval: true,
    },
    display_order: 6,
  }).select("*").single();
  if (knowledgeError) throw new Error(knowledgeError.message);

  const { data: formats, error: formatsError } = await sb.from("client_avatar_components").insert({
    client_id: clientId,
    release_id: releaseId,
    component_type: "content_format",
    component_key: "content_formats_review",
    title: "Content Formats review",
    summary: "Reusable avatar-led presentation-format scaffold. These are format mechanics, not content ideas, scripts, offers, or campaigns.",
    strategic_rationale: "Content Formats make avatar-led production repeatable without forcing every idea to use the avatar. They define how the avatar may appear when downstream Ideation or Production chooses an avatar-led route.",
    evidence_summary: `Generated from approved ${authority.activeRelease.title}. No downstream idea, script, production brief, or channel plan is created by this scaffold.`,
    structured_payload: {
      source_avatar_release_id: authority.activeRelease.id,
      source_avatar_strategy_component_id: authority.strategyComponent.id,
      source_avatar_appearance_component_id: authority.appearanceComponent.id,
      source_avatar_environment_component_id: authority.environmentComponent.id,
      source_avatar_voice_component_id: authority.voiceComponent.id,
      source_avatar_creative_component_id: authority.creativeComponent.id,
      formats_are_ready_for_downstream_use: false,
      avatar_concept_alignment: concept,
      primary_environment_alignment: primaryEnvironment,
      teaching_style_alignment: teachingStyle,
      creative_direction_alignment: creativeDirection,
      reusable_formats: [
        {
          format_key: "workbench_explanation",
          format_name: "Workshop / desk explanation",
          purpose: "Educational explanation using the approved avatar environment and teaching style.",
          avatar_role: "educator",
          proof_integration_mode: "optional_proof_weaving_only_when_approved",
          ideation_dependency: "requires_downstream_content_idea",
        },
        {
          format_key: "myth_vs_fact",
          format_name: "Myth vs fact",
          purpose: "Clarify misconceptions within approved knowledge boundaries.",
          avatar_role: "category_translator",
          proof_integration_mode: "optional_example_or_evidence_callout_only_when_approved",
          ideation_dependency: "requires_downstream_content_idea",
        },
        {
          format_key: "common_mistake_reaction",
          format_name: "Common mistake reaction",
          purpose: "Respond to recurring ICP mistakes without inventing customer stories.",
          avatar_role: "trusted_guide",
          proof_integration_mode: "optional_anonymised_case_reference_only_when_approved",
          ideation_dependency: "requires_downstream_content_idea",
        },
        {
          format_key: "proof_breakdown",
          format_name: "Proof breakdown",
          purpose: "Explain an approved proof asset or case-study mechanic.",
          avatar_role: "proof_interpreter",
          proof_integration_mode: "required_approved_proof_source",
          ideation_dependency: "requires_downstream_content_idea_and_approved_proof",
        },
      ],
      format_selection_rules: [
        "Avatar-led use is optional, not mandatory.",
        "Formats describe presentation mechanics only; Ideation still owns content ideas.",
        "Offers and Campaign Intelligence can inform downstream ideas without this component generating them.",
      ],
      production_handoff_fields: [
        "format_key",
        "avatar_role",
        "environment_reference",
        "voice_reference",
        "creative_direction_reference",
        "knowledge_boundary_reference",
        "proof_requirement",
      ],
      excluded_formats_until_reviewed: [
        "voice cloning",
        "impersonation",
        "regulated advice",
        "unverified case-study reenactment",
      ],
      granular_retry_fields: [
        "reusable_formats",
        "format_selection_rules",
        "production_handoff_fields",
        "excluded_formats_until_reviewed",
      ],
      stage_5c_scaffold: true,
      human_review_required: true,
      no_content_ideation_in_stage_5c: true,
      no_script_generation_in_stage_5c: true,
      no_media_generation_in_stage_5c: true,
    },
    upstream_refs: [
      {
        source_domain: "avatar_os",
        source_release_id: authority.activeRelease.id,
        source_component_ids: [
          authority.strategyComponent.id,
          authority.appearanceComponent.id,
          authority.environmentComponent.id,
          authority.voiceComponent.id,
          authority.creativeComponent.id,
        ],
        relationship: "approved_avatar_world_authority",
      },
    ],
    generation_contract: {
      component_retry_supported: true,
      full_regeneration_supported: true,
      non_destructive_versioning_required: true,
      no_content_ideation: true,
      no_script_generation: true,
      no_offer_generation: true,
      no_campaign_generation: true,
      no_media_generation: true,
      downstream_ideation_or_production_requires_approval: true,
    },
    display_order: 7,
  }).select("*").single();
  if (formatsError) throw new Error(formatsError.message);

  return {
    component_count: 7,
    knowledge_expertise_component_id: knowledge.id,
    content_formats_component_id: formats.id,
    asset_count: 0,
  };
}

async function runStep(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data: run, error: runError } = await sb.from("client_research_runs")
    .select("*").eq("id", researchRunId).eq("client_id", clientId).eq("research_domain", "avatar_system").maybeSingle();
  if (runError || !run) return json({ ok: false, terminal: true, message: runError?.message ?? "Avatar Operating Context research run not found." }, 404);
  if (run.configuration_snapshot?.avatar_stage !== "operating_context") {
    return json({ ok: false, terminal: true, message: "Avatar Operating Context stage does not match the research run." }, 409);
  }
  if (run.status === "completed" || run.status === "completed_partial" || run.status === "cancelled") {
    return json({ ok: true, terminal: true, message: "Avatar Operating Context research is already terminal.", research_run_id: researchRunId, progress: await stepProgress(sb, researchRunId) });
  }

  const { data: release, error: releaseError } = await fetchReleaseForRun(sb, clientId, researchRunId);
  if (releaseError || !release || release.status !== "draft") {
    return json({ ok: false, terminal: true, message: releaseError?.message ?? "Draft Avatar Operating Context release not found." }, 409);
  }

  const leaseOwner = `avatar_operating_context:${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await sb.rpc("claim_client_research_step", {
    p_research_run_id: researchRunId,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (claimError) return json({ ok: false, terminal: true, message: claimError.message, research_run_id: researchRunId }, 500);
  if (!claimed) {
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: progress.completed > 0 && progress.terminal, terminal: progress.terminal, message: progress.terminal ? "No recoverable Avatar Operating Context steps remain." : "Another worker owns the next Avatar Operating Context step.", research_run_id: researchRunId, release_id: release.id, progress });
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
    const authority = await loadOperatingContextAuthority(sb, clientId);
    if (!authority.ok) throw new Error(authority.message);
    if (run.prompt_digest !== authority.authorityHash) {
      throw new Error("Avatar Operating Context authority changed after this run began. Start a new run from the current approved Avatar World.");
    }
    const outputSummary = await runOperatingContextStep(sb, clientId, release.id, authority);
    await sb.from("client_research_steps").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      output_summary: { ...outputSummary, scaffold: true },
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({ source_count: outputSummary.component_count }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: true, terminal: progress.terminal, message: "Avatar Operating Context scaffold completed.", research_run_id: researchRunId, release_id: release.id, progress });
  } catch (error) {
    const message = compact(errorMessage(error), 2000);
    await sb.from("client_research_steps").update({
      status: "failed",
      attempt_count: step.maximum_attempts,
      failure_code: "AVATAR_OPERATING_CONTEXT_STEP_FAILED",
      failure_message: message,
      lease_owner: null,
      lease_expires_at: null,
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "AVATAR_OPERATING_CONTEXT_STEP_FAILED",
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
    return json({ ok: false, message: runResult.error?.message ?? releaseResult.error?.message ?? "Avatar Operating Context run or release not found." }, 404);
  }
  if (runResult.data.configuration_snapshot?.avatar_stage !== "operating_context") {
    return json({ ok: false, message: "Avatar Operating Context stage does not match the research run." }, 409);
  }

  const progress = await stepProgress(sb, researchRunId);
  if (!progress.terminal || progress.completed === 0) {
    return json({ ok: false, message: "Avatar Operating Context cannot be finalised while recoverable work remains or no step completed.", progress }, 409);
  }

  const { data: components, error: componentError } = await sb.from("client_avatar_components")
    .select("component_type")
    .eq("client_id", clientId)
    .eq("release_id", releaseResult.data.id)
    .in("component_type", ["knowledge_expertise", "content_format"]);
  if (componentError) return json({ ok: false, message: componentError.message }, 500);
  const componentTypes = new Set((components ?? []).map((component) => component.component_type));
  if (!componentTypes.has("knowledge_expertise") || !componentTypes.has("content_format")) {
    return json({ ok: false, message: "Avatar release requires Knowledge / Expertise and Content Format components." }, 409);
  }

  const now = new Date().toISOString();
  const status = progress.failed > 0 ? "completed_partial" : "completed";
  const { data: updatedRelease, error: releaseUpdateError } = await sb.from("client_avatar_releases").update({
    status: "needs_review",
    summary: "Draft Avatar Knowledge / Expertise and Content Formats ready for human review. Downstream ideation, scripting, or production must only consume them after approval.",
    generated_at: now,
    submitted_at: now,
  }).eq("id", releaseResult.data.id).select("*").single();
  if (releaseUpdateError) return json({ ok: false, message: releaseUpdateError.message }, 500);

  const { data: updatedRun, error: runUpdateError } = await sb.from("client_research_runs").update({
    status,
    completed_at: now,
    failure_code: progress.failed > 0 ? "AVATAR_OPERATING_CONTEXT_PARTIAL" : null,
    failure_message: progress.failed > 0 ? `${progress.failed} Avatar Operating Context step(s) did not complete.` : null,
    retryable: false,
  }).eq("id", researchRunId).select("*").single();
  if (runUpdateError) return json({ ok: false, message: runUpdateError.message }, 500);

  await audit(sb, "avatar_operating_context.submitted_for_review", "client_avatar_releases", updatedRelease.id, {
    client_id: clientId,
    research_run_id: researchRunId,
    component_count: components?.length ?? 0,
  });
  return json({ ok: true, message: "Avatar Operating Context is ready for human review.", release: updatedRelease, run: updatedRun });
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
