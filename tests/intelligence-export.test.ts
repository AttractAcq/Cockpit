import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildIntelligenceMarkdown,
  buildIntelligencePdf,
  intelligenceExportFilename,
} from "../src/lib/intelligence-export.ts";

const panelPaths = [
  "MarketOSPanel.tsx",
  "AvatarOSPanel.tsx",
  "CompetitorOSPanel.tsx",
  "AssociationOSPanel.tsx",
  "BrandStrategistPanel.tsx",
].map((file) => new URL(`../src/components/client/${file}`, import.meta.url));

function fixtureWorkspace() {
  const release = {
    id: "release-1",
    client_id: "client-1",
    intelligence_domain: "market_os" as const,
    version: 3,
    status: "approved" as const,
    research_run_id: "run-1",
    title: "Market OS v3",
    summary: "A concise evidence-backed view of the commercial environment.",
    content: { module_count: 1 },
    authority_snapshot: { context_file_ids: ["context-1"] },
    generated_at: "2026-08-10T12:00:00.000Z",
    submitted_at: "2026-08-10T12:05:00.000Z",
    approved_at: "2026-08-10T13:00:00.000Z",
    superseded_at: null,
    archived_at: null,
    created_at: "2026-08-10T12:00:00.000Z",
    updated_at: "2026-08-10T13:00:00.000Z",
  };
  return {
    domain: "market_os" as const,
    latestRelease: release,
    activeRelease: release,
    latestRun: null,
    steps: [],
    records: [{
      id: "record-1",
      client_id: "client-1",
      release_id: "release-1",
      record_type: "market_boundary",
      record_key: "served_market",
      title: "Served market",
      summary: "The business serves evidence-conscious local operators.",
      payload: { details: [{ label: "Boundary", value: "Independent operators in the UK" }] },
      display_order: 1,
      created_at: "2026-08-10T12:00:00.000Z",
    }],
    findings: [{
      id: "finding-1",
      client_id: "client-1",
      intelligence_domain: "market_os" as const,
      subject_key: "served_market",
      claim: "Buyers prefer inspectable commercial proof.",
      disposition: "asserted" as const,
      confidence_level: "verified" as const,
      rationale: "Supported by primary research.",
      contradiction_status: "none" as const,
      metadata: { source_count: 1 },
      created_by: "research_orchestrator",
      created_at: "2026-08-10T12:00:00.000Z",
      updated_at: "2026-08-10T12:00:00.000Z",
    }],
    evidence: [{
      id: "evidence-1",
      client_id: "client-1",
      research_run_id: "run-1",
      source_type: "research_source" as const,
      research_source_id: "source-1",
      context_file_id: null,
      client_input_field: null,
      evidence_kind: "excerpt" as const,
      evidence_text: "Operators compare providers through demonstrated outcomes.",
      locator: { section: "Buying criteria" },
      observed_at: "2026-08-10T11:00:00.000Z",
      source_quality: "primary" as const,
      inspectable: true,
      metadata: {},
      created_at: "2026-08-10T12:00:00.000Z",
    }],
    sources: [{
      id: "source-1",
      client_id: "client-1",
      research_run_id: "run-1",
      url: "https://example.com/research",
      canonical_url: "https://example.com/research",
      title: "Primary market research",
      publisher: "Example Research",
      retrieved_at: "2026-08-10T11:00:00.000Z",
      source_type: "web",
      source_quality: "primary" as const,
      inspectable: true,
      use_restriction: "citation_only",
    }],
    policy: null,
    usage: { inputUnits: 100, outputUnits: 50, toolCalls: 1, amountMicrounits: null, currency: null },
    freshness: "fresh" as const,
    nextRefreshAt: "2026-11-08T13:00:00.000Z",
  };
}

test("Markdown export preserves authority, structured context, findings, evidence and sources", () => {
  const workspace = fixtureWorkspace();
  const markdown = buildIntelligenceMarkdown({ clientName: "Proof & Brand", workspace });
  assert.match(markdown, /document_type: "intelligence_context_export"/);
  assert.match(markdown, /is_active_authority: true/);
  assert.match(markdown, /## Structured intelligence/);
  assert.match(markdown, /Independent operators in the UK/);
  assert.match(markdown, /## Findings/);
  assert.match(markdown, /Buyers prefer inspectable commercial proof/);
  assert.match(markdown, /## Evidence/);
  assert.match(markdown, /## Sources/);
  assert.match(markdown, /https:\/\/example\.com\/research/);
  assert.match(markdown, /## Authority snapshot/);
  assert.equal(
    intelligenceExportFilename({ clientName: "Proof & Brand", workspace }, "md"),
    "proof-brand-market-os-v3.md",
  );
});

test("PDF export creates a real client document", async () => {
  const pdf = await buildIntelligencePdf({ clientName: "Proof & Brand", workspace: fixtureWorkspace() });
  assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");
  assert.ok(pdf.byteLength > 3_000);
});

test("every Intelligence OS panel exposes the shared export actions", async () => {
  const panels = await Promise.all(panelPaths.map((path) => readFile(path, "utf8")));
  for (const panel of panels) {
    assert.match(panel, /<IntelligenceExportActions clientName=\{clientName\} workspace=\{workspace\} \/>/);
  }
});
