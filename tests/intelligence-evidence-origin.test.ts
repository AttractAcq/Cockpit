import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260812170000_phase_2a_upstream_evidence_origins.sql",
  import.meta.url,
);

const downstreamFunctionPaths = [
  "run-avatar-os",
  "run-competitor-os",
  "run-association-os",
  "run-brand-strategist",
].map((name) => new URL(`../supabase/functions/${name}/index.ts`, import.meta.url));

test("structured observations accept only source-backed or completely located upstream authority", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /source_type = 'structured_observation'/);
  assert.match(migration, /research_source_id is not null\s+or \(/);
  assert.match(migration, /locator ->> 'upstream_domain' in/);
  assert.match(migration, /nullif\(trim\(locator ->> 'release_id'\), ''\) is not null/);
  assert.match(migration, /nullif\(trim\(locator ->> 'record_key'\), ''\) is not null/);
  for (const domain of ["market_os", "avatar_os", "competitor_os", "association_os", "brand_strategist"]) {
    assert.match(migration, new RegExp(`'${domain}'`));
  }
  assert.match(migration, /validate constraint client_evidence_records_origin_check/);
});

test("every downstream OS supplies an immutable upstream record locator", async () => {
  const functions = await Promise.all(downstreamFunctionPaths.map((path) => readFile(path, "utf8")));
  for (const source of functions) {
    assert.match(source, /source_type: "structured_observation"/);
    assert.match(source, /upstream_domain: "/);
    assert.match(source, /release_id: authority\./);
    assert.match(source, /release_version: authority\./);
    assert.match(source, /record_key: record\.record_key/);
  }
});
