import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260812200000_phase_4c_ideation_strategic_inputs.sql", import.meta.url);
const strategicInputsPath = new URL("../supabase/functions/_shared/ideation/strategic-inputs.ts", import.meta.url);
const handlerPath = new URL("../supabase/functions/run-ideation/handler.ts", import.meta.url);
const requestPath = new URL("../supabase/functions/_shared/ideation/request.ts", import.meta.url);
const indexPath = new URL("../supabase/functions/run-ideation/index.ts", import.meta.url);
const modelPath = new URL("../supabase/functions/_shared/ideation/model.ts", import.meta.url);
const typesPath = new URL("../src/types/ideation.ts", import.meta.url);
const apiPath = new URL("../src/lib/api.ts", import.meta.url);
const panelPath = new URL("../src/components/client/IdeationPanel.tsx", import.meta.url);

test("Phase 4C migration bridges approved Campaign and Offer inputs into Ideation", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /create table public\.client_ideation_authority_inputs/);
  assert.match(sql, /client_ideation_research_source_type_check/);
  for (const sourceType of [
    "approved_campaign_intelligence",
    "approved_main_offer",
    "approved_seasonal_offer",
  ]) {
    assert.match(sql, new RegExp(`'${sourceType}'`));
  }
  assert.match(sql, /source_kind in \(\s*'campaign_intelligence','main_offer','seasonal_offer'/);
  assert.match(sql, /references public\.client_ideation_cycles\(id, client_id\) on delete cascade/);
  assert.match(sql, /references public\.client_campaign_periods\(id, client_id\) on delete restrict/);
  assert.match(sql, /references public\.client_main_offers\(id, client_id\) on delete restrict/);
  assert.match(sql, /references public\.client_seasonal_offers\(id, client_id\) on delete restrict/);
  assert.doesNotMatch(sql, /source_release_id, client_id\)\s+references public\.client_campaign_intelligence_releases/);
  assert.match(sql, /does not require candidates to sell an offer or follow a campaign exclusively/i);
});

test("Stage 4C helper loads active approved inputs without generating offers or content", async () => {
  const helper = await readFile(strategicInputsPath, "utf8");
  assert.match(helper, /loadIdeationStrategicInputs/);
  assert.match(helper, /client_campaign_intelligence_active_releases/);
  assert.match(helper, /client_offer_architecture_active_releases/);
  assert.match(helper, /client_seasonal_offer_active_releases/);
  assert.match(helper, /sourceType: "approved_campaign_intelligence"/);
  assert.match(helper, /sourceType: "approved_main_offer"/);
  assert.match(helper, /sourceType: "approved_seasonal_offer"/);
  assert.match(helper, /sourceKinds\?: SourceKind\[\]/);
  assert.match(helper, /selected_source_kinds/);
  assert.match(helper, /dream_outcome/);
  assert.match(helper, /cta_direction/);
  assert.doesNotMatch(helper, /insert\(|status:\s*"approved"|openai|responses\.create|web_search_preview/i);
});

test("run-ideation records strategic inputs and keeps them optional", async () => {
  const [handler, model] = await Promise.all([
    readFile(handlerPath, "utf8"),
    readFile(modelPath, "utf8"),
  ]);
  assert.match(handler, /buildStrategicInputEvidenceSources\?/);
  assert.match(handler, /strategic_input_sources/);
  assert.match(handler, /recordAuthorityInputs\?/);
  assert.match(handler, /ideation_hub_inputs/);
  assert.match(handler, /\.\.\.strategicInputs\.evidenceSources/);
  assert.match(model, /OPTIONAL STRATEGIC TIMING CONTEXT/);
  assert.match(model, /does not require every candidate to promote a campaign/);
  assert.match(model, /does not make every candidate sales-led/);
});

test("Stage 3 source policy travels from request to production strategic inputs", async () => {
  const [request, handler, index, types, api] = await Promise.all([
    readFile(requestPath, "utf8"),
    readFile(handlerPath, "utf8"),
    readFile(indexPath, "utf8"),
    readFile(typesPath, "utf8"),
    readFile(apiPath, "utf8"),
  ]);
  assert.match(request, /strategic_input_sources\?: Array/);
  assert.match(request, /cannot contain duplicates/);
  assert.match(request, /may only contain campaign_intelligence, main_offer, or seasonal_offer/);
  assert.match(handler, /parsedBody\.body\.strategic_input_sources/);
  assert.match(index, /loadIdeationStrategicInputs\(.*sourceKinds/s);
  assert.match(types, /IdeationStrategicSourceKind/);
  assert.match(api, /strategic_input_sources: input\.strategic_input_sources/);
});

test("Ideation frontend exposes strategic inputs as a hub source, not a required chain", async () => {
  const [types, api, panel] = await Promise.all([
    readFile(typesPath, "utf8"),
    readFile(apiPath, "utf8"),
    readFile(panelPath, "utf8"),
  ]);
  assert.match(types, /interface IdeationAuthorityInput/);
  assert.match(types, /authority_inputs: IdeationAuthorityInput\[\]/);
  assert.match(types, /strategic_input_sources\?: IdeationStrategicSourceKind\[\]/);
  assert.match(api, /client_ideation_authority_inputs/);
  assert.match(api, /authority_inputs: \(authorityInputsResult\.data \?\? \[\]\)/);
  assert.match(panel, /StrategicInputsCard/);
  assert.match(panel, /Strategic source mix/);
  assert.match(panel, /Source policy/);
  assert.match(panel, /STRATEGIC_SOURCE_OPTIONS/);
  assert.match(panel, /strategic_input_sources: strategicSourceKinds/);
  assert.match(panel, /Optional Campaign and Offer authority available to this Ideation cycle/);
  assert.match(panel, /No approved Campaign Intelligence or Offer inputs were active/);
});
