import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  allowsReelStudio,
  PRODUCTION_MODE_LABEL,
} from "../supabase/functions/_shared/production-mode-contract.ts";
import {
  missingBriefSections,
  PRODUCTION_BRIEF_CONTRACTS,
  requiredBriefSections,
} from "../supabase/functions/_shared/production-brief-contract.ts";

const root = new URL("../", import.meta.url);
async function file(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("Stage 5E migration adds production modes and optional Avatar OS references", async () => {
  const sql = await file("supabase/migrations/20260813100000_stage_5e_avatar_production_reel_integration.sql");

  for (const mode of ["avatar_led", "faceless", "proof_led", "static", "human_led"]) {
    assert.match(sql, new RegExp(`'${mode}'::text`));
  }

  assert.match(sql, /alter table public\.client_production_briefs[\s\S]*add column if not exists avatar_release_id uuid/);
  assert.match(sql, /add column if not exists avatar_component_ids uuid\[\] not null default '\{\}'::uuid\[\]/);
  assert.match(sql, /add column if not exists avatar_asset_ids uuid\[\] not null default '\{\}'::uuid\[\]/);
  assert.match(sql, /add column if not exists avatar_reference_payload jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /alter table public\.video_projects[\s\S]*add column if not exists avatar_release_id uuid/);
  assert.match(sql, /video_projects_avatar_reference_payload_check/);
  assert.match(sql, /client_production_briefs_avatar_release_fk/);
  assert.match(sql, /video_projects_avatar_release_fk/);
});

test("production contracts expose avatar-led mode without replacing existing modes", () => {
  assert.equal(PRODUCTION_MODE_LABEL.avatar_led, "Avatar-led production");
  assert.equal(allowsReelStudio("avatar_led"), true);
  assert.equal(allowsReelStudio("faceless"), false);
  assert.equal(allowsReelStudio("proof_led"), false);

  const reelModes = [...PRODUCTION_BRIEF_CONTRACTS.reel_video.supportedModes];
  assert.deepEqual(reelModes, ["human", "ai", "hybrid", "avatar_led", "faceless", "proof_led", "human_led"]);
  assert.equal(reelModes.includes("static"), false);

  const imageModes = [...PRODUCTION_BRIEF_CONTRACTS.feed_post.supportedModes];
  assert.equal(imageModes.includes("static"), true);
  assert.equal(imageModes.includes("avatar_led"), true);
});

test("avatar-led briefs require Avatar OS reference sections", () => {
  const sections = requiredBriefSections("reel_video", "avatar_led");
  assert.equal(sections.includes("Avatar OS References"), true);
  assert.equal(sections.includes("Avatar Knowledge Boundaries"), true);
  assert.equal(sections.includes("Human Production Only"), false);

  const markdown = sections.map((section) => `## ${section}\ncontent`).join("\n\n");
  assert.deepEqual(missingBriefSections(markdown, "reel_video", "avatar_led"), []);
});

test("Reel Studio creation and storyboarding consume approved Avatar OS references only for avatar-led projects", async () => {
  const createProject = await file("supabase/functions/create-video-project/index.ts");
  assert.match(createProject, /productionMode === "avatar_led"/);
  assert.match(createProject, /client_avatar_active_releases/);
  assert.match(createProject, /release\.status !== "approved"/);
  assert.match(createProject, /client_avatar_assets[\s\S]*\.eq\("status", "approved"\)/);
  assert.match(createProject, /avatar_reference_payload: avatarRefs\.payload/);

  const contextPack = await file("supabase/functions/_shared/reel-studio-context-pack.ts");
  assert.match(contextPack, /avatar_os/);
  assert.match(contextPack, /Approved Avatar OS reference pack/);
  assert.match(contextPack, /vertical 9:16 avatar-led Instagram Reel/);

  const storyboard = await file("supabase/functions/generate-video-storyboard/index.ts");
  assert.match(storyboard, /brief\.production_mode === "avatar_led"/);
  assert.match(storyboard, /avatarPromptContext/);
  assert.match(storyboard, /avatar-led/);

  const compiler = await file("supabase/functions/_shared/reel-studio-prompt-compiler.ts");
  assert.match(compiler, /avatarPromptContext/);
  assert.match(compiler, /Avatar-led frame/);
  assert.match(compiler, /no unapproved character design/);
});
