// Stage 5D — generate-avatar-asset records.
//
// This function consumes only approved Avatar OS authority and creates a
// review-gated client_avatar_assets row for a planned Asset Library slot. It
// does not fabricate media, write storage objects, or mark assets approved.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";

type ServiceClient = ReturnType<typeof svc>;
type AvatarAssetType =
  | "canonical_image"
  | "pose_reference"
  | "expression_reference"
  | "environment_reference"
  | "character_sheet"
  | "environment_sheet"
  | "prompt_pack"
  | "voice_reference"
  | "production_reference"
  | "other";

type ComponentType =
  | "avatar_strategy"
  | "appearance"
  | "environment"
  | "voice_personality"
  | "creative_direction"
  | "knowledge_expertise"
  | "content_format"
  | "asset_library";

interface AvatarReleaseRow {
  id: string;
  client_id: string;
  version: number;
  status: string;
  title: string;
  summary: string;
  authority_snapshot: Record<string, unknown>;
  approved_at: string | null;
}

interface AvatarComponentRow {
  id: string;
  client_id: string;
  release_id: string;
  component_type: ComponentType;
  component_key: string;
  title: string;
  summary: string;
  structured_payload: Record<string, unknown>;
  upstream_refs: unknown[];
  generation_contract: Record<string, unknown>;
}

interface GenerateAvatarAssetBody {
  client_id?: unknown;
  asset_type?: unknown;
  title?: unknown;
  description?: unknown;
  storage_bucket?: unknown;
  storage_path?: unknown;
  external_url?: unknown;
  generation_provider?: unknown;
  generation_model?: unknown;
}

const AVATAR_ASSET_TYPES: AvatarAssetType[] = [
  "canonical_image",
  "pose_reference",
  "expression_reference",
  "environment_reference",
  "character_sheet",
  "environment_sheet",
  "prompt_pack",
  "voice_reference",
  "production_reference",
  "other",
];

const REQUIRED_COMPONENTS: ComponentType[] = [
  "avatar_strategy",
  "appearance",
  "environment",
  "voice_personality",
  "creative_direction",
  "knowledge_expertise",
  "content_format",
  "asset_library",
];

const PRIMARY_COMPONENT_BY_ASSET_TYPE: Record<AvatarAssetType, ComponentType> = {
  canonical_image: "appearance",
  pose_reference: "appearance",
  expression_reference: "appearance",
  environment_reference: "environment",
  character_sheet: "appearance",
  environment_sheet: "environment",
  prompt_pack: "asset_library",
  voice_reference: "voice_personality",
  production_reference: "creative_direction",
  other: "asset_library",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function isAvatarAssetType(value: unknown): value is AvatarAssetType {
  return typeof value === "string" && AVATAR_ASSET_TYPES.includes(value as AvatarAssetType);
}

function recordText(value: Record<string, unknown>, key: string): string | null {
  const item = value[key];
  return typeof item === "string" && item.trim() ? item.trim() : null;
}

function plannedSlots(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const slots = payload.planned_asset_slots;
  if (!Array.isArray(slots)) return [];
  return slots.filter(isRecord);
}

async function loadComponent(
  sb: ServiceClient,
  clientId: string,
  releaseId: string,
  componentType: ComponentType,
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

async function loadApprovedAvatarAuthority(
  sb: ServiceClient,
  clientId: string,
): Promise<
  | { ok: true; release: AvatarReleaseRow; components: Record<ComponentType, AvatarComponentRow> }
  | { ok: false; status: number; code: string; message: string }
> {
  const { data: pointer, error: pointerError } = await sb.from("client_avatar_active_releases")
    .select("release_id")
    .eq("client_id", clientId)
    .maybeSingle();
  if (pointerError) {
    return { ok: false, status: 500, code: "AVATAR_ACTIVE_RELEASE_LOAD_FAILED", message: pointerError.message };
  }
  if (!pointer?.release_id) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_ASSET_LIBRARY_REQUIRED",
      message: "Generate Avatar Asset requires an approved active Avatar release with an approved Asset Library foundation.",
    };
  }

  const { data: release, error: releaseError } = await sb.from("client_avatar_releases")
    .select("*")
    .eq("client_id", clientId)
    .eq("id", pointer.release_id)
    .eq("status", "approved")
    .maybeSingle();
  if (releaseError || !release) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_ASSET_LIBRARY_REQUIRED",
      message: releaseError?.message ?? "The active Avatar release is not approved.",
    };
  }

  const loaded = await Promise.all(REQUIRED_COMPONENTS.map((componentType) =>
    loadComponent(sb, clientId, release.id, componentType)
  ));
  const missing = REQUIRED_COMPONENTS.filter((_, index) => !loaded[index]);
  if (missing.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_AVATAR_ASSET_LIBRARY_REQUIRED",
      message: `Generate Avatar Asset requires approved Avatar OS components first: ${missing.join(", ")}.`,
    };
  }

  return {
    ok: true,
    release: release as AvatarReleaseRow,
    components: Object.fromEntries(REQUIRED_COMPONENTS.map((componentType, index) => [
      componentType,
      loaded[index] as AvatarComponentRow,
    ])) as Record<ComponentType, AvatarComponentRow>,
  };
}

async function nextAssetVersion(
  sb: ServiceClient,
  clientId: string,
  releaseId: string,
  assetType: AvatarAssetType,
): Promise<number> {
  const { data, error } = await sb.from("client_avatar_assets")
    .select("version")
    .eq("client_id", clientId)
    .eq("release_id", releaseId)
    .eq("asset_type", assetType)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const current = isRecord(data) && typeof data.version === "number" ? data.version : 0;
  return current + 1;
}

