import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ASSOCIATION_CORE_MODULES,
  extractAssociationResearchSources,
  parseAssociationModuleOutput,
} from "../supabase/functions/_shared/intelligence/association-research-provider.ts";

const providerPath = new URL("../supabase/functions/_shared/intelligence/association-research-provider.ts", import.meta.url);
const edgePath = new URL("../supabase/functions/run-association-os/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/AssociationOSPanel.tsx", import.meta.url);

function structuredModule(moduleKey = "association_map") {
  return {
    module_key: moduleKey,
    summary: "A supported buyer-association map.",
    records: [{
      record_key: "specific_proof",
      association_key: "specific_proof",
      polarity: "positive",
      association_kind: "proof_form",
      scope: "economic buyer",
      applies_to_avatar_record_keys: ["economic_buyer"],
      observed_at: "2026-08-10T00:00:00.000Z",
      title: "Specific, inspectable proof",
      summary: "Specific proof strengthens confidence for the supported buyer role.",
      details: [{ label: "Trust effect", value: "Reduces perceived claim risk" }],
      findings: [{
        claim: "The economic buyer values specific, inspectable evidence.",
        disposition: "asserted",
        confidence: "strongly_inferred",
        rationale: "Supported by public and approved upstream authority.",
        source_urls: ["https://example.com/trust-research"],
        context_file_numbers: [1],
        market_record_keys: ["buying_mechanism"],
        avatar_record_keys: ["economic_buyer"],
        competitor_record_keys: ["example_agency__proof_pattern"],
      }],
    }],
    unknowns: [],
    contradictions: [],
  };
}

test("Association OS covers polarity, trust, proof, cues, variation, and cautions", () => {
  assert.deepEqual(
    ASSOCIATION_CORE_MODULES.map((module) => module.key),
    ["association_map", "trust_credibility_signals", "proof_authority_ecosystem", "emotional_symbolic_language_cues", "role_segment_variation", "tensions_cautions_unknowns"],
  );
});

test("Association provider preserves Context, Market, Avatar, Competitor, and web evidence identities", () => {
  const payload = {
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(structuredModule()) }] }],
  };
  const output = parseAssociationModuleOutput(payload, "association_map");
  assert.deepEqual(output.records[0].findings[0].market_record_keys, ["buying_mechanism"]);
  assert.deepEqual(output.records[0].findings[0].avatar_record_keys, ["economic_buyer"]);
  assert.deepEqual(output.records[0].findings[0].competitor_record_keys, ["example_agency__proof_pattern"]);
  assert.equal(output.records[0].polarity, "positive");
  assert.throws(() => parseAssociationModuleOutput(payload, "trust_credibility_signals"), /invalid identity/i);
});

test("Association source extraction keeps only inspectable, deduplicated HTTP sources", () => {
  const sources = extractAssociationResearchSources({
    output: [
      { type: "web_search_call", action: { sources: [
        { url: "https://example.com/trust-research#proof", title: "Trust research" },
        { url: "data:text/plain,unsafe", title: "Unsafe" },
      ] } },
      { type: "message", content: [{
        type: "output_text",
        text: JSON.stringify(structuredModule()),
        annotations: [{ type: "url_citation", url: "https://example.com/trust-research", title: "Trust evidence" }],
      }] },
    ],
  });
  assert.deepEqual(sources, [{ url: "https://example.com/trust-research", title: "Trust evidence" }]);
});

test("Association orchestration requires every upstream OS and preserves refresh history", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /APPROVED_MARKET_OS_REQUIRED/);
  assert.match(edge, /APPROVED_AVATAR_OS_REQUIRED/);
  assert.match(edge, /APPROVED_COMPETITOR_OS_REQUIRED/);
  assert.match(edge, /eq\("intelligence_domain", "market_os"\)/);
  assert.match(edge, /eq\("status", "approved"\)/);
  assert.match(edge, /market_os: \{/);
  assert.match(edge, /avatar_os: \{/);
  assert.match(edge, /competitor_os: \{/);
  assert.match(edge, /previous_association_os:/);
  assert.match(edge, /ensureAssociationFollowupSteps/);
  assert.match(edge, /ASSOCIATION_CORE_MODULES\.slice\(0, 1\)/);
  assert.match(edge, /association_identity/);
  assert.match(edge, /association_fingerprint/);
  assert.match(edge, /change_status/);
  assert.match(edge, /unsupportedAvatarKeys/);
  assert.match(edge, /refresh_interval_days: 180/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /review_intelligence_release/);
});

test("Association provider blocks unsafe profiling, stereotypes, and strategy", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /Never infer or target race, ethnicity, nationality, religion, health, disability, sexuality, gender identity, political beliefs/i);
  assert.match(provider, /Do not use proxies for these traits/i);
  assert.match(provider, /Do not turn cultural, geographic, demographic, or identity stereotypes into buyer truths/i);
  assert.match(provider, /Weak symbolic or cultural hypotheses must be unknown, never asserted/i);
  assert.match(provider, /Do not recommend a brand position, message, visual identity, offer, content, campaign, channel, or targeting action/i);
});

test("Association tab renders the real one-button workspace", async () => {
  const [page, panel] = await Promise.all([readFile(pagePath, "utf8"), readFile(panelPath, "utf8")]);
  assert.match(page, /<AssociationOSPanel clientId=\{id\}/);
  assert.doesNotMatch(page, /Not started\. Association OS/);
  assert.match(panel, /Build Association OS/);
  assert.match(panel, /meanings and signals that make approved buyer roles trust, value, doubt, avoid, or reject/i);
  assert.match(panel, /positive.*negative.*changed/i);
  assert.match(panel, /Approve &amp; activate/);
});
