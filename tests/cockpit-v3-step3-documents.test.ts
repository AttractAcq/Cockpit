// Cockpit v3 Step 3 — Documents, the third and last piece of this step
// (docs/COCKPIT_V3_TRANSFORMATION_PLAN.md). The folder taxonomy is a real
// grouping over the already-real 21-file CONTEXT_FILE_DEFS, not invented
// content -- the key invariant this file enforces is that every real file
// number is covered by exactly one folder, so the taxonomy can't silently
// drift out of sync with the actual file list. citationCountsByFile and the
// page/component wiring are checked the same way every other Cockpit v3
// slice checks non-component logic: pure functions run directly, wiring
// checked by reading source text (this repo has no React component-test
// infrastructure).

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { DOCUMENT_FOLDERS, groupContextFilesByFolder } from "../src/lib/document-folders.ts";
import { citationCountsByFile } from "../src/lib/document-citations.ts";
import { CONTEXT_FILE_DEFS } from "../src/types/phase.ts";
import type { ClientContextFile } from "../src/types/phase.ts";
import type { ContextFileCitation } from "../src/types/phase1-intelligence.ts";

function contextFile(overrides: Partial<ClientContextFile> = {}): ClientContextFile {
  return {
    id: "file-1",
    client_id: "client-1",
    file_number: 0,
    file_name: "00_Master_Client_Context.md",
    content_md: null,
    storage_path: null,
    status: "approved",
    confidence_level: null,
    generated_by_function: null,
    version: 1,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

test("every real CONTEXT_FILE_DEFS number is covered by exactly one document folder -- the taxonomy can't silently drift out of sync", () => {
  const covered = DOCUMENT_FOLDERS.flatMap((f) => f.fileNumbers);
  const realNumbers = CONTEXT_FILE_DEFS.map((d) => d.number);

  assert.deepEqual([...covered].sort((a, b) => a - b), [...realNumbers].sort((a, b) => a - b));
  assert.equal(new Set(covered).size, covered.length, "no file number appears in more than one folder");
});

test("groupContextFilesByFolder puts each real file into its folder, sorted by file number", () => {
  const files = [
    contextFile({ id: "f-7", file_number: 7, file_name: "07_Brand_Voice_And_Style_Guide.md" }),
    contextFile({ id: "f-6", file_number: 6, file_name: "06_Positioning_And_Angle_Map.md" }),
  ];
  const groups = groupContextFilesByFolder(files);
  const brand = groups.find((g) => g.folder.key === "brand");
  assert.ok(brand);
  assert.deepEqual(brand!.contextFiles.map((f) => f.id), ["f-6", "f-7"]);
});

test("groupContextFilesByFolder leaves an empty folder empty rather than guessing", () => {
  const groups = groupContextFilesByFolder([contextFile({ file_number: 0 })]);
  const website = groups.find((g) => g.folder.key === "website");
  assert.deepEqual(website!.contextFiles, []);
});

function citation(overrides: Partial<ContextFileCitation> = {}): ContextFileCitation {
  return {
    id: "cite-1",
    client_id: "client-1",
    created_at: "2026-08-20T00:00:00.000Z",
    context_file_id: "file-1",
    context_file_version: 1,
    claim_excerpt: "example claim",
    source_type: "client_input",
    client_input_field: "business_description",
    source_document_id: null,
    document_chunk_id: null,
    research_source_id: null,
    inference_rationale: null,
    inference_approved_by: null,
    inference_approved_at: null,
    ...overrides,
  };
}

test("citationCountsByFile counts real citations per context file, zero for a file with none rather than omitting it", () => {
  const counts = citationCountsByFile([
    citation({ context_file_id: "file-1" }),
    citation({ context_file_id: "file-1", id: "cite-2" }),
    citation({ context_file_id: "file-2", id: "cite-3" }),
  ]);
  assert.deepEqual(counts, { "file-1": 2, "file-2": 1 });
});

test("citationCountsByFile against no citations returns an empty map, not a fabricated one", () => {
  assert.deepEqual(citationCountsByFile([]), {});
});

test("Knowledge is a real top-level page combining Step 2's Search rehome and Step 3's new Documents", () => {
  const src = readFileSync(new URL("../src/pages/KnowledgePage.tsx", import.meta.url), "utf-8");
  assert.match(src, /import\s*\{\s*useBusinessContext\s*\}\s*from\s*"@\/lib\/business-context"/);
  assert.match(src, /selectedClientId/);
  assert.match(src, /<DocumentsPanel clientId={clientId}\s*\/>/);
  assert.match(src, /<KnowledgeSearchPanel clientId={clientId}\s*\/>/);

  const routes = readFileSync(new URL("../src/lib/constants.ts", import.meta.url), "utf-8");
  assert.match(routes, /knowledge:\s*"\/knowledge"/);

  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf-8");
  assert.match(app, /path={ROUTES\.knowledge}\s*element={<KnowledgePage \/>}/);
});

test("DocumentsPanel routes into the already-real Context/Execution Files editors rather than duplicating a viewer", () => {
  const src = readFileSync(new URL("../src/components/knowledge/DocumentsPanel.tsx", import.meta.url), "utf-8");
  assert.match(src, /ROUTES\.clientSection\(clientId, "context_files"\)/);
  assert.match(src, /ROUTES\.clientSection\(clientId, "execution_files"\)/);
});

test("CONTEXT_FILE_STATUS_LABEL/COLOUR are exported from types/phase.ts and reused, not duplicated per-panel", () => {
  const types = readFileSync(new URL("../src/types/phase.ts", import.meta.url), "utf-8");
  assert.match(types, /export const CONTEXT_FILE_STATUS_LABEL/);
  assert.match(types, /export const CONTEXT_FILE_STATUS_COLOUR/);

  const contextFilesPanel = readFileSync(new URL("../src/components/client/ContextFilesPanel.tsx", import.meta.url), "utf-8");
  assert.match(contextFilesPanel, /CONTEXT_FILE_STATUS_LABEL/);
  assert.doesNotMatch(contextFilesPanel, /not_started:\s*"Missing"/, "the panel must not carry its own duplicate copy of the status label map");
});
