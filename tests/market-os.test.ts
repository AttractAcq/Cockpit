import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MARKET_RESEARCH_MODULES } from "../supabase/functions/_shared/intelligence/market-research-provider.ts";

const migrationPath = new URL("../supabase/migrations/20260812140000_phase_2a_a_intelligence_foundation.sql", import.meta.url);
const clientPagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const edgePath = new URL("../supabase/functions/run-market-os/index.ts", import.meta.url);
const providerPath = new URL("../supabase/functions/_shared/intelligence/market-research-provider.ts", import.meta.url);

test("Market OS module manifest covers the five bounded research modules", () => {
  assert.deepEqual(
    MARKET_RESEARCH_MODULES.map((module) => module.key),
    ["market_definition", "commercial_structure", "demand_and_buying", "regulation_and_constraints", "market_size_and_reach"],
  );
});

test("Market provider is a bounded Anthropic web_search agent loop with a schema-enforced non-empty records array", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /callAnthropicWithTools/);
  assert.match(provider, /web_search_20260209/);
  assert.match(provider, /submit_module/);
  assert.match(provider, /minItems: 1/);
  assert.match(provider, /MAX_AGENT_TURNS/);
  assert.match(provider, /cache_control: \{ type: "ephemeral" \}/);
});

test("Phase 2A-A migration extends the canonical research tables and separates authority layers", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /alter table public\.client_research_runs/);
  assert.match(sql, /alter table public\.client_research_sources/);
  assert.doesNotMatch(sql, /create table public\.client_research_runs/);
  assert.doesNotMatch(sql, /create table public\.client_research_sources/);
  for (const table of [
    "client_research_steps",
    "client_provider_operation_receipts",
    "client_research_cost_events",
    "client_evidence_records",
    "client_intelligence_findings",
    "client_intelligence_releases",
    "client_intelligence_approval_decisions",
    "client_intelligence_active_releases",
    "client_intelligence_refresh_policies",
  ]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
  }
  assert.match(sql, /enforce_verified_intelligence_finding/);
  assert.match(sql, /approved intelligence releases are immutable/);
  assert.match(sql, /review_intelligence_release/);
  assert.match(sql, /foreign key \(release_id, client_id, intelligence_domain\)/);
});

test("client UX exposes Context and the five-tab Intelligence page", async () => {
  const page = await readFile(clientPagePath, "utf8");
  assert.match(page, /label: "Context"/);
  assert.match(page, /label: "Intelligence"/);
  for (const label of ["Market OS", "Avatar OS", "Competitor OS", "Association OS", "Brand Strategist"]) {
    assert.match(page, new RegExp(`label: "${label}"`));
  }
  assert.doesNotMatch(page, /label: "Data"/);
});

test("Market OS orchestration is an Anthropic tool-calling agent, resumable, and stops before approval", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /type Action = "prepare" \| "step" \| "finalize" \| "retry_step"/);
  assert.match(edge, /action === "prepare"/);
  assert.match(edge, /action === "step"/);
  assert.match(edge, /action === "retry_step"/);
  assert.match(edge, /runMarketResearchAgent/);
  assert.doesNotMatch(edge, /runOpenAiMarketResearch/);
  assert.match(edge, /provider: "anthropic"/);
  assert.match(edge, /ANTHROPIC_MARKET_RESEARCH_MODEL/);
  assert.match(edge, /client_agent_memory/);
  assert.match(edge, /client_agent_turns/);
  assert.match(edge, /renderMemoryNote/);
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
  assert.match(edge, /market_os\.stale_run_archived/);
});
