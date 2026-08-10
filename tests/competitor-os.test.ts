import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COMPETITOR_CORE_MODULES,
  extractCompetitorResearchSources,
  parseCompetitorModuleOutput,
} from "../supabase/functions/_shared/intelligence/competitor-research-provider.ts";

const providerPath = new URL("../supabase/functions/_shared/intelligence/competitor-research-provider.ts", import.meta.url);
const edgePath = new URL("../supabase/functions/run-competitor-os/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/CompetitorOSPanel.tsx", import.meta.url);

function structuredModule(moduleKey = "alternative_registry") {
  return {
    module_key: moduleKey,
    summary: "A supported competitive alternative system.",
    records: [{
      record_key: "example_agency",
      subject_key: "example_agency",
      alternative_type: "direct",
      observation_kind: "alternative_identity",
      observed_at: "2026-08-10T00:00:00.000Z",
      title: "Example agency",
      summary: "A direct buyer-visible alternative.",
      details: [{ label: "Alternative type", value: "Direct" }],
      findings: [{
        claim: "Example agency publicly serves the same buyer problem.",
        disposition: "asserted",
        confidence: "strongly_inferred",
        rationale: "Supported by public and approved upstream authority.",
        source_urls: ["https://example.com/services"],
        context_file_numbers: [1],
        market_record_keys: ["buying_mechanism"],
        avatar_record_keys: ["economic_buyer"],
      }],
    }],
    unknowns: [],
    contradictions: [],
  };
}

test("Competitor OS covers registry, maps, observation libraries, and system patterns", () => {
  assert.deepEqual(
    COMPETITOR_CORE_MODULES.map((module) => module.key),
    ["alternative_registry", "positioning_category_map", "offer_commercial_observations", "messaging_claims", "proof_trust", "distribution_attention", "landscape_patterns"],
  );
});

test("Competitor provider preserves Context, Market, Avatar, and web evidence identities", () => {
  const payload = {
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(structuredModule()) }] }],
  };
  const output = parseCompetitorModuleOutput(payload, "alternative_registry");
  assert.deepEqual(output.records[0].findings[0].market_record_keys, ["buying_mechanism"]);
  assert.deepEqual(output.records[0].findings[0].avatar_record_keys, ["economic_buyer"]);
  assert.equal(output.records[0].alternative_type, "direct");
  assert.throws(() => parseCompetitorModuleOutput(payload, "proof_trust"), /invalid identity/i);
});

test("Competitor source extraction keeps only inspectable, deduplicated HTTP sources", () => {
  const sources = extractCompetitorResearchSources({
    output: [
      { type: "web_search_call", action: { sources: [
        { url: "https://example.com/services#scope", title: "Services" },
        { url: "data:text/plain,unsafe", title: "Unsafe" },
      ] } },
      { type: "message", content: [{
        type: "output_text",
        text: JSON.stringify(structuredModule()),
        annotations: [{ type: "url_citation", url: "https://example.com/services", title: "Alternative evidence" }],
      }] },
    ],
  });
  assert.deepEqual(sources, [{ url: "https://example.com/services", title: "Alternative evidence" }]);
});

test("Competitor orchestration requires approved Market and Avatar authority and preserves refresh history", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /APPROVED_MARKET_OS_REQUIRED/);
  assert.match(edge, /APPROVED_AVATAR_OS_REQUIRED/);
  assert.match(edge, /eq\("intelligence_domain", "market_os"\)/);
  assert.match(edge, /eq\("status", "approved"\)/);
  assert.match(edge, /market_os: \{/);
  assert.match(edge, /avatar_os: \{/);
  assert.match(edge, /previous_competitor_os:/);
  assert.match(edge, /ensureCompetitorFollowupSteps/);
  assert.match(edge, /COMPETITOR_CORE_MODULES\.slice\(0, 1\)/);
  assert.match(edge, /observation_identity/);
  assert.match(edge, /observation_fingerprint/);
  assert.match(edge, /change_status/);
  assert.match(edge, /refresh_interval_days: 30/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /review_intelligence_release/);
});

test("Competitor provider enforces lawful observation and prohibits copying or prescriptions", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /Use only public, lawfully accessible material/i);
  assert.match(provider, /Do not log in, bypass access controls, evade platform restrictions, impersonate anyone/i);
  assert.match(provider, /Do not reproduce protected creative work or substantial competitor copy/i);
  assert.match(provider, /reference brand is not a competitor unless evidence establishes commercial substitutability/i);
  assert.match(provider, /Do not score winners, recommend a response, prescribe positioning, copy competitors/i);
});

test("Competitor tab renders the real one-button workspace", async () => {
  const [page, panel] = await Promise.all([readFile(pagePath, "utf8"), readFile(panelPath, "utf8")]);
  assert.match(page, /<CompetitorOSPanel clientId=\{id\}/);
  assert.doesNotMatch(page, /Not started\. Competitor OS/);
  assert.match(panel, /Build Competitor OS/);
  assert.match(panel, /buyer-visible competitive system/i);
  assert.match(panel, /changed observations/i);
  assert.match(panel, /Approve &amp; activate/);
});
