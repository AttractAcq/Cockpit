import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { contentFingerprintEntries } from "./stage-a-content-fingerprint.mjs";
import { sha256 } from "./stage-a-evidence-lib.mjs";
import { assertResolvedWithinRoot, assertSafeRelativePath } from "./stage-a-intended-tree.mjs";

export const databaseSourceBindingSchema = "aa.cockpit.stage-a-database-source-binding.v1";
export const frozenDatabaseSourceBaseline = "7d4c1b96cdd7f3a59e28dc9826b44b1aad3b4e5e";
export const databaseBaselineCutoffVersion = "20260801000000";
export const databaseSourceEnumerationRule = "explicit required database inputs plus every supabase/migrations/*.sql version greater than 20260801000000; unique paths; sort paths; hash exact bytes";

export const databaseRequiredPaths = [
  "supabase/config.toml",
  "scripts/bootstrap-disposable-supabase.sh",
  "scripts/run-stage-a-local-evidence.mjs",
  "scripts/stage-a-database-source-binding.mjs",
  "scripts/stage-a-bootstrap-schema-rules.mjs",
  "scripts/generate-stage-a-bootstrap-schema.mjs",
  "scripts/generate-stage-a-baseline-manifest.mjs",
  "scripts/compare-stage-a-schema.mjs",
  "scripts/stage-a-evidence-lib.mjs",
  "scripts/stage-a-content-fingerprint.mjs",
  "supabase/baseline/manifest.json",
  "supabase/baseline/current-schema.sql",
  "supabase/baseline/application-schema.sql",
  "supabase/baseline/bootstrap-data.sql",
  "supabase/baseline/verify-baseline.sql",
  "supabase/baseline/verify-rls.sql",
  "supabase/baseline/verify-grants.sql",
  "supabase/baseline/verify-storage.sql",
  "supabase/baseline/verify-seeds.sql",
  "supabase/baseline/verify-isolation.sql",
  "supabase/baseline/verify-constraints.sql",
  "supabase/baseline/verify-foreign-keys.sql",
  "supabase/baseline/verify-uniqueness.sql",
  "supabase/baseline/verify-idempotency.sql",
].sort();

export const databaseSqlComponentPaths = {
  executable_application_schema: "supabase/baseline/application-schema.sql",
  bootstrap_data: "supabase/baseline/bootstrap-data.sql",
  baseline_catalogue: "supabase/baseline/verify-baseline.sql",
  rls: "supabase/baseline/verify-rls.sql",
  grants: "supabase/baseline/verify-grants.sql",
  storage: "supabase/baseline/verify-storage.sql",
  seeds: "supabase/baseline/verify-seeds.sql",
  symmetric_isolation: "supabase/baseline/verify-isolation.sql",
  constraints: "supabase/baseline/verify-constraints.sql",
  foreign_keys: "supabase/baseline/verify-foreign-keys.sql",
  uniqueness: "supabase/baseline/verify-uniqueness.sql",
  database_idempotency: "supabase/baseline/verify-idempotency.sql",
};

function migrationVersion(path) {
  const name = path.split("/").at(-1) ?? "";
  const match = name.match(/^(\d{14})_.+\.sql$/);
  if (!match) throw new Error(`invalid active migration filename: ${path}`);
  return match[1];
}

export function enumerateApplicablePostCutoverMigrations(root) {
  const directory = join(root, "supabase", "migrations");
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => `supabase/migrations/${entry.name}`)
    .filter((path) => migrationVersion(path) > databaseBaselineCutoffVersion)
    .sort();
}

export function databaseSourceBindingEntries(entries, options = {}) {
  const requiredPaths = [...(options.requiredPaths ?? databaseRequiredPaths)].sort();
  const applicableMigrations = [...(options.applicableMigrations ?? [])].sort();
  const normalized = entries.map(({ path, bytes }) => {
    assertSafeRelativePath(path);
    if (bytes === undefined || bytes === null) throw new Error(`database input ${path} has no bytes`);
    return { path, bytes: Buffer.from(bytes) };
  });
  const paths = normalized.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) throw new Error("database input paths must be unique");
  const byPath = new Map(normalized.map((entry) => [entry.path, entry]));
  for (const path of requiredPaths) {
    if (!byPath.has(path)) throw new Error(`required database input is missing: ${path}`);
  }
  for (const path of applicableMigrations) {
    if (!byPath.has(path)) throw new Error(`applicable post-cutover migration is missing: ${path}`);
    migrationVersion(path);
  }
  const allowed = new Set([...requiredPaths, ...applicableMigrations]);
  for (const path of paths) {
    if (!allowed.has(path)) throw new Error(`unexpected database input path: ${path}`);
  }
  const sorted = normalized.sort((left, right) => left.path.localeCompare(right.path));
  const fileHashes = Object.fromEntries(sorted.map(({ path, bytes }) => [path, sha256(bytes)]));
  const migrationHashes = Object.fromEntries(applicableMigrations.map((path) => [path, fileHashes[path]]));
  return {
    schema_version: databaseSourceBindingSchema,
    frozen_source_baseline_commit: frozenDatabaseSourceBaseline,
    enumeration_rule: databaseSourceEnumerationRule,
    algorithm: "sha256(path NUL exact-bytes NUL, sorted paths)",
    path_set_sha256: contentFingerprintEntries(sorted.map(({ path }) => ({ path, bytes: Buffer.alloc(0) }))),
    sha256: contentFingerprintEntries(sorted),
    file_count: sorted.length,
    included_paths: sorted.map(({ path }) => path),
    file_hashes: fileHashes,
    baseline_cutoff_version: databaseBaselineCutoffVersion,
    applicable_post_cutover_migrations: applicableMigrations,
    applicable_post_cutover_migration_hashes: migrationHashes,
    executable_application_schema_sha256: fileHashes["supabase/baseline/application-schema.sql"],
    captured_authority_sha256: fileHashes["supabase/baseline/current-schema.sql"],
    baseline_manifest_sha256: fileHashes["supabase/baseline/manifest.json"],
    supabase_configuration_sha256: fileHashes["supabase/config.toml"],
  };
}

