import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { contentFingerprintEntries } from "../scripts/stage-a-content-fingerprint.mjs";
import {
  assertResolvedWithinRoot,
  intendedTreeExclusions,
  readIntendedSnapshot,
} from "../scripts/stage-a-intended-tree.mjs";
import {
  assertDatabaseComponentEvidence,
  assertCurrentSourceBinding,
  assertSha256,
  checkStageAEvidence,
} from "../scripts/check-stage-a-evidence.mjs";
import {
  testEvidenceSourceBindingSchema,
  testSourceBindingEntries,
} from "../scripts/stage-a-test-source-binding.mjs";
import {
  assertCurrentDatabaseSourceBinding,
  assertDatabaseInputResolvedWithinRoot,
  databaseRequiredPaths,
  databaseSourceBindingEntries,
  databaseSourceBindingSchema,
  readDatabaseSourceBinding,
} from "../scripts/stage-a-database-source-binding.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Inventory {
  schema_version: string;
  repository: {
    stage_a_source_baseline_commit: string;
    orchestrator_snapshot_commit: { classification: string; value: null; owner: string };
    inventory_source_identity: {
      algorithm: string;
      sha256: string;
      input_count: number;
      total_intended_files: number;
      total_fingerprinted_files: number;
      exclusions: Array<{ path: string; reason: string }>;
      excluded_paths: string[];
    };
    production_supabase_project_ref: string;
    evidence_boundary: string;
    route: string;
  };
  frontend: {
    routes: Array<{ path: string; status: string }>;
    client_tabs: Array<{ key: string; status: string }>;
  };
  database: {
    tables: Array<{ name: string; rls_enabled: boolean }>;
    views: Array<{ name: string; status: string }>;
    rpcs: Array<{ name: string }>;
    inventory_limit: string;
  };
  edge_functions: Array<{ name: string; classification: string; callers: string[] }>;
  cron_jobs: Array<{ name: string; target: string; classification: string }>;
  migrations: Array<{ path: string; classification: string }>;
  placeholders: Array<{ surface: string }>;
  deprecated_paths: Array<{ path: string }>;
}

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

function inventory(): Inventory {
  return JSON.parse(read("docs/stage-a-current-state-inventory.json")) as Inventory;
}

test("the machine-readable Stage A inventory is deterministic and current", () => {
  assert.doesNotThrow(() => execFileSync(
    process.execPath,
    ["scripts/generate-stage-a-inventory.mjs", "--check"],
    { cwd: root, encoding: "utf8" },
  ));
  const data = inventory();
  assert.equal(data.schema_version, "aa.cockpit.stage-a-inventory.v3");
  assert.equal(data.repository.stage_a_source_baseline_commit, "7d4c1b96cdd7f3a59e28dc9826b44b1aad3b4e5e");
  assert.deepEqual(data.repository.orchestrator_snapshot_commit, {
    classification: "lifecycle-pending",
    value: null,
    owner: "Programme Orchestrator",
  });
  assert.match(data.repository.inventory_source_identity.sha256, /^[0-9a-f]{64}$/);
  assert.ok(data.repository.inventory_source_identity.input_count > 0);
  assert.equal(data.repository.inventory_source_identity.input_count, data.repository.inventory_source_identity.total_fingerprinted_files);
  assert.equal(data.repository.inventory_source_identity.total_intended_files, data.repository.inventory_source_identity.total_fingerprinted_files + 1);
  assert.deepEqual(data.repository.inventory_source_identity.exclusions, intendedTreeExclusions);
  assert.deepEqual(data.repository.inventory_source_identity.excluded_paths, ["docs/stage-a-current-state-inventory.json"]);
  assert.equal(data.repository.production_supabase_project_ref, "xivewedajschthjlblfb");
  assert.match(data.repository.evidence_boundary, /read-only capture.*bound to project.*stage-a-live-provenance-manifest/i);
  assert.match(data.repository.route, /^B\b/);
});