function buildPromptPayload(
  assetType: AvatarAssetType,
  slot: Record<string, unknown>,
  release: AvatarReleaseRow,
  components: Record<ComponentType, AvatarComponentRow>,
): Record<string, unknown> {
  const primaryComponentType = PRIMARY_COMPONENT_BY_ASSET_TYPE[assetType];
  const sourceComponentTypes = Array.isArray(slot.source_component_types)
    ? slot.source_component_types.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [primaryComponentType, "asset_library"];
  const sourceComponents = Object.fromEntries(sourceComponentTypes
    .filter((componentType): componentType is ComponentType => REQUIRED_COMPONENTS.includes(componentType as ComponentType))
    .map((componentType) => [
      componentType,
      {
        id: components[componentType].id,
        component_key: components[componentType].component_key,
        title: components[componentType].title,
        summary: components[componentType].summary,
        structured_payload: components[componentType].structured_payload,
      },
    ]));

  return {
    avatar_stage: "generate_avatar_asset",
    asset_type: assetType,
    status_contract: "needs_review_until_human_approved",
    media_generation_performed: false,
    storage_write_performed: false,
    approval_gate_required: true,
    planned_slot: slot,
    source_release: {
      id: release.id,
      version: release.version,
      title: release.title,
      approved_at: release.approved_at,
    },
    source_components: sourceComponents,
    asset_library_prompt_pack_foundation: components.asset_library.structured_payload.prompt_pack_foundation ?? {},
    asset_generation_guardrails: components.asset_library.structured_payload.asset_generation_guardrails ?? [],
    output_contract: {
      review_status: "needs_review",
      approval_requires_human_review: true,
      non_text_assets_require_storage_path_or_external_url_before_approval: true,
      do_not_invent_client_proof_or_expertise: true,
      existing_character_references_require_rights_review: true,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "POST required." }, 405);

  const sb = svc();
  let body: GenerateAvatarAssetBody;
  try {
    body = await req.json() as GenerateAvatarAssetBody;
  } catch {
    return json({ ok: false, code: "BAD_JSON", message: "Request body must be JSON." }, 400);
  }

  const clientId = optionalText(body.client_id);
  if (!clientId) return json({ ok: false, code: "CLIENT_ID_REQUIRED", message: "client_id is required." }, 400);
  if (!isAvatarAssetType(body.asset_type)) {
    return json({ ok: false, code: "INVALID_ASSET_TYPE", message: "A valid avatar asset_type is required." }, 400);
  }
  const requestedAssetType = body.asset_type;

  const access = await validateIntelligenceAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ ok: false, ...access }, access.status);

  const authority = await loadApprovedAvatarAuthority(sb, clientId);
  if (!authority.ok) return json({ ok: false, ...authority }, authority.status);

  const slot = plannedSlots(authority.components.asset_library.structured_payload)
    .find((candidate) => recordText(candidate, "asset_type") === requestedAssetType);
  if (!slot) {
    return json({
      ok: false,
      status: 409,
      code: "ASSET_SLOT_NOT_PLANNED",
      message: `Asset type ${requestedAssetType} is not present in the approved Avatar Asset Library slots.`,
    }, 409);
  }

  try {
    const assetType = requestedAssetType;
    const primaryComponent = authority.components[PRIMARY_COMPONENT_BY_ASSET_TYPE[assetType]];
    const version = await nextAssetVersion(sb, clientId, authority.release.id, assetType);
    const title = optionalText(body.title) ?? recordText(slot, "title") ?? `Avatar ${readable(assetType)}`;
    const description = optionalText(body.description) ?? recordText(slot, "purpose") ?? "Review-gated Avatar OS asset generation record.";
    const storageBucket = optionalText(body.storage_bucket);
    const storagePath = optionalText(body.storage_path);
    const externalUrl = optionalText(body.external_url);
    const generationProvider = optionalText(body.generation_provider) ?? "avatar_os";
    const generationModel = optionalText(body.generation_model) ?? "asset_record_scaffold_v1";
    const promptPayload = buildPromptPayload(assetType, slot, authority.release, authority.components);

    const { data: asset, error: insertError } = await sb.from("client_avatar_assets").insert({
      client_id: clientId,
      release_id: authority.release.id,
      component_id: primaryComponent.id,
      asset_type: assetType,
      title,
      description,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      external_url: externalUrl,
      prompt_payload: promptPayload,
      generation_provider: generationProvider,
      generation_model: generationModel,
      status: "needs_review",
      version,
      approved_at: null,
    }).select("*").single();
    if (insertError) throw new Error(insertError.message);

    await audit(sb, "avatar_asset.generated", "client_avatar_assets", asset.id, {
      client_id: clientId,
      release_id: authority.release.id,
      asset_type: assetType,
      version,
      generation_provider: generationProvider,
      generation_model: generationModel,
      review_gated: true,
    });

    return json({
      ok: true,
      message: `${title} asset record created for review.`,
      asset,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await audit(sb, "avatar_asset.generate_failed", "client_avatar_assets", null, {
      client_id: clientId,
      asset_type: requestedAssetType,
      error: message,
    });
    return json({ ok: false, code: "GENERATE_AVATAR_ASSET_FAILED", message }, 500);
  }
});
