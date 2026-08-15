import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { COMPETITOR_CORE_MODULES } from "../supabase/functions/_shared/intelligence/competitor-research-provider.ts";

const providerPath = new URL("../supabase/functions/_shared/intelligence/competitor-research-provider.ts", import.meta.url);
const edgePath = new URL("../supabase/functions/run-competitor-os/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/CompetitorOSPanel.tsx", import.meta.url);

test("Competitor OS covers registry, maps, observation libraries, and system patterns", () => {
  assert.deepEqual(
    COMPETITOR_CORE_MODULES.map((module) => module.key),
    ["alternative_registry", "positioning_category_map", "offer_commercial_observations", "messaging_claims", "proof_trust", "distribution_attention", "landscape_patterns"],
  );
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
  assert.match(edge, /ensureNextResearchStep/);
  assert.match(edge, /observation_identity/);
  assert.match(edge, /observation_fingerprint/);
  assert.match(edge, /change_status/);
  assert.match(edge, /refresh_interval_days: 30/);
  assert.match(edge, /"completed_partial"/);
  assert.match(edge, /exhaustedFailedStepIds/);
  assert.match(edge, /retry_step/);
  assert.match(edge, /failed_module_requeued/);
  assert.match(edge, /status: "queued",\s+attempt_count: 0/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /review_intelligence_release/);
});

test("Competitor orchestration is an Anthropic tool-calling agent with memory and an audit trail", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /runCompetitorResearchAgent/);
  assert.doesNotMatch(edge, /runOpenAiCompetitorResearch/);
  assert.match(edge, /provider: "anthropic"/);
  assert.match(edge, /ANTHROPIC_COMPETITOR_RESEARCH_MODEL/);
  assert.match(edge, /client_agent_memory/);
  assert.match(edge, /client_agent_turns/);
  assert.match(edge, /renderMemoryNote/);
});

test("prepare() archives runs that can never resume instead of leaving them in limbo", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /async function archiveStaleRun\(/);
  assert.match(edge, /status: "cancelled", retryable: false/);
  assert.match(edge, /status: "archived"/);
  assert.match(edge, /competitor_os\.stale_run_archived/);
  assert.match(edge, /if \(!release\) \{[\s\S]*?await archiveStaleRun\(sb, clientId, run\.id, null\);/);
  assert.match(edge, /if \(!canResume\) \{[\s\S]*?await archiveStaleRun\(sb, clientId, run\.id, release\.id\);/);
});

test("every module runs as a two-phase search step then write step, each a separate invocation", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /function researchStepKey\(moduleKey: string\)/);
  assert.match(edge, /runCompetitorSearchPhase/);
  assert.match(edge, /ensureWriteStep/);
  assert.match(edge, /ensureNextResearchStep/);
  assert.match(edge, /priorResearchNotes/);
  assert.match(edge, /priorSources/);
  assert.match(edge, /realModuleKeys\.has\(step\.step_key\)/);
});

test("Competitor provider is a bounded Anthropic web_search agent loop with a schema-enforced non-empty records array", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /callAnthropicWithTools/);
  assert.match(provider, /web_search_20260209/);
  assert.match(provider, /submit_module/);
  assert.match(provider, /minItems: 1/);
  assert.match(provider, /MAX_AGENT_TURNS/);
  assert.match(provider, /export async function runCompetitorSearchPhase/);
});

test("search phase runs targeted gap searches against the existing corpus instead of re-discovering it every module", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /const hasExistingCorpus = Boolean\(input\.existingCompetitorModel\) && input\.module\.key !== "alternative_registry"/);
  assert.match(provider, /Do NOT re-run broad discovery searches for new alternatives/);
  assert.match(provider, /targeted, subject-specific queries/);
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
  assert.match(panel, /Retry all failed/);
  assert.match(panel, /Retry module/);
  assert.match(panel, /New version required/);
});
