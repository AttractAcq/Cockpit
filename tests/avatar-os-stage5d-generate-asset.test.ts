import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260812210000_stage_5_avatar_os_foundations.sql", import.meta.url);
const edgePath = new URL("../supabase/functions/generate-avatar-asset/index.ts", import.meta.url);
const panelPath = new URL("../src/components/client/AvatarsPanel.tsx", import.meta.url);
const libPath = new URL("../src/lib/avatar-os.ts", import.meta.url);
const typesPath = new URL("../src/types/avatar-os.ts", import.meta.url);

test("Stage 5D asset records are versioned separately from immutable Avatar releases", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /client_avatar_assets_location_check/);
  assert.match(sql, /status in \('draft','needs_review','archived'\)/);
  assert.match(sql, /drop trigger if exists client_avatar_assets_release_guard/);
  assert.match(sql, /review_avatar_asset/);
  assert.match(sql, /asset must be awaiting review/);
  assert.match(sql, /storage_path or external_url before approval/);
  assert.match(sql, /avatar_asset\.reviewed/);
});

test("generate-avatar-asset consumes only approved Avatar OS Asset Library authority", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /generate-avatar-asset/);
  assert.match(edge, /validateIntelligenceAccess/);
  assert.match(edge, /client_avatar_active_releases/);
  assert.match(edge, /eq\("status", "approved"\)/);
  assert.match(edge, /APPROVED_AVATAR_ASSET_LIBRARY_REQUIRED/);
  for (const componentType of [
    "avatar_strategy",
    "appearance",
    "environment",
    "voice_personality",
    "creative_direction",
    "knowledge_expertise",
    "content_format",
    "asset_library",
  ]) {
    assert.match(edge, new RegExp(`"${componentType}"`));
  }
  assert.match(edge, /ASSET_SLOT_NOT_PLANNED/);
});

test("generate-avatar-asset stores supported asset fields as review-gated rows", async () => {
  const edge = await readFile(edgePath, "utf8");
  for (const field of [
    "asset_type",
    "component_id",
    "storage_path",
    "prompt_payload",
    "generation_provider",
    "generation_model",
    "version",
    "approved_at",
  ]) {
    assert.match(edge, new RegExp(field));
  }
  assert.match(edge, /nextAssetVersion/);
  assert.match(edge, /status: "needs_review"/);
  assert.match(edge, /approved_at: null/);
  assert.match(edge, /media_generation_performed: false/);
  assert.match(edge, /storage_write_performed: false/);
  assert.match(edge, /review_gated: true/);
  assert.doesNotMatch(edge, /status: "approved"/);
  assert.doesNotMatch(edge, /responses\.create|web_search_preview|higgsfield/i);
});

test("Stage 5D frontend can create review-gated asset records from planned slots", async () => {
  const [panel, lib, types] = await Promise.all([
    readFile(panelPath, "utf8"),
    readFile(libPath, "utf8"),
    readFile(typesPath, "utf8"),
  ]);
  assert.match(panel, /Generate Asset Record/);
  assert.match(panel, /Approve Asset Library first/);
  assert.match(panel, /canGenerateAssetRows/);
  assert.match(panel, /generateAvatarAsset/);
  assert.match(lib, /generate-avatar-asset/);
  assert.match(lib, /GenerateAvatarAssetRequest/);
  assert.match(types, /GenerateAvatarAssetRequest/);
  assert.match(types, /GenerateAvatarAssetResponse/);
});
