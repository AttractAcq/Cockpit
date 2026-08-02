import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const hash = (body: string) => createHash("sha256").update(body).digest("hex");

test("Route B preserves the historical stub and pins an exact schema-only production snapshot", () => {
  const foundation = read("supabase/migrations/20260702074337_v1_foundation.sql");
  const baseline = read("supabase/baseline/current-schema.sql");
  assert.match(foundation, /Full SQL applied via MCP/);
  assert.doesNotMatch(foundation, /\bCREATE\s+TABLE\b/i);
  assert.equal(hash(baseline), "09a2aaf0d8b65e3954b2e6704f59f99025e05a029905d697614641c575577f5a");
  assert.doesNotMatch(baseline, /^COPY\b/gmi, "schema authority must not copy production rows");
  assert.doesNotThrow(() => execFileSync(process.execPath, ["scripts/compare-stage-a-schema.mjs"], { cwd: root }));
});

test("the baseline manifest is deterministic and classifies the complete current public schema", () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, ["scripts/generate-stage-a-bootstrap-schema.mjs", "--check"], { cwd: root }));
  assert.doesNotThrow(() => execFileSync(process.execPath, ["scripts/generate-stage-a-baseline-manifest.mjs", "--check"], { cwd: root }));
  const manifest = JSON.parse(read("supabase/baseline/manifest.json"));
  assert.equal(manifest.route, "B");
  assert.equal(manifest.schema_version, "aa.cockpit.stage-a-current-baseline.v2");
  assert.equal(manifest.cutover.version, "20260801000000");
  assert.equal(manifest.reconstruction_contract.captured_production_authority.directly_executed_by_disposable_bootstrap, false);
  assert.equal(manifest.reconstruction_contract.executable_application_reconstruction.path, "supabase/baseline/application-schema.sql");
  assert.equal(manifest.reconstruction_contract.executable_application_reconstruction.directly_executed_by_disposable_bootstrap, true);
  assert.equal(manifest.reconstruction_contract.bootstrap_configuration_and_data.path, "supabase/baseline/bootstrap-data.sql");
  assert.equal(manifest.reconstruction_contract.post_cutover_migrations.currently_applicable_count, 0);
  assert.match(manifest.verification_scope.rebuilt_catalogue, /does not compare function bodies.*policy expressions.*ACLs/i);
  assert.match(manifest.verification_scope.grants, /six.*representative/i);
  assert.deepEqual(manifest.object_summary, {
    schemas: 2,
    enums: 17,
    tables: 80,
    columns: 1399,
    constraints: 647,
    explicit_indexes: 173,
    views: 1,
    materialized_views: 0,
    explicit_sequences: 0,
    function_signatures: 86,
    triggers: 38,
    rls_enabled_tables: 80,
    policies: 145,
    grant_and_revoke_statements: 422,
  });
  assert.equal(manifest.tables.filter((entry: { classification: string }) => entry.classification === "introduced by a later active migration").length, 49);
  assert.equal(manifest.tables.filter((entry: { classification: string }) => entry.classification === "unresolved").length, 31);
  assert.equal(manifest.authority.snapshot_equivalence, true);
});

test("the baseline cutover incorporates exactly the captured ledger and excludes held migrations", () => {
  const manifest = JSON.parse(read("supabase/baseline/manifest.json"));
  const active = readdirSync(resolve(root, "supabase/migrations")).filter((name) => name.endsWith(".sql")).sort();
  const held = readdirSync(resolve(root, "supabase/held-migrations")).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(active.length, 47);
  assert.equal(held.length, 2);
  assert.deepEqual(manifest.migration_history.active.map((entry: { path: string }) => entry.path.split("/").pop()), active);
  assert.deepEqual(manifest.migration_history.held.map((entry: { path: string }) => entry.path.split("/").pop()), held);
  assert.equal(active.filter((name) => name.slice(0, 14) > manifest.cutover.version).length, 0);
  assert.doesNotMatch(read("supabase/baseline/current-schema.sql"), /client_phase3_status_v/);
});

