import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BRAND_STRATEGIST_MODULES,
  parseBrandStrategistModuleOutput,
} from "../supabase/functions/_shared/intelligence/brand-strategist-provider.ts";

const providerPath = new URL("../supabase/functions/_shared/intelligence/brand-strategist-provider.ts", import.meta.url);
const edgePath = new URL("../supabase/functions/run-brand-strategist/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/BrandStrategistPanel.tsx", import.meta.url);

function structuredModule(moduleKey = "strategic_recommendations") {
  return {
    module_key: moduleKey,
    summary: "Approved intelligence supports a proof-led recommendation.",
    records: [{
      record_key: "lead_with_inspectable_proof",
      record_kind: "recommendation",
      recommendation_type: "proof",
      priority: "now",
      title: "Lead with inspectable proof",
      statement: "Make specific proof the primary trust mechanism.",
      rationale: "The buyer role requires proof and the market buying mechanism rewards inspectability.",
      expected_impact: "Reduce perceived claim risk during evaluation.",
      dependencies: ["Approved proof inventory"],
      risks: ["Weak proof could undermine trust"],
      trade_offs: ["Claims must remain narrower and defensible"],
      contradictions: [],
      buyer_role_keys: ["economic_buyer"],
      market_condition_keys: ["buying_mechanism"],
      downstream_owner: "brand_system",
      proposed_next_action: "A human owner reviews the available proof before accepting this recommendation.",
      validation_needed: "Confirm that inspectable proof is available before execution.",
      findings: [{
        claim: "Specific proof addresses the supported buyer's evaluation risk.",
        disposition: "asserted",
        confidence: "strongly_inferred",
        rationale: "Supported by approved upstream authority.",
        context_file_numbers: [1],
        market_record_keys: ["buying_mechanism"],
        avatar_record_keys: ["economic_buyer"],
        competitor_record_keys: ["example_agency__proof_pattern"],
        association_record_keys: ["specific_proof__specific_proof"],
      }],
    }],
    unknowns: [],
    contradictions: [],
  };
}

test("Brand Strategist separates synthesis, recommendations, and portfolio assembly", () => {
  assert.deepEqual(
    BRAND_STRATEGIST_MODULES.map((module) => module.key),
    ["cross_os_synthesis", "strategic_recommendations", "recommendation_portfolio"],
  );
});

test("Brand Strategist output preserves exact Context and all four OS trace keys", () => {
  const payload = {
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(structuredModule()) }] }],
  };
  const output = parseBrandStrategistModuleOutput(payload, "strategic_recommendations");
  const finding = output.records[0].findings[0];
  assert.deepEqual(finding.context_file_numbers, [1]);
  assert.deepEqual(finding.market_record_keys, ["buying_mechanism"]);
  assert.deepEqual(finding.avatar_record_keys, ["economic_buyer"]);
  assert.deepEqual(finding.competitor_record_keys, ["example_agency__proof_pattern"]);
  assert.deepEqual(finding.association_record_keys, ["specific_proof__specific_proof"]);
  assert.equal(output.records[0].downstream_owner, "brand_system");
  assert.throws(() => parseBrandStrategistModuleOutput(payload, "recommendation_portfolio"), /invalid identity/i);
});

test("Brand Strategist provider is synthesis-only and treats recommendations as proposals", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /Do not conduct new research or introduce outside facts/i);
  assert.match(provider, /Every recommendation must be supported by at least two distinct approved OS domains/i);
  assert.match(provider, /Prefer the bare record_key exactly as shown in brackets/i);
  assert.match(provider, /Do not invent results, impact metrics, buyer facts, proof, market conditions, or certainty/i);
  assert.match(provider, /Recommendations are proposals for human approval/i);
  assert.match(provider, /not approved experiments, completed work, instructions to mutate an upstream OS/i);
  assert.match(provider, /expected_impact must be qualitative unless an approved upstream record provides a defensible number/i);
  assert.match(provider, /AbortSignal\.timeout\(105_000\)/);
  assert.doesNotMatch(provider, /tools:\s*\[/);
  assert.doesNotMatch(provider, /web_search_preview/);
});

test("Brand Strategist requires complete, current authority and snapshots readiness", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /type Action = "prepare" \| "step" \| "finalize" \| "retry_step"/);
  for (const code of [
    "APPROVED_MARKET_OS_REQUIRED",
    "APPROVED_AVATAR_OS_REQUIRED",
    "APPROVED_COMPETITOR_OS_REQUIRED",
    "APPROVED_ASSOCIATION_OS_REQUIRED",
    "UPSTREAM_REFRESH_POLICY_REQUIRED",
    "STALE_UPSTREAM_AUTHORITY",
  ]) assert.match(edge, new RegExp(code));
  assert.match(edge, /\.in\("intelligence_domain", \["market_os", "avatar_os", "competitor_os", "association_os"\]\)/);
  assert.match(edge, /readinessWarnings/);
  assert.match(edge, /status: readinessWarnings\.length > 0 \? "degraded" : "ready"/);
  assert.match(edge, /hasExhaustedFailure/);
  assert.match(edge, /association_os: \{/);
  assert.match(edge, /expectedAssociationAuthority\.release_id/);
  assert.match(edge, /previous_brand_strategist:/);
  assert.match(edge, /refresh_interval_days: 90/);
  assert.match(edge, /action === "retry_step"/);
  assert.match(edge, /failed_module_requeued/);
  assert.match(edge, /status: "queued",\s+attempt_count: 0/);
});

test("Brand Strategist enforces evidence-bound recommendations and human review", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /supportedOsDomains\.size < 2/);
  assert.match(edge, /every recommendation requires support from at least two approved OS domains/i);
  assert.match(edge, /finding_ids: Array\.isArray\(record\.payload\?\.finding_ids\)/);
  assert.match(edge, /lookup\.set\(`\$\{record\.record_type\}\/\$\{record\.record_key\}`/);
  assert.match(edge, /resolveRecordKeys\(providerFinding\.market_record_keys, marketByKey\)/);
  assert.match(edge, /upstream_domain: "market_os"/);
  assert.match(edge, /upstream_domain: "avatar_os"/);
  assert.match(edge, /upstream_domain: "competitor_os"/);
  assert.match(edge, /upstream_domain: "association_os"/);
  assert.match(edge, /cross_os_synthesis.*cannot emit recommendation records/s);
  assert.match(edge, /recommendationCount === 0/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /review_intelligence_release/);
});

test("Brand Strategist tab renders the real recommendation workspace", async () => {
  const [page, panel] = await Promise.all([readFile(pagePath, "utf8"), readFile(panelPath, "utf8")]);
  assert.match(page, /<BrandStrategistPanel clientId=\{id\}/);
  assert.doesNotMatch(page, /Not started\. Brand Strategist/);
  assert.match(panel, /Generate strategic recommendations/);
  assert.match(panel, /Every card exposes its reasoning, trade-offs, dependencies, risks, evidence chain, and proposed owner/i);
  assert.match(panel, /Degraded authority readiness/);
  assert.match(panel, /Proposed next action/);
  assert.match(panel, /Validation needed/);
  assert.match(panel, /Approve &amp; activate/);
});
