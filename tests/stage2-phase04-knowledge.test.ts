// Stage 2 Phase 04 — Knowledge (thin).
//
// Zero new schema, zero new capture mechanism: knowledge-search.ts is a
// pure function over content already fetched from the real
// client_context_files / client_execution_files tables via the existing
// fetchClientContextFiles / fetchClientExecutionFiles calls -- no new RPC,
// no new migration, no new table for this phase at all.
//
// The exit gate itself ("a real AA-specific question gets answered by
// querying this layer instead of asking a person") was verified against
// AA's real, approved 07_Brand_Voice_And_Style_Guide.md content pulled
// live from xivewedajschthjlblfb before this file was written -- see the
// Phase 04 PR description for the transcript. This file reproduces that
// same scenario with an embedded fixture excerpt so it stays enforced in
// CI without a live database dependency.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { splitIntoSections, buildKnowledgeIndex, searchKnowledge } from "../src/lib/knowledge-search.ts";

const panelPath = new URL("../src/components/client/KnowledgeSearchPanel.tsx", import.meta.url);
const detailPagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const businessDetailPath = new URL("../src/pages/BusinessDetailPage.tsx", import.meta.url);

test("splitIntoSections splits on headings and keeps content before the first heading under the file name", () => {
  const sections = splitIntoSections("00_Master.md", "intro line\n\n## First\nbody one\n\n### Second\nbody two\n");
  assert.deepEqual(sections.map((s) => s.heading), ["00_Master.md", "First", "Second"]);
  assert.equal(sections[0].body, "intro line");
  assert.equal(sections[1].body, "body one");
  assert.equal(sections[2].body, "body two");
});

test("splitIntoSections drops empty sections", () => {
  const sections = splitIntoSections("f.md", "## Empty\n\n## Has content\nreal text\n");
  assert.deepEqual(sections.map((s) => s.heading), ["Has content"]);
});

test("buildKnowledgeIndex tags context vs. execution sources and skips files with no content", () => {
  const index = buildKnowledgeIndex(
    [{ file_name: "ctx.md", file_number: 1, content_md: "## A\nfoo" }, { file_name: "empty.md", file_number: 2, content_md: null }],
    [{ file_name: "exec.md", file_number: 3, content_md: "## B\nbar" }],
  );
  assert.equal(index.length, 2);
  assert.equal(index[0].sourceKind, "context");
  assert.equal(index[1].sourceKind, "execution");
});

test("searchKnowledge ranks by term-occurrence count and returns nothing for a query with no real terms", () => {
  const index = buildKnowledgeIndex([
    { file_name: "a.md", file_number: 1, content_md: "## Weak\nproof appears once here." },
    { file_name: "b.md", file_number: 2, content_md: "## Strong\nproof, proof, proof -- proof is everywhere in this proof-led section." },
  ], []);
  const results = searchKnowledge(index, "proof");
  assert.equal(results.length, 2);
  assert.equal(results[0].heading, "Strong", "the section with more occurrences ranks first");
  assert.ok(results[0].score > results[1].score);
  assert.deepEqual(searchKnowledge(index, "a"), [], "single-character terms are not searchable");
});

test("exit gate: a real AA-specific question is answered by the layer, not a person", async () => {
  // Excerpted verbatim from the real, approved client_context_files row for
  // AA (file_number 7, 07_Brand_Voice_And_Style_Guide.md), pulled live
  // during Phase 04's own verification.
  const brandVoiceExcerpt = `# Brand Voice & Style Guide

## Core Tone Attributes
- Calm, Precise, Premium, Selective, Strategic, Proof-led, Confident, Diagnostic

## Words & Phrases to NEVER Use
| Banned Term | Reason |
|---|---|
| revolutionary | hype, unsubstantiated |
| cutting-edge | generic agency filler |
| 10x | unverifiable performance claim |
| guaranteed leads | false promise |
| trusted by | proof claim without verified clients |
`;
  const index = buildKnowledgeIndex([{ file_name: "07_Brand_Voice_And_Style_Guide.md", file_number: 7, content_md: brandVoiceExcerpt }], []);
  const results = searchKnowledge(index, "what words should we never use in our marketing?");
  assert.ok(results.length > 0, "the question must return at least one result");
  assert.equal(results[0].heading, "Words & Phrases to NEVER Use", "the correct section must rank first");
  assert.match(results[0].snippet, /revolutionary|cutting-edge|guaranteed leads/, "the snippet must actually contain the answer, not just the file");
});

test("the Search tab is wired into the Context nav group the same way Context Files is", async () => {
  const page = await readFile(detailPagePath, "utf8");
  assert.match(page, /\| "knowledge_search"/);
  assert.match(page, /\{ label: "Search", section: "knowledge_search" \}/);
  assert.match(page, /case "knowledge_search":\s*\n\s*return <KnowledgeSearchPanel clientId=\{id\} \/>/);
});

test("KnowledgeSearchPanel fetches the real tables directly -- no new backend surface", async () => {
  const panel = await readFile(panelPath, "utf8");
  assert.match(panel, /fetchClientContextFiles/);
  assert.match(panel, /fetchClientExecutionFiles/);
  assert.doesNotMatch(panel, /supabase\.rpc/, "Phase 04 introduces no new RPC -- pure client-side search over already-readable content");
});

test("BusinessDetailPage links a linked client straight into its knowledge search", async () => {
  const business = await readFile(businessDetailPath, "utf8");
  assert.match(business, /ROUTES\.clientSection\(linkedClient\.id, "knowledge_search"\)/);
});