test("bootstrap restores omitted storage configuration and required seed rows without cron or secrets", () => {
  const data = read("supabase/baseline/bootstrap-data.sql");
  for (const bucket of ["client-assets", "video-assets"]) assert.match(data, new RegExp(`'${bucket}'`));
  assert.equal((data.match(/create policy /gi) ?? []).length, 8);
  assert.match(data, /'brand_dna', 1/);
  assert.match(data, /'brand_sting', 1/);
  assert.doesNotMatch(data, /cron\.schedule|vault\.create_secret|https:\/\//i);
});

test("bootstrap fails closed before Docker without confirmation or when production is supplied", () => {
  const absent = spawnSync("bash", ["scripts/bootstrap-disposable-supabase.sh"], { cwd: root, encoding: "utf8", env: { ...process.env, STAGE_A_DISPOSABLE_CONFIRM: "" } });
  assert.notEqual(absent.status, 0);
  assert.match(absent.stderr, /confirm/i);

  const production = spawnSync("bash", ["scripts/bootstrap-disposable-supabase.sh"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, STAGE_A_DISPOSABLE_CONFIRM: "reset-local-cockpit-disposable", SUPABASE_PROJECT_REF: "xivewedajschthjlblfb" },
  });
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /production project ref is prohibited/i);
});

test("local Supabase startup delegates fresh reconstruction to the guarded Route B bootstrap", () => {
  const config = read("supabase/config.toml");
  assert.match(config, /\[db\.migrations\]\s+enabled\s*=\s*false/);
  assert.match(config, /\[db\.seed\]\s+enabled\s*=\s*false/);
  assert.match(read("supabase/baseline/README.md"), /guarded[\s\S]*bootstrap/i);
});

test("catalogue and behavioral SQL cover every required Stage A database evidence component", () => {
  const verify = read("supabase/baseline/verify-baseline.sql");
  const isolation = read("supabase/baseline/verify-isolation.sql");
  for (const required of ["80 public tables", "17 public enums", "145 public policies", "RLS on all 80", "service_role", "client_phase3_status_v", "storage buckets", "brand prompt seed"]) {
    assert.match(verify, new RegExp(required.replace(/ /g, "\\s+"), "i"));
  }
  assert.match(isolation, /set local role authenticated/i);
  assert.match(isolation, /client one can see client two/i);
  assert.match(isolation, /client two can see client one/i);
  assert.match(isolation, /ORG-TEST-ONE/);
  assert.match(isolation, /ORG-TEST-TWO/);
  assert.match(isolation, /rollback;/i);

  const behavioralFiles = {
    constraints: read("supabase/baseline/verify-constraints.sql"),
    foreignKeys: read("supabase/baseline/verify-foreign-keys.sql"),
    uniqueness: read("supabase/baseline/verify-uniqueness.sql"),
    idempotency: read("supabase/baseline/verify-idempotency.sql"),
  };
  assert.match(behavioralFiles.constraints, /not_null_violation/);
  assert.match(behavioralFiles.constraints, /check_violation/);
  assert.match(behavioralFiles.constraints, /invalid_text_representation/);
  assert.match(behavioralFiles.foreignKeys, /foreign_key_violation/);
  assert.match(behavioralFiles.foreignKeys, /ON DELETE CASCADE/i);
  assert.match(behavioralFiles.foreignKeys, /ON UPDATE NO ACTION/i);
  assert.match(behavioralFiles.uniqueness, /clients_slug_key/);
  assert.match(behavioralFiles.uniqueness, /organic_master_client_id_ref_key/);
  assert.match(behavioralFiles.idempotency, /public\.begin_ideation_run/g);
  assert.match(behavioralFiles.idempotency, /IDEMPOTENCY_CONFLICT/);
  for (const sql of Object.values(behavioralFiles)) {
    assert.match(sql, /begin;/i);
    assert.match(sql, /rollback;/i);
    assert.match(sql, /STAGE_A_CASE/);
  }

  const runner = read("scripts/bootstrap-disposable-supabase.sh");
  for (const component of ["symmetric_isolation", "constraints", "foreign_keys", "uniqueness", "database_idempotency"]) {
    assert.match(runner, new RegExp(`run_sql_component \\"${component}\\"`));
  }
  const evidenceGate = read("scripts/check-stage-a-evidence.mjs");
  assert.match(evidenceGate, /named_database_cases/);
  assert.match(evidenceGate, /lacks executed transcript evidence/);
});
