import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const edgePath = new URL("../supabase/functions/run-avatar-appearance/index.ts", import.meta.url);
const panelPath = new URL("../src/components/client/AvatarsPanel.tsx", import.meta.url);
const libPath = new URL("../src/lib/avatar-os.ts", import.meta.url);
const typesPath = new URL("../src/types/avatar-os.ts", import.meta.url);

test("Stage 5C Appearance requires approved Avatar Strategy authority", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /Stage 5C/);
  assert.match(edge, /APPROVED_AVATAR_STRATEGY_REQUIRED/);
  assert.match(edge, /client_avatar_active_releases/);
  assert.match(edge, /eq\("status", "approved"\)/);
  assert.match(edge, /eq\("component_type", "avatar_strategy"\)/);
  assert.match(edge, /stage_5c_avatar_appearance_scaffold/);
  assert.match(edge, /avatar_stage: "appearance"/);
  assert.match(edge, /source_avatar_strategy_component_id/);
});

test("Stage 5C creates a new review-gated Avatar release with strategy carried forward", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /Avatar Appearance v\$\{version\}/);
  assert.match(edge, /avatar_strategy_approved_snapshot/);
  assert.match(edge, /carried_forward_for_stage_5c: true/);
  assert.match(edge, /component_type: "appearance"/);
  assert.match(edge, /component_key: "appearance_review"/);
  assert.match(edge, /stage_5c_scaffold: true/);
  assert.match(edge, /human_review_required: true/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /status: "approved"/);
});

test("Stage 5C Appearance is structured visual identity, not media generation", async () => {
  const edge = await readFile(edgePath, "utf8");
  for (const field of [
    "face_direction",
    "apparent_age_direction",
    "body_type_direction",
    "hair_direction",
    "facial_hair_direction",
    "clothing_direction",
    "accessory_direction",
    "distinguishing_characteristics",
    "expression_set",
    "pose_set",
    "canonical_visual_rules",
    "reference_prompt_pack",
  ]) {
    assert.match(edge, new RegExp(field));
  }
  assert.match(edge, /no_media_generation_in_stage_5c: true/);
  assert.match(edge, /no_image_generation: true/);
  assert.match(edge, /no_voice_generation: true/);
  assert.match(edge, /no_existing_character_ip_without_rights_review: true/);
  assert.match(edge, /no_invented_sensitive_traits: true/);
  assert.doesNotMatch(edge, /openai|responses\.create|web_search_preview|higgsfield|tools:\s*\[/i);
});

test("Stage 5C frontend exposes Appearance generation and display while later tabs stay locked", async () => {
  const [panel, lib, types] = await Promise.all([
    readFile(panelPath, "utf8"),
    readFile(libPath, "utf8"),
    readFile(typesPath, "utf8"),
  ]);
  assert.match(panel, /driveAvatarAppearanceBuild/);
  assert.match(panel, /Generate Appearance/);
  assert.match(panel, /Refresh Appearance/);
  assert.match(panel, /AppearancePanel/);
  assert.match(panel, /Reference Prompt Pack/);
  assert.match(panel, /Visual Guardrails/);
  assert.match(panel, /Generate in later stage/);
  assert.match(panel, /Approve Avatar Strategy before generating Appearance/);
  assert.match(lib, /run-avatar-appearance/);
  assert.match(lib, /driveAvatarAppearanceBuild/);
  assert.match(types, /PrepareAvatarAppearanceResponse/);
  assert.match(types, /FinalizeAvatarAppearanceResponse/);
});
