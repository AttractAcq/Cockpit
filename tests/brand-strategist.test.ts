import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BRAND_STRATEGIST_MODULES } from "../supabase/functions/_shared/intelligence/brand-strategist-provider.ts";

const providerPath = new URL("../supabase/functions/_shared/intelligence/brand-strategist-provider.ts", import.meta.url);
const edgePath = new URL("../supabase/functions/run-brand-strategist/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/BrandStrategistPanel.tsx", import.meta.url);

test("Brand Strategist separates synthesis, recommendations, and portfolio assembly", () => {
  assert.deepEqual(
    BRAND_STRATEGIST_MODULES.map((module) => module.key),
    ["cross_os_synthesis", "strategic_recommendations", "recommendation_portfolio"],
  );
});

test("Brand Strategist provider is synthesis-only with no web_search — pure reasoning over approved authority", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /callAnthropicWithTools/);
  assert.match(provider, /submit_module/);
  assert.match(provider, /minItems: 1/);
  assert.doesNotMatch(provider, /web_search_20260209/);
  assert.doesNotMatch(provider, /tools: \[WEB_SEARCH_TOOL/);
  assert.match(provider, /Do not conduct new research or introduce outside facts/i);
  assert.match(provider, /Every recommendation must be supported by at least two distinct approved OS domains/i);
  assert.match(provider, /Prefer the bare record_key exactly as shown in brackets/i);
  assert.match(provider, /Do not invent results, impact metrics, buyer facts, proof, market conditions, or certainty/i);
  assert.match(provider, /Recommendations are proposals for human approval/i);
  assert.match(provider, /not approved experiments, completed work, instructions to mutate an upstream OS/i);
  assert.match(provider, /expected_impact must be qualitative unless an approved upstream record provides a defensible number/i);
});

test("Brand Strategist provider rejects placeholder and degenerate content with a structural check", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /function isPlaceholderText\(/);
  assert.match(provider, /if \(!\/\\s\/\.test\(trimmed\)\) return true;/);
  assert.match(provider, /if \(words\.length < 4\) return true;/);
  assert.match(provider, /submit_module returned a placeholder\/degenerate record/);
});

test("Brand Strategist write phase is capped to one Anthropic call per invocation with attempt-aware conciseness recovery", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /const MAX_TURNS = 1/);
  assert.match(provider, /attemptNumber\?: number/);
  assert.match(provider, /a previous attempt at this module was cut off/i);
  assert.match(provider, /cache_control: \{ type: "ephemeral" \}/);
});

test("Brand Strategist orchestration is an Anthropic tool-calling agent with memory and an audit trail", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /runBrandStrategistSynthesisAgent/);
  assert.doesNotMatch(edge, /runOpenAiBrandStrategistSynthesis/);
  assert.match(edge, /provider: "anthropic"/);
  assert.match(edge, /ANTHROPIC_BRAND_STRATEGIST_MODEL/);
  assert.match(edge, /client_agent_memory/);
  assert.match(edge, /client_agent_turns/);
  assert.match(edge, /renderMemoryNote/);
});

test("prepare() archives runs that can never resume instead of leaving them in limbo", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /async function archiveStaleRun\(/);
  assert.match(edge, /status: "cancelled", retryable: false/);
  assert.match(edge, /status: "archived"/);
  assert.match(edge, /brand_strategist\.stale_run_archived/);
  assert.match(edge, /"completed_partial"/);
  assert.match(edge, /exhaustedFailedStepIds/);
});

test("Brand Strategist requires complete, current authority from all four upstream domains and snapshots readiness", async () => {
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
  assert.match(edge, /association_os: \{/);
  assert.match(edge, /expectedAssociationAuthority\.release_id/);
  assert.match(edge, /previous_brand_strategist:/);
  assert.match(edge, /refresh_interval_days: 90/);
  assert.match(edge, /action === "retry_step"/);
  assert.match(edge, /failed_module_requeued/);
  assert.match(edge, /status: "queued",\s+attempt_count: 0/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /review_intelligence_release/);
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
