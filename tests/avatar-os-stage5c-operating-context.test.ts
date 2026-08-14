import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const edgePath = new URL("../supabase/functions/run-avatar-operating-context/index.ts", import.meta.url);
const panelPath = new URL("../src/components/client/AvatarsPanel.tsx", import.meta.url);
const libPath = new URL("../src/lib/avatar-os.ts", import.meta.url);
const typesPath = new URL("../src/types/avatar-os.ts", import.meta.url);

test("Stage 5C Avatar Operating Context requires approved world and creative direction authority", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /Stage 5C/);
  assert.match(edge, /APPROVED_AVATAR_WORLD_REQUIRED/);
  assert.match(edge, /client_avatar_active_releases/);
  assert.match(edge, /eq\("status", "approved"\)/);
  assert.match(edge, /loadComponent\(sb, clientId, activeRelease\.id, "avatar_strategy"\)/);
  assert.match(edge, /loadComponent\(sb, clientId, activeRelease\.id, "appearance"\)/);
  assert.match(edge, /loadComponent\(sb, clientId, activeRelease\.id, "environment"\)/);
  assert.match(edge, /loadComponent\(sb, clientId, activeRelease\.id, "voice_personality"\)/);
  assert.match(edge, /loadComponent\(sb, clientId, activeRelease\.id, "creative_direction"\)/);
  assert.match(edge, /stage_5c_avatar_operating_context_scaffold/);
  assert.match(edge, /avatar_stage: "operating_context"/);
});

test("Stage 5C carries forward approved world components and adds knowledge plus formats", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /Avatar Operating Context v\$\{version\}/);
  assert.match(edge, /avatar_strategy_approved_snapshot/);
  assert.match(edge, /appearance_approved_snapshot/);
  assert.match(edge, /environment_approved_snapshot/);
  assert.match(edge, /voice_personality_approved_snapshot/);
  assert.match(edge, /creative_direction_approved_snapshot/);
  assert.match(edge, /carried_forward_for_stage_5c: true/);
  assert.match(edge, /component_type: "knowledge_expertise"/);
  assert.match(edge, /component_key: "knowledge_expertise_review"/);
  assert.match(edge, /component_type: "content_format"/);
  assert.match(edge, /component_key: "content_formats_review"/);
  assert.match(edge, /stage_5c_scaffold: true/);
  assert.match(edge, /human_review_required: true/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /status: "approved"/);
});

test("Stage 5C defines knowledge boundaries and reusable formats without generating ideas or assets", async () => {
  const edge = await readFile(edgePath, "utf8");
  for (const field of [
    "approved_knowledge_domains",
    "proof_sources_to_reference",
    "services_products_to_reference",
    "faqs_and_customer_questions",
    "objections_avatar_can_address",
    "claim_boundaries",
    "required_evidence_policy",
    "knowledge_prompt_pack",
    "reusable_formats",
    "format_selection_rules",
    "production_handoff_fields",
    "creative_direction_reference",
    "excluded_formats_until_reviewed",
  ]) {
    assert.match(edge, new RegExp(field));
  }
  assert.match(edge, /no_content_ideation_in_stage_5c: true/);
  assert.match(edge, /no_script_generation_in_stage_5c: true/);
  assert.match(edge, /no_media_generation_in_stage_5c: true/);
  assert.match(edge, /no_invented_proof_or_expertise: true/);
  assert.match(edge, /downstream_ideation_or_production_requires_approval: true/);
  assert.doesNotMatch(edge, /openai|responses\.create|web_search_preview|higgsfield/i);
});

test("Stage 5C frontend exposes paired Knowledge and Content Formats generation and display", async () => {
  const [panel, lib, types] = await Promise.all([
    readFile(panelPath, "utf8"),
    readFile(libPath, "utf8"),
    readFile(typesPath, "utf8"),
  ]);
  assert.match(panel, /driveAvatarOperatingContextBuild/);
  assert.match(panel, /Generate Knowledge & Formats/);
  assert.match(panel, /Refresh Knowledge & Formats/);
  assert.match(panel, /KnowledgePanel/);
  assert.match(panel, /ContentFormatsPanel/);
  assert.match(panel, /Knowledge Prompt Pack/);
  assert.match(panel, /Reusable Formats/);
  assert.match(panel, /Approve Environment, Voice & Personality, and Creative Direction before generating Knowledge and Content Formats/);
  assert.match(lib, /run-avatar-operating-context/);
  assert.match(lib, /driveAvatarOperatingContextBuild/);
  assert.match(types, /PrepareAvatarOperatingContextResponse/);
  assert.match(types, /FinalizeAvatarOperatingContextResponse/);
});
