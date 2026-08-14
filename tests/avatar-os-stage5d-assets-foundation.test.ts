import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const edgePath = new URL("../supabase/functions/run-avatar-asset-library/index.ts", import.meta.url);
const panelPath = new URL("../src/components/client/AvatarsPanel.tsx", import.meta.url);
const libPath = new URL("../src/lib/avatar-os.ts", import.meta.url);
const typesPath = new URL("../src/types/avatar-os.ts", import.meta.url);

test("Stage 5D Asset Library requires approved full Avatar OS component authority", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /Stage 5D/);
  assert.match(edge, /APPROVED_AVATAR_OPERATING_CONTEXT_REQUIRED/);
  assert.match(edge, /client_avatar_active_releases/);
  assert.match(edge, /eq\("status", "approved"\)/);
  for (const componentType of [
    "avatar_strategy",
    "appearance",
    "environment",
    "voice_personality",
    "creative_direction",
    "knowledge_expertise",
    "content_format",
  ]) {
    assert.match(edge, new RegExp(`"${componentType}"`));
  }
  assert.match(edge, /stage_5d_avatar_asset_library_foundation/);
  assert.match(edge, /avatar_stage: "asset_library"/);
});

test("Stage 5D creates an asset_library component without generated asset rows", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /Avatar Asset Library v\$\{version\}/);
  assert.match(edge, /component_type: "asset_library"/);
  assert.match(edge, /component_key: "asset_library_review"/);
  assert.match(edge, /stage_5d_asset_library_foundation: true/);
  assert.match(edge, /no_asset_rows_created_in_stage_5d: true/);
  assert.match(edge, /no_client_avatar_assets_insert: true/);
  assert.match(edge, /generate_avatar_asset_required_for_asset_rows: true/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /status: "approved"/);
});

test("Stage 5D defines all planned reusable avatar asset slots without media or storage writes", async () => {
  const edge = await readFile(edgePath, "utf8");
  for (const assetType of [
    "canonical_image",
    "pose_reference",
    "expression_reference",
    "environment_reference",
    "prompt_pack",
    "voice_reference",
    "production_reference",
    "character_sheet",
    "environment_sheet",
  ]) {
    assert.match(edge, new RegExp(assetType));
  }
  assert.match(edge, /prompt_pack_foundation/);
  assert.match(edge, /asset_generation_guardrails/);
  assert.match(edge, /no_image_generation_in_stage_5d: true/);
  assert.match(edge, /no_video_generation_in_stage_5d: true/);
  assert.match(edge, /no_audio_generation_in_stage_5d: true/);
  assert.match(edge, /no_storage_write_in_stage_5d: true/);
  assert.doesNotMatch(edge, /openai|responses\.create|web_search_preview|higgsfield/i);
});

test("Stage 5D frontend exposes Asset Library generation and display", async () => {
  const [panel, lib, types] = await Promise.all([
    readFile(panelPath, "utf8"),
    readFile(libPath, "utf8"),
    readFile(typesPath, "utf8"),
  ]);
  assert.match(panel, /driveAvatarAssetLibraryBuild/);
  assert.match(panel, /Generate Asset Library/);
  assert.match(panel, /Refresh Asset Library/);
  assert.match(panel, /AssetLibraryPanel/);
  assert.match(panel, /Planned Asset Slots/);
  assert.match(panel, /Stored Assets/);
  assert.match(panel, /No generated avatar assets yet/);
  assert.match(panel, /Generate an approved planned slot/);
  assert.match(panel, /Approve Knowledge and Content Formats before generating the Asset Library foundation/);
  assert.match(lib, /run-avatar-asset-library/);
  assert.match(lib, /driveAvatarAssetLibraryBuild/);
  assert.match(types, /PrepareAvatarAssetLibraryResponse/);
  assert.match(types, /FinalizeAvatarAssetLibraryResponse/);
});