test("inventory fingerprint regressions are pure and cover material intended-tree changes", () => {
  const materialPaths = [
    "docs/evidence/stage-a-local-verification/test-stability-transcript.txt",
    "supabase/baseline/verify-isolation.sql",
    "supabase/baseline/application-schema.sql",
    "tests/stage-a-baseline.test.ts",
    "package.json",
    "supabase/config.toml",
    "scripts/check-stage-a-evidence.mjs",
  ];
  const entries = materialPaths.map((path) => ({ path, bytes: Buffer.from(read(path)) }));
  const before = contentFingerprintEntries(entries);
  for (const path of materialPaths) {
    const changed = entries.map((entry) => entry.path === path
      ? { ...entry, bytes: Buffer.concat([entry.bytes, Buffer.from("\nchanged")]) }
      : entry);
    assert.notEqual(contentFingerprintEntries(changed), before, `${path} must affect the fingerprint`);
  }
  assert.notEqual(contentFingerprintEntries(entries.map((entry, index) => index === 0 ? { ...entry, path: `${entry.path}.renamed` } : entry)), before);
  assert.notEqual(contentFingerprintEntries(entries.slice(1)), before, "deleting a file must affect the fingerprint");
  assert.notEqual(contentFingerprintEntries([...entries, { path: "new-intended-file.txt", bytes: Buffer.from("new") }]), before, "adding an intended file must affect the fingerprint");
  assert.equal(contentFingerprintEntries(entries), before, "identical bytes must survive a commit identity change");
  assert.equal(contentFingerprintEntries(entries), before, ".git/HEAD is not a fingerprint input");
  assert.throws(() => contentFingerprintEntries([{ path: "missing.txt", bytes: undefined as unknown as Buffer }]), /has no bytes/);
  assert.doesNotThrow(() => assertResolvedWithinRoot(root, resolve(root, "inside"), "test symlink"));
  assert.throws(() => assertResolvedWithinRoot(root, resolve(root, "..", "outside"), "test symlink"), /escapes the repository/);
  const generator = read("scripts/generate-stage-a-inventory.mjs");
  assert.doesNotMatch(generator, /rev-parse["', ]+HEAD|baseline_commit:\s*head/);
});

test("test-evidence source binding is path-and-byte deterministic and ignores non-versioned metadata", () => {
  const entries = [
    { path: "tests/example.test.ts", bytes: Buffer.from("test bytes"), mtimeMs: 1 },
    { path: "package.json", bytes: Buffer.from("{}"), mtimeMs: 2 },
    { path: "package-lock.json", bytes: Buffer.from("{}"), mtimeMs: 3 },
    { path: ".github/workflows/ci.yml", bytes: Buffer.from("name: CI\n"), mtimeMs: 4 },
    { path: "src/example.ts", bytes: Buffer.from("export {};\n"), mtimeMs: 5 },
  ];
  const before = testSourceBindingEntries(entries);
  assert.equal(before.schema_version, testEvidenceSourceBindingSchema);
  assert.match(before.sha256, /^[0-9a-f]{64}$/);
  assert.match(before.path_set_sha256, /^[0-9a-f]{64}$/);
  assert.equal(before.file_count, entries.length);

  assert.deepEqual(testSourceBindingEntries([...entries].reverse()), before, "enumeration order must not matter");
  assert.deepEqual(
    testSourceBindingEntries(entries.map((entry) => ({ ...entry, mtimeMs: entry.mtimeMs + 10_000 }))),
    before,
    "mtime metadata must not participate in the binding",
  );
  assert.deepEqual(testSourceBindingEntries(entries), before, ".git/HEAD identity is not an input");

  const changed = entries.map((entry) => entry.path === "src/example.ts"
    ? { ...entry, bytes: Buffer.from("export const changed = true;\n") }
    : entry);
  assert.notEqual(testSourceBindingEntries(changed).sha256, before.sha256, "changed bytes must change the binding");
  assert.notEqual(testSourceBindingEntries(entries.slice(1)).sha256, before.sha256, "deletion must change the binding");
  assert.notEqual(testSourceBindingEntries([...entries, { path: "src/added.ts", bytes: Buffer.from("added\n") }]).sha256, before.sha256, "addition must change the binding");
  assert.notEqual(
    testSourceBindingEntries(entries.map((entry) => entry.path === "src/example.ts" ? { ...entry, path: "src/renamed.ts" } : entry)).sha256,
    before.sha256,
    "rename must change the binding",
  );
});

test("source-binding validation fails closed for changed bytes and missing or unsupported schemas", () => {
  const current = testSourceBindingEntries([
    { path: "tests/example.test.ts", bytes: Buffer.from("exact") },
  ]);
  const altered = testSourceBindingEntries([
    { path: "tests/example.test.ts", bytes: Buffer.from("altered") },
  ]);
  assert.doesNotThrow(() => assertCurrentSourceBinding(current, current, "fixture"));
  assert.throws(() => assertCurrentSourceBinding(altered, current, "altered fixture"), /source fingerprint differs/);
  assert.throws(() => assertCurrentSourceBinding({}, current, "missing fixture"), /schema is missing or unsupported/);
  assert.throws(
    () => assertCurrentSourceBinding({ ...current, schema_version: "unsupported" }, current, "unsupported fixture"),
    /schema is missing or unsupported/,
  );
});

test("database execution binding is deterministic, database-specific, and metadata-independent", () => {
  const entries = databaseRequiredPaths.map((path, index) => ({
    path,
    bytes: Buffer.from(`database fixture ${path}\n`),
    mtimeMs: index,
  }));
  const before = databaseSourceBindingEntries(entries);
  assert.equal(before.schema_version, databaseSourceBindingSchema);
  assert.deepEqual(databaseSourceBindingEntries([...entries].reverse()), before, "enumeration order must not matter");
  assert.deepEqual(
    databaseSourceBindingEntries(entries.map((entry) => ({ ...entry, mtimeMs: entry.mtimeMs + 50_000 }))),
    before,
    "filesystem mtimes must not participate in the database binding",
  );
  assert.deepEqual(databaseSourceBindingEntries(entries), before, ".git/HEAD is not a database binding input");
  assert.ok(!databaseRequiredPaths.some((path) => path.startsWith("src/")), "unrelated frontend source must be outside the database-specific binding");

  const everyVerificationSql = databaseRequiredPaths.filter((path) => /^supabase\/baseline\/verify-.+\.sql$/.test(path));
  assert.ok(everyVerificationSql.length > 0);
  for (const path of [
    ...everyVerificationSql,
    "supabase/baseline/application-schema.sql",
    "supabase/baseline/bootstrap-data.sql",
    "supabase/config.toml",
    "scripts/bootstrap-disposable-supabase.sh",
    "scripts/run-stage-a-local-evidence.mjs",
    "supabase/baseline/manifest.json",
  ]) {
    const changed = entries.map((entry) => entry.path === path
      ? { ...entry, bytes: Buffer.concat([entry.bytes, Buffer.from("changed")]) }
      : entry);
    assert.notEqual(databaseSourceBindingEntries(changed).sha256, before.sha256, `${path} must change the database binding`);
  }

  const migrationPath = "supabase/migrations/20260802000000_stage_a_fixture.sql";
  const withMigrationEntries = [...entries, { path: migrationPath, bytes: Buffer.from("select 1;\n"), mtimeMs: 0 }];
  const withMigration = databaseSourceBindingEntries(withMigrationEntries, { applicableMigrations: [migrationPath] });
  assert.notEqual(withMigration.sha256, before.sha256, "adding an applicable migration must change the binding");
  assert.notEqual(
    databaseSourceBindingEntries(
      withMigrationEntries.map((entry) => entry.path === migrationPath ? { ...entry, bytes: Buffer.from("select 2;\n") } : entry),
      { applicableMigrations: [migrationPath] },
    ).sha256,
    withMigration.sha256,
    "changing an applicable migration must change the binding",
  );
  assert.notEqual(withMigration.sha256, databaseSourceBindingEntries(entries).sha256, "deleting an applicable migration must change the binding");
  assert.throws(() => databaseSourceBindingEntries(entries.slice(1)), /required database input is missing/);
  assert.throws(() => databaseSourceBindingEntries([...entries, entries[0]]), /paths must be unique/);
  assert.doesNotThrow(() => assertDatabaseInputResolvedWithinRoot(root, resolve(root, "supabase/baseline/application-schema.sql")));
  assert.throws(() => assertDatabaseInputResolvedWithinRoot(root, resolve(root, "..", "outside")), /escapes the repository/);
});

test("database binding and component verification fail closed for stale SQL, unsupported schemas, and mismatched mappings", () => {
  const current = readDatabaseSourceBinding(root);
  assert.doesNotThrow(() => assertCurrentDatabaseSourceBinding(current, current, "fixture"));
  assert.throws(
    () => assertCurrentDatabaseSourceBinding({ ...current, schema_version: "unsupported" }, current, "unsupported fixture"),
    /schema is missing or unsupported/,
  );
  const staleEntries = current.included_paths.map((path) => ({ path, bytes: Buffer.from(readFileSync(resolve(root, path))) }));
  const staleSql = staleEntries.map((entry) => entry.path === "supabase/baseline/verify-constraints.sql"
    ? { ...entry, bytes: Buffer.concat([entry.bytes, Buffer.from("\n-- stale fixture")]) }
    : entry);
  const stale = databaseSourceBindingEntries(staleSql, { applicableMigrations: current.applicable_post_cutover_migrations });
  assert.throws(() => assertCurrentDatabaseSourceBinding(stale, current, "stale transcript"), /differs from current repository bytes/);

  if (process.env.STAGE_A_EVIDENCE_REGENERATION === "1") return;
  const local = JSON.parse(read("docs/evidence/stage-a-local-verification/verification-manifest.json"));
  const bootstrap = local.transcripts.find((entry: { path: string }) => entry.path.endsWith("/disposable-bootstrap-transcript.txt"));
  assert.ok(bootstrap);
  const transcript = read(bootstrap.path);
  assert.doesNotThrow(() => assertDatabaseComponentEvidence(bootstrap, current, transcript));
  const mismatched = structuredClone(bootstrap);
  mismatched.component_evidence.constraints.bound_inputs[0].sha256 = "0".repeat(64);
  assert.throws(() => assertDatabaseComponentEvidence(mismatched, current, transcript), /bound inputs differ/);
});

test("actual intended-tree enumeration covers material Stage A files and only the explicit exclusion", () => {
  const snapshot = readIntendedSnapshot(root);
  for (const path of [
    "docs/evidence/stage-a-local-verification/disposable-bootstrap-transcript.txt",
    "docs/evidence/stage-a-local-verification/verification-manifest.json",
    "supabase/baseline/application-schema.sql",
    "supabase/baseline/bootstrap-data.sql",
    "supabase/baseline/verify-idempotency.sql",
    "scripts/bootstrap-disposable-supabase.sh",
    "scripts/check-stage-a-evidence.mjs",
    "tests/stage-a-foundation-remediation.test.ts",
    "package.json",
    "package-lock.json",
    "supabase/config.toml",
    "docs/STAGE_A_IMPLEMENTATION_REPORT.md",
  ]) assert.ok(snapshot.fingerprintedPaths.includes(path), `${path} must be fingerprinted`);
  assert.deepEqual(snapshot.exclusions, intendedTreeExclusions);
  assert.deepEqual(snapshot.allPaths.filter((path) => !snapshot.fingerprintedPaths.includes(path)), intendedTreeExclusions.map((entry) => entry.path));
});

test("the inventory covers every active migration and every held migration", () => {
  const data = inventory();
  const active = readdirSync(resolve(root, "supabase/migrations")).filter((name) => name.endsWith(".sql"));
  const held = readdirSync(resolve(root, "supabase/held-migrations")).filter((name) => name.endsWith(".sql"));
  assert.equal(active.length, 47);
  assert.equal(held.length, 2);
  assert.equal(data.migrations.length, active.length + held.length);
  assert.deepEqual(new Set(data.migrations.map((entry) => entry.classification)), new Set(["applied", "held"]));
  for (const name of active) assert.ok(data.migrations.some((entry) => entry.path.endsWith(name) && entry.classification === "applied"));
  for (const name of held) assert.ok(data.migrations.some((entry) => entry.path.endsWith(name) && entry.classification === "held"));
});

test("every deployable Edge Function has exactly one allowed Stage A classification", () => {
  const data = inventory();
  const local = readdirSync(resolve(root, "supabase/functions"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
    .filter((entry) => {
      try { return read(`supabase/functions/${entry.name}/index.ts`).length > 0; }
      catch { return false; }
    })
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(data.edge_functions.map((entry) => entry.name), local);
  const allowed = new Set(["deployed and used", "deployed but disconnected", "local only", "deprecated"]);
  for (const entry of data.edge_functions) {
    assert.ok(allowed.has(entry.classification), `${entry.name} has an invalid classification`);
    if (entry.classification === "deployed and used") {
      assert.ok(entry.callers.length > 0, `${entry.name} is classified as used without caller/cron evidence`);
    }
  }
  assert.equal(data.edge_functions.filter((entry) => entry.classification.startsWith("deployed")).length, 50);
  assert.equal(data.edge_functions.filter((entry) => entry.classification === "deployed and used").length, 49);
  assert.equal(data.edge_functions.filter((entry) => entry.classification === "deployed but disconnected").length, 1);
  assert.equal(data.edge_functions.filter((entry) => entry.classification === "local only").length, 9);
  assert.equal(data.edge_functions.filter((entry) => entry.classification === "deprecated").length, 1);
});

test("routes, client tabs, placeholders and deprecated paths are explicitly inventoried", () => {
  const data = inventory();
  const app = read("src/App.tsx");
  const client = read("src/pages/ClientDetailPage.tsx");
  for (const route of data.frontend.routes) {
    if (route.path.startsWith("/clients/:id") || route.path === "/login" || route.path === "/website/:id") {
      assert.ok(app.includes(route.path), `${route.path} is absent from App.tsx`);
    }
  }
  for (const tab of data.frontend.client_tabs) assert.ok(client.includes(`section: "${tab.key}"`), `${tab.key} is absent from BUTTON_BAR`);
  assert.deepEqual(
    data.frontend.client_tabs.filter((tab) => tab.status === "placeholder").map((tab) => tab.key),
    ["automations", "proof_upload", "paid_distribution"],
  );
  assert.ok(data.placeholders.length >= 4);
  assert.ok(data.deprecated_paths.length >= 5);
});

test("database inventory records the Route B baseline and held view", () => {
  const data = inventory();
  for (const table of ["clients", "client_context_files", "client_execution_files", "organic_master", "client_ideation_candidates", "video_projects", "client_distribution_records"]) {
    assert.ok(data.database.tables.some((entry) => entry.name === table), `${table} is missing from the inventory`);
  }
  for (const rpc of ["auth_role", "commit_ideation_content", "claim_due_distribution_records", "reset_failed_reel_shot_video"]) {
    assert.ok(data.database.rpcs.some((entry) => entry.name === rpc), `${rpc} is missing from the inventory`);
  }
  assert.equal(data.database.tables.length, 80);
  assert.equal(data.database.tables.filter((table) => table.rls_enabled).length, 80);
  assert.match(data.database.inventory_limit, /Route B/i);
  assert.match(data.database.views.find((entry) => entry.name === "client_phase3_status_v")?.status ?? "", /held.*absent/i);
});

test("the tracked-file secret scan is executable and clean", () => {
  const output = execFileSync(process.execPath, ["scripts/check-secret-hygiene.mjs"], { cwd: root, encoding: "utf8" });
  assert.match(output, /Secret hygiene passed/);
});

test("the intended Stage A tree has no whitespace errors or conflict markers", () => {
  const output = execFileSync(process.execPath, ["scripts/check-intended-tree.mjs"], { cwd: root, encoding: "utf8" });
  assert.match(output, /Intended-tree hygiene passed/);
});

test("evidence manifests pin exact transcript bytes and reject truncated SHA-256 values", () => {
  assert.throws(() => assertSha256("a".repeat(63), "truncated fixture"), /exactly 64 lowercase hexadecimal/);
  assert.doesNotThrow(() => assertSha256("a".repeat(64), "complete fixture"));
  const result = checkStageAEvidence();
  assert.ok(result.liveArtifacts >= 9);
  assert.ok(result.transcripts >= 2);
});

test("the evidence package preserves a successful fresh-checkout/new-mtime portability proof", () => {
  if (process.env.STAGE_A_EVIDENCE_REGENERATION === "1") return;
  const manifest = JSON.parse(read("docs/evidence/stage-a-local-verification/verification-manifest.json"));
  assert.equal(manifest.schema_version, "aa.cockpit.stage-a-local-verification.v3");
  const proof = manifest.transcripts.find((entry: { path: string }) => entry.path.endsWith("/fresh-checkout-portability-transcript.txt"));
  assert.ok(proof, "fresh-checkout portability transcript is missing");
  assert.equal(proof.exit_status, 0);
  assert.equal(proof.source_binding_schema_version, testEvidenceSourceBindingSchema);
  assert.equal(proof.content_fingerprint_match, true);
  assert.equal(proof.source_binding_match, true);
  assert.equal(proof.path_set_match, true);
  assert.equal(proof.copied_source_mtimes_newer_than_all_preserved_transcripts, true);
  assert.equal(proof.cleanup_exit_status, 0);
});
