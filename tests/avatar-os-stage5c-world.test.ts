import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const edgePath = new URL("../supabase/functions/run-avatar-world/index.ts", import.meta.url);
const panelPath = new URL("../src/components/client/AvatarsPanel.tsx", import.meta.url);
const libPath = new URL("../src/lib/avatar-os.ts", import.meta.url);
const typesPath = new URL("../src/types/avatar-os.ts", import.meta.url);

test("Stage 5C Avatar World requires approved Strategy and Appearance authority", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /Stage 5C/);
  assert.match(edge, /APPROVED_AVATAR_APPEARANCE_REQUIRED/);
  assert.match(edge, /client_avatar_active_releases/);
  assert.match(edge, /eq\("status", "approved"\)/);
  assert.match(edge, /loadComponent\(sb, clientId, activeRelease\.id, "avatar_strategy"\)/);
  assert.match(edge, /loadComponent\(sb, clientId, activeRelease\.id, "appearance"\)/);
  assert.match(edge, /stage_5c_avatar_world_scaffold/);
  assert.match(edge, /avatar_stage: "world"/);
  assert.match(edge, /source_avatar_appearance_component_id/);
});

test("Stage 5C carries forward approved components and adds environment, voice, plus creative direction", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /Avatar World v\$\{version\}/);
  assert.match(edge, /avatar_strategy_approved_snapshot/);
  assert.match(edge, /appearance_approved_snapshot/);
  assert.match(edge, /carried_forward_for_stage_5c: true/);
  assert.match(edge, /component_type: "environment"/);
  assert.match(edge, /component_key: "environment_review"/);
  assert.match(edge, /component_type: "voice_personality"/);
  assert.match(edge, /component_key: "voice_personality_review"/);
  assert.match(edge, /component_type: "creative_direction"/);
  assert.match(edge, /component_key: "creative_direction_review"/);
  assert.match(edge, /stage_5c_scaffold: true/);
  assert.match(edge, /human_review_required: true/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /status: "approved"/);
});

test("Stage 5C defines world, communication behaviour, and creative direction without producing media or scripts", async () => {
  const edge = await readFile(edgePath, "utf8");
  for (const field of [
    "primary_environment_concept",
    "recurring_sets",
    "props_and_tools",
    "lighting_direction",
    "visual_atmosphere",
    "environment_prompt_pack",
    "accent_direction",
    "vocabulary_direction",
    "humour_direction",
    "recurring_phrases",
    "mannerisms",
    "teaching_style",
    "voice_prompt_pack",
    "camera_style",
    "shot_types",
    "editing_pace",
    "creative_prompt_pack",
  ]) {
    assert.match(edge, new RegExp(field));
  }
  assert.match(edge, /no_media_generation_in_stage_5c: true/);
  assert.match(edge, /no_audio_generation_in_stage_5c: true/);
  assert.match(edge, /no_script_generation_in_stage_5c: true/);
  assert.match(edge, /no_voice_cloning_without_rights_review: true/);
  assert.match(edge, /no_existing_character_ip_without_rights_review: true/);
  assert.doesNotMatch(edge, /openai|responses\.create|web_search_preview|higgsfield/i);
});

test("Stage 5C frontend exposes Environment, Voice, and Creative Direction generation and display", async () => {
  const [panel, lib, types] = await Promise.all([
    readFile(panelPath, "utf8"),
    readFile(libPath, "utf8"),
    readFile(typesPath, "utf8"),
  ]);
  assert.match(panel, /driveAvatarWorldBuild/);
  assert.match(panel, /Generate Environment, Voice & Creative/);
  assert.match(panel, /Refresh Environment, Voice & Creative/);
  assert.match(panel, /EnvironmentPanel/);
  assert.match(panel, /VoicePersonalityPanel/);
  assert.match(panel, /CreativeDirectionPanel/);
  assert.match(panel, /Environment Prompt Pack/);
  assert.match(panel, /Voice Prompt Pack/);
  assert.match(panel, /Approve Appearance before generating Environment, Voice & Personality, and Creative Direction/);
  assert.match(lib, /run-avatar-world/);
  assert.match(lib, /driveAvatarWorldBuild/);
  assert.match(types, /PrepareAvatarWorldResponse/);
  assert.match(types, /FinalizeAvatarWorldResponse/);
});
