import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractMarketResearchSources,
  MARKET_RESEARCH_MODULES,
  parseMarketModuleOutput,
} from "../supabase/functions/_shared/intelligence/market-research-provider.ts";

const migrationPath = new URL("../supabase/migrations/20260812140000_phase_2a_a_intelligence_foundation.sql", import.meta.url);
const clientPagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const edgePath = new URL("../supabase/functions/run-market-os/index.ts", import.meta.url);

function structuredModule(moduleKey = "market_definition") {
  return {
    module_key: moduleKey,
    summary: "A bounded market summary.",
    records: [{
      record_key: "market_boundary",
      title: "Market boundary",
      summary: "The supported market boundary.",
      details: [{ label: "Geography", value: "Italy" }],
      findings: [{
        claim: "The client serves a defined regional market.",
        disposition: "asserted",
        confidence: "strongly_inferred",
        rationale: "Supported by approved Context and external evidence.",
        source_urls: ["https://example.com/research"],
        context_file_numbers: [1],
      }],
    }],
    unknowns: [],
    contradictions: [],
  };
}

test("Market OS module manifest covers the five bounded research modules", () => {
  assert.deepEqual(
    MARKET_RESEARCH_MODULES.map((module) => module.key),
    ["market_definition", "commercial_structure", "demand_and_buying", "regulation_and_constraints", "market_size_and_reach"],
  );
});

test("OpenAI provider parser accepts the expected structured module and rejects identity drift", () => {
  const payload = {
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(structuredModule()) }] }],
  };
  assert.equal(parseMarketModuleOutput(payload, "market_definition").records.length, 1);
  assert.throws(() => parseMarketModuleOutput(payload, "commercial_structure"), /invalid identity/i);
});

test("web source extraction returns inspectable, deduplicated HTTP sources", () => {
  const sources = extractMarketResearchSources({
    output: [
      {
        type: "web_search_call",
        action: { sources: [
          { url: "https://example.com/research#section", title: "Research" },
          { url: "javascript:alert(1)", title: "Unsafe" },
        ] },
      },
      {
        type: "message",
        content: [{
          type: "output_text",
          text: JSON.stringify(structuredModule()),
          annotations: [{ type: "url_citation", url: "https://example.com/research", title: "Research source" }],
        }],
      },
    ],
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "https://example.com/research");
  assert.equal(sources[0].title, "Research source");
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

test("Market OS orchestration is resumable, web-backed, and stops before approval", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /type Action = "prepare" \| "step" \| "finalize"/);
  assert.match(edge, /action === "prepare"/);
  assert.match(edge, /action === "step"/);
  assert.match(edge, /runOpenAiMarketResearch/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /review_intelligence_release/);
});
