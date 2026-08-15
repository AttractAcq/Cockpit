import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  AVATAR_CONDITIONAL_MODULES,
  AVATAR_CORE_MODULES,
} from "../supabase/functions/_shared/intelligence/avatar-research-provider.ts";

const providerPath = new URL("../supabase/functions/_shared/intelligence/avatar-research-provider.ts", import.meta.url);
const edgePath = new URL("../supabase/functions/run-avatar-os/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/AvatarOSPanel.tsx", import.meta.url);
const researchDomainMigrationPath = new URL(
  "../supabase/migrations/20260812160000_phase_2a_research_domain_compatibility.sql",
  import.meta.url,
);

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

test("Avatar provider is a bounded Anthropic web_search agent loop with a schema-enforced non-empty records array", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /callAnthropicWithTools/);
  assert.match(provider, /web_search_20260209/);
  assert.match(provider, /submit_module/);
  assert.match(provider, /minItems: 1/);
  assert.match(provider, /MAX_AGENT_TURNS/);
  assert.match(provider, /cache_control: \{ type: "ephemeral" \}/);
});

test("Avatar orchestration requires approved Market authority and selects conditional steps", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /type Action = "prepare" \| "step" \| "finalize" \| "retry_step"/);
  assert.match(edge, /APPROVED_MARKET_OS_REQUIRED/);
  assert.match(edge, /eq\("intelligence_domain", "market_os"\)/);
  assert.match(edge, /eq\("status", "approved"\)/);
  assert.match(edge, /market_os: \{/);
  assert.match(edge, /ensureAvatarFollowupSteps/);
  assert.match(edge, /AVATAR_CORE_MODULES\.slice\(0, 1\)/);
  assert.match(edge, /action === "retry_step"/);
  assert.match(edge, /failed_module_requeued/);
  assert.match(edge, /status: "queued",\s+attempt_count: 0/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /review_intelligence_release/);
});

test("prepare() archives runs that can never resume instead of leaving them in limbo", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /async function archiveStaleRun\(/);
  assert.match(edge, /status: "cancelled", retryable: false/);
  assert.match(edge, /status: "archived"/);
  assert.match(edge, /avatar_os\.stale_run_archived/);
});

test("Avatar orchestration is an Anthropic tool-calling agent with memory and an audit trail", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /runAvatarResearchAgent/);
  assert.doesNotMatch(edge, /runOpenAiAvatarResearch/);
  assert.match(edge, /provider: "anthropic"/);
  assert.match(edge, /ANTHROPIC_AVATAR_RESEARCH_MODEL/);
  assert.match(edge, /client_agent_memory/);
  assert.match(edge, /client_agent_turns/);
  assert.match(edge, /renderMemoryNote/);
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
