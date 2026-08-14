import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260813090000_stage_5e_avatar_ideation_integration.sql", import.meta.url);
const strategicInputsPath = new URL("../supabase/functions/_shared/ideation/strategic-inputs.ts", import.meta.url);
const requestPath = new URL("../supabase/functions/_shared/ideation/request.ts", import.meta.url);
const handlerPath = new URL("../supabase/functions/run-ideation/handler.ts", import.meta.url);
const modelPath = new URL("../supabase/functions/_shared/ideation/model.ts", import.meta.url);
const evidencePath = new URL("../supabase/functions/_shared/ideation/evidence.ts", import.meta.url);
const typesPath = new URL("../src/types/ideation.ts", import.meta.url);
const panelPath = new URL("../src/components/client/IdeationPanel.tsx", import.meta.url);

test("Stage 5E migration adds Avatar OS as an optional Ideation authority input", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /approved_avatar_os/);
  assert.match(sql, /avatar_component_id uuid/);
  assert.match(sql, /client_ideation_inputs_avatar_component_fk/);
  assert.match(sql, /references public\.client_avatar_components\(id, client_id\) on delete restrict/);
  assert.match(sql, /source_kind in \(\s*'campaign_intelligence',\s*'main_offer',\s*'seasonal_offer',\s*'avatar'/);
  assert.match(sql, /source_kind = 'avatar'/);
  assert.match(sql, /avatar_component_id is not null/);
  assert.match(sql, /does not require candidates to sell an offer, follow a campaign exclusively, or become avatar-led/i);
});

test("Stage 5E loader consumes approved Avatar OS components without generating ideas or assets", async () => {
  const helper = await readFile(strategicInputsPath, "utf8");
  assert.match(helper, /client_avatar_active_releases/);
  assert.match(helper, /client_avatar_releases/);
  assert.match(helper, /client_avatar_components/);
  assert.match(helper, /eq\("status", "approved"\)/);
  assert.match(helper, /sourceType: "approved_avatar_os"/);
  assert.match(helper, /source_kind: "avatar"/);
  assert.match(helper, /avatar_component_id: component\.id/);
  assert.match(helper, /knowledge_boundaries/);
  assert.match(helper, /format_selection_rules/);
  assert.match(helper, /voice_direction/);
  assert.match(helper, /campaign_offer_avatar_inputs_v1/);
  assert.doesNotMatch(helper, /insert\(|status:\s*"approved"|openai|responses\.create|web_search_preview|generate-avatar-asset/i);
});

test("Stage 5E request and run defaults keep Avatar OS selectable but optional", async () => {
  const [request, handler] = await Promise.all([
    readFile(requestPath, "utf8"),
    readFile(handlerPath, "utf8"),
  ]);
  assert.match(request, /"avatar"/);
  assert.match(request, /may only contain campaign_intelligence, main_offer, seasonal_offer, or avatar/);
  assert.match(handler, /\["campaign_intelligence", "main_offer", "seasonal_offer", "avatar"\]/);
});

test("Stage 5E model separates Avatar communication identity from required content provenance", async () => {
  const [model, evidence] = await Promise.all([
    readFile(modelPath, "utf8"),
    readFile(evidencePath, "utf8"),
  ]);
  assert.match(evidence, /approved_avatar_os/);
  assert.match(model, /APPROVED AVATAR OS — OPTIONAL COMMUNICATION IDENTITY CONTEXT/);
  assert.match(model, /Avatar-led ideas are optional/);
  assert.match(model, /do not make every candidate avatar-led/);
  assert.match(model, /never invent expertise outside the\s+approved Avatar OS knowledge boundaries/);
  assert.match(model, /No approved Avatar OS input is active for this run/);
});

test("Stage 5E frontend exposes Avatar OS in the Ideation source policy", async () => {
  const [types, panel] = await Promise.all([
    readFile(typesPath, "utf8"),
    readFile(panelPath, "utf8"),
  ]);
  assert.match(types, /IdeationStrategicSourceKind = "campaign_intelligence" \| "main_offer" \| "seasonal_offer" \| "avatar"/);
  assert.match(types, /approved_avatar_os/);
  assert.match(types, /avatar_component_id: string \| null/);
  assert.match(panel, /Avatar OS/);
  assert.match(panel, /Use approved voice, knowledge boundaries, formats, and creative identity/);
  assert.match(panel, /Optional Campaign, Offer, and Avatar authority available to this Ideation cycle/);
  assert.match(panel, /avatar-led ideas are never mandatory/);
  assert.match(panel, /reference\.source_url\.includes\("\/avatars\/"\)/);
});
