import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AVATAR_CONDITIONAL_MODULES,
  AVATAR_CORE_MODULES,
  extractAvatarResearchSources,
  parseAvatarModuleOutput,
} from "../supabase/functions/_shared/intelligence/avatar-research-provider.ts";

const providerPath = new URL("../supabase/functions/_shared/intelligence/avatar-research-provider.ts", import.meta.url);
const edgePath = new URL("../supabase/functions/run-avatar-os/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/AvatarOSPanel.tsx", import.meta.url);
const researchDomainMigrationPath = new URL(
  "../supabase/migrations/20260812160000_phase_2a_research_domain_compatibility.sql",
  import.meta.url,
);

function structuredModule(moduleKey = "buyer_role_system") {
  return {
    module_key: moduleKey,
    summary: "A supported buying-role system.",
    records: [{
      record_key: "economic_buyer",
      title: "Economic buyer",
      summary: "Owns the commercial decision.",
      details: [{ label: "Decision authority", value: "Final commercial approval" }],
      findings: [{
        claim: "The economic buyer owns final approval.",
        disposition: "asserted",
        confidence: "strongly_inferred",
        rationale: "Supported by approved market and context authority.",
        source_urls: ["https://example.com/buyer-research"],
        context_file_numbers: [1],
        market_record_keys: ["buying_mechanism"],
      }],
    }],
    unknowns: [],
    contradictions: [],
    conditional_module_keys: ["multi_role_governance"],
  };
}

test("Avatar OS uses a focused core plus bounded conditional research modules", () => {
  assert.deepEqual(
    AVATAR_CORE_MODULES.map((module) => module.key),
    ["buyer_role_system", "outcomes_triggers_timing", "decision_tradeoffs_risk", "trust_proof_credibility", "information_language_attention"],
  );
  assert.deepEqual(
    AVATAR_CONDITIONAL_MODULES.map((module) => module.key),
    ["multi_role_governance", "procurement_and_compliance", "referral_and_gatekeeper", "high_consideration_risk"],
  );
});

test("Avatar provider preserves Context, Market OS, and web evidence identities", () => {
  const payload = {
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(structuredModule()) }] }],
  };
  const output = parseAvatarModuleOutput(payload, "buyer_role_system");
  assert.deepEqual(output.records[0].findings[0].market_record_keys, ["buying_mechanism"]);
  assert.throws(() => parseAvatarModuleOutput(payload, "trust_proof_credibility"), /invalid identity/i);
});

test("Avatar source extraction keeps only inspectable, deduplicated HTTP sources", () => {
  const sources = extractAvatarResearchSources({
    output: [
      { type: "web_search_call", action: { sources: [
        { url: "https://example.com/buyer-research#roles", title: "Buyer research" },
        { url: "data:text/plain,unsafe", title: "Unsafe" },
      ] } },
      { type: "message", content: [{
        type: "output_text",
        text: JSON.stringify(structuredModule()),
        annotations: [{ type: "url_citation", url: "https://example.com/buyer-research", title: "Role evidence" }],
      }] },
    ],
  });
  assert.deepEqual(sources, [{ url: "https://example.com/buyer-research", title: "Role evidence" }]);
});

test("Avatar orchestration requires approved Market authority and selects conditional steps", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /APPROVED_MARKET_OS_REQUIRED/);
  assert.match(edge, /eq\("intelligence_domain", "market_os"\)/);
  assert.match(edge, /eq\("status", "approved"\)/);
  assert.match(edge, /market_os: \{/);
  assert.match(edge, /ensureAvatarFollowupSteps/);
  assert.match(edge, /AVATAR_CORE_MODULES\.slice\(0, 1\)/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /review_intelligence_release/);
});

test("the preserved research-run table accepts every Phase 2A execution domain", async () => {
  const migration = await readFile(researchDomainMigrationPath, "utf8");
  for (const domain of ["market", "avatar", "competitor", "association", "brand_strategist"]) {
    assert.match(migration, new RegExp(`'${domain}'`));
  }
  assert.match(migration, /drop constraint if exists client_research_runs_domain_check/);
});

test("Avatar provider prohibits fictional detail, sensitive inference, and strategy", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /Never invent.*personal biographies.*demographic precision.*sensitive traits/i);
  assert.match(provider, /Do not infer race, ethnicity, religion, health, disability, sexuality, political beliefs/i);
  assert.match(provider, /Model buying roles.*not decorative personas/i);
  assert.match(provider, /Do not recommend positioning, brand, messaging, content, offers, campaigns, or channels/i);
});

test("Avatar tab renders the real one-button workspace", async () => {
  const [page, panel] = await Promise.all([readFile(pagePath, "utf8"), readFile(panelPath, "utf8")]);
  assert.match(page, /<AvatarOSPanel clientId=\{id\}/);
  assert.doesNotMatch(page, /Not started\. Avatar OS/);
  assert.match(panel, /Build Avatar OS/);
  assert.match(panel, /Buyer-role registry and decision models/);
  assert.match(panel, /Approve &amp; activate/);
});
