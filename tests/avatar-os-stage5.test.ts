import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260812210000_stage_5_avatar_os_foundations.sql", import.meta.url);
const edgePath = new URL("../supabase/functions/run-avatar-strategy/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/AvatarsPanel.tsx", import.meta.url);
const libPath = new URL("../src/lib/avatar-os.ts", import.meta.url);
const typesPath = new URL("../src/types/avatar-os.ts", import.meta.url);

test("Stage 5 migration creates Avatar OS authority, component, asset, and approval tables", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /'avatar_system'/);
  for (const table of [
    "client_avatar_releases",
    "client_avatar_components",
    "client_avatar_assets",
    "client_avatar_approval_decisions",
    "client_avatar_active_releases",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
  }
  assert.match(sql, /review_avatar_release/);
  assert.match(sql, /prevent_approved_avatar_release_mutation/);
  assert.match(sql, /client_avatar_active_release_fk/);
  assert.match(sql, /references public\.client_avatar_releases\(id, client_id\) on delete restrict/);
});

test("Avatar OS schema models a communication identity system, not proof replacement or content ideation", async () => {
  const sql = await readFile(migrationPath, "utf8");
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
    assert.match(sql, new RegExp(`'${componentType}'`));
  }
  for (const assetType of [
    "canonical_image",
    "character_sheet",
    "environment_sheet",
    "prompt_pack",
    "voice_reference",
    "production_reference",
  ]) {
    assert.match(sql, new RegExp(`'${assetType}'`));
  }
  assert.match(sql, /amplifies proof and expertise; it does not\s*-- replace proof, invent client facts, or create content ideas/i);
  assert.match(sql, /does not replace proof or generate content ideas/i);
});

test("Avatar Strategy edge requires approved upstream authority and performs no media or provider generation", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /REQUIRED_INTELLIGENCE_DOMAINS = \["market_os", "avatar_os", "brand_strategist"\]/);
  assert.match(edge, /AVATAR_CONTEXT_REQUIRED/);
  assert.match(edge, /APPROVED_AVATAR_UPSTREAM_REQUIRED/);
  assert.match(edge, /research_domain: "avatar_system"/);
  assert.match(edge, /model: "stage_5b_avatar_strategy_scaffold"/);
  assert.match(edge, /component_type: "avatar_strategy"/);
  assert.match(edge, /stage_5b_scaffold: true/);
  assert.match(edge, /human_review_required: true/);
  assert.match(edge, /Proof remains substance; avatar and creative identity are delivery/);
  assert.match(edge, /no_image_generation: true/);
  assert.match(edge, /no_voice_generation: true/);
  assert.match(edge, /no_existing_character_ip_without_rights_review: true/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /openai|responses\.create|web_search_preview|higgsfield|tools:\s*\[/i);
  assert.doesNotMatch(edge, /status: "approved"/);
});

test("Avatar OS frontend is a separate Avatars surface after Offers and before Ideation", async () => {
  const [page, panel, lib, types] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(panelPath, "utf8"),
    readFile(libPath, "utf8"),
    readFile(typesPath, "utf8"),
  ]);
  assert.match(page, /label: "Avatar OS", section: "avatar"/);
  assert.match(page, /label: "Avatars"/);
  assert.match(page, /defaultSection: "avatars"/);
  assert.match(page, /<AvatarsPanel clientId=\{id\} \/>/);
  assert.match(page, /label: "Offer"[\s\S]*label: "Avatars"[\s\S]*label: "Ideation"/);
  assert.match(panel, /Owned communication identity and creative-world authority/i);
  assert.match(panel, /Proof remains substance; avatars are delivery/i);
  assert.match(panel, /Generate Avatar Strategy/);
  assert.match(panel, /Approve &amp; activate/);
  assert.match(panel, /Voice & Personality/);
  assert.match(panel, /Content Formats/);
  assert.match(panel, /No media generation in Stage 5C/);
  assert.match(panel, /Review history/);
  assert.match(lib, /run-avatar-strategy/);
  assert.match(lib, /review_avatar_release/);
  assert.match(lib, /client_avatar_approval_decisions/);
  assert.match(types, /export type AvatarComponentType/);
});