function readDatabaseInput(root, path) {
  assertSafeRelativePath(path);
  const absolute = resolve(root, path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    throw new Error(`required database input is missing: ${path}`, { cause: error });
  }
  if (stat.isSymbolicLink()) assertResolvedWithinRoot(root, realpathSync(absolute), `database input symlink ${path}`);
  else if (!stat.isFile()) throw new Error(`database input is not a regular file: ${path}`);
  return { path, bytes: readFileSync(absolute) };
}

export function readDatabaseSourceBinding(root) {
  const applicableMigrations = enumerateApplicablePostCutoverMigrations(root);
  const paths = [...databaseRequiredPaths, ...applicableMigrations];
  return databaseSourceBindingEntries(paths.map((path) => readDatabaseInput(root, path)), { applicableMigrations });
}

export function assertDatabaseInputResolvedWithinRoot(root, resolvedPath, label = "database input") {
  assertResolvedWithinRoot(root, resolvedPath, label);
}

export function assertCurrentDatabaseSourceBinding(recorded, current, label = "database evidence") {
  assert.ok(recorded && typeof recorded === "object", `${label} deterministic database source binding is missing`);
  assert.equal(recorded.schema_version, databaseSourceBindingSchema, `${label} database source-binding schema is missing or unsupported`);
  assert.equal(current.schema_version, databaseSourceBindingSchema, `${label} recomputed database source-binding schema is unsupported`);
  for (const binding of [recorded, current]) {
    for (const field of [
      "path_set_sha256", "sha256", "executable_application_schema_sha256", "captured_authority_sha256",
      "baseline_manifest_sha256", "supabase_configuration_sha256",
    ]) assert.match(binding[field], /^[0-9a-f]{64}$/, `${label} ${field} is malformed`);
    assert.equal(binding.file_count, binding.included_paths.length, `${label} database input count differs from its path list`);
    assert.deepEqual(Object.keys(binding.file_hashes), binding.included_paths, `${label} per-file hash paths differ from its included paths`);
    for (const [path, digest] of Object.entries(binding.file_hashes)) {
      assert.match(digest, /^[0-9a-f]{64}$/, `${label} per-file hash is malformed for ${path}`);
    }
    assert.deepEqual(Object.keys(binding.applicable_post_cutover_migration_hashes), binding.applicable_post_cutover_migrations, `${label} migration hashes differ from its applicable list`);
  }
  assert.deepEqual(recorded, current, `${label} database source binding differs from current repository bytes`);
}

export function databaseComponentInputPaths(binding) {
  const migrations = binding.applicable_post_cutover_migrations;
  return {
    start: ["scripts/run-stage-a-local-evidence.mjs", "supabase/config.toml"],
    empty_application_schema: ["scripts/bootstrap-disposable-supabase.sh"],
    executable_application_schema: [databaseSqlComponentPaths.executable_application_schema],
    bootstrap_data: [databaseSqlComponentPaths.bootstrap_data],
    post_cutover_migrations: ["scripts/bootstrap-disposable-supabase.sh", ...migrations],
    baseline_reconstruction: ["scripts/bootstrap-disposable-supabase.sh", databaseSqlComponentPaths.executable_application_schema, databaseSqlComponentPaths.bootstrap_data, ...migrations],
    baseline_catalogue: [databaseSqlComponentPaths.baseline_catalogue],
    rls: [databaseSqlComponentPaths.rls],
    grants: [databaseSqlComponentPaths.grants],
    storage: [databaseSqlComponentPaths.storage],
    seeds: [databaseSqlComponentPaths.seeds],
    symmetric_isolation: [databaseSqlComponentPaths.symmetric_isolation],
    constraints: [databaseSqlComponentPaths.constraints],
    foreign_keys: [databaseSqlComponentPaths.foreign_keys],
    uniqueness: [databaseSqlComponentPaths.uniqueness],
    database_idempotency: [databaseSqlComponentPaths.database_idempotency],
    catalogue_comparison: ["scripts/bootstrap-disposable-supabase.sh", "scripts/compare-stage-a-schema.mjs", "supabase/baseline/manifest.json"],
    bootstrap: ["scripts/bootstrap-disposable-supabase.sh", "scripts/stage-a-database-source-binding.mjs"],
    cleanup: ["scripts/run-stage-a-local-evidence.mjs", "supabase/config.toml"],
  };
}

export function expectedDatabaseComponentInputs(binding, component) {
  const paths = databaseComponentInputPaths(binding)[component];
  if (!paths) throw new Error(`unknown database component: ${component}`);
  return paths.map((path) => {
    const digest = binding.file_hashes[path];
    if (!digest) throw new Error(`database component ${component} references unbound input ${path}`);
    return { path, sha256: digest };
  });
}
