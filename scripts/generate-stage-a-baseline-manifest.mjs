import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executableProjectionExclusionRules } from "./stage-a-bootstrap-schema-rules.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = join(root, "supabase/baseline/current-schema.sql");
const outputPath = join(root, "supabase/baseline/manifest.json");
const checkOnly = process.argv.includes("--check");
const baseline = readFileSync(baselinePath, "utf8");
const applicationSchemaPath = join(root, "supabase/baseline/application-schema.sql");
const applicationSchema = readFileSync(applicationSchemaPath, "utf8");
const liveEvidence = JSON.parse(readFileSync(join(root, "docs/evidence/stage-a-live-evidence-manifest.json"), "utf8"));
const liveArtifacts = new Map(liveEvidence.artifacts.map((entry) => [entry.path, entry.sha256]));
const cutoffVersion = "20260801000000";

const migrations = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => ({
    name,
    path: `supabase/migrations/${name}`,
    version: name.slice(0, 14),
    body: readFileSync(join(root, "supabase/migrations", name), "utf8"),
  }));

const heldMigrations = readdirSync(join(root, "supabase/held-migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function firstMigration(pattern) {
  return migrations.find(({ body }) => pattern.test(body))?.path ?? null;
}

function lastMigration(patternFactory) {
  return [...migrations].reverse().find(({ body }) => patternFactory().test(body))?.path ?? null;
}

function escaped(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function provenance(migration) {
  return migration
    ? { classification: "introduced by a later active migration", migration }
    : {
        classification: "unresolved",
        reason: "Present in the current production snapshot but not created by any later active migration; the foundation stub does not prove exact cutover membership.",
      };
}

const tableBlocks = [...baseline.matchAll(
  /^CREATE TABLE IF NOT EXISTS "public"\."([^"]+)" \(\n([\s\S]*?)\n\);$/gm,
)];

const addConstraints = new Map();
for (const match of baseline.matchAll(
  /^ALTER TABLE ONLY "public"\."([^"]+)"\n\s+ADD CONSTRAINT "([^"]+)" ([\s\S]*?);$/gm,
)) {
  const entries = addConstraints.get(match[1]) ?? [];
  entries.push({ name: match[2], definition: match[3].replace(/\s+/g, " ").trim() });
  addConstraints.set(match[1], entries);
}

const tables = tableBlocks.map((match) => {
  const name = match[1];
  const createPattern = new RegExp(`\\bcreate\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${escaped(name)}\\b`, "i");
  const introducedBy = firstMigration(createPattern);
  const inlineConstraints = [...match[2].matchAll(/^\s+CONSTRAINT "([^"]+)" ([\s\S]*?)(?:,)?$/gm)]
    .map((entry) => ({ name: entry[1], definition: entry[2].replace(/\s+/g, " ").replace(/,$/, "").trim() }));
  const constraints = [...inlineConstraints, ...(addConstraints.get(name) ?? [])]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((constraint) => {
      const migration = firstMigration(new RegExp(escaped(constraint.name), "i"));
      return { ...constraint, ...provenance(migration) };
    });
  const columns = match[2].split("\n")
    .map((line) => /^\s+"([^"]+)"\s+(.+?)(?:,)?$/.exec(line))
    .filter(Boolean)
    .map((entry) => {
      const column = entry[1];
      const addPattern = new RegExp(
        `alter\\s+table(?:\\s+if\\s+exists)?\\s+(?:public\\.)?${escaped(name)}[\\s\\S]{0,500}?add\\s+column(?:\\s+if\\s+not\\s+exists)?\\s+${escaped(column)}\\b`,
        "i",
      );
      const migration = firstMigration(addPattern) ?? introducedBy;
      return {
        name: column,
        definition: entry[2].replace(/,$/, "").trim(),
        ...provenance(migration),
      };
    });
  return {
    name,
    ...provenance(introducedBy),
    columns,
    constraints,
    rls_enabled: new RegExp(`^ALTER TABLE "public"\\."${escaped(name)}" ENABLE ROW LEVEL SECURITY;$`, "m").test(baseline),
  };
}).sort((left, right) => left.name.localeCompare(right.name));

const enums = [...baseline.matchAll(
  /^CREATE TYPE "public"\."([^"]+)" AS ENUM \(([\s\S]*?)\n\);$/gm,
)].map((match) => ({
  name: match[1],
  values: [...match[2].matchAll(/'([^']+)'/g)].map((entry) => entry[1]),
  ...provenance(firstMigration(new RegExp(`create\\s+type\\s+(?:public\\.)?${escaped(match[1])}\\b`, "i"))),
})).sort((left, right) => left.name.localeCompare(right.name));

const functions = [...baseline.matchAll(
  /^CREATE OR REPLACE FUNCTION "public"\."([^"]+)"\(([\s\S]*?)\) RETURNS ([^\n]+)$/gm,
)].map((match) => {
  const name = match[1];
  const latestDefinition = lastMigration(() => new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?${escaped(name)}\\s*\\(`, "i"));
  return {
    name,
    arguments: match[2].replace(/\s+/g, " "),
    returns: match[3].trim(),
    ...provenance(latestDefinition),
    provenance_note: latestDefinition ? "Current name has a definition in the named later migration; overload-level historical equivalence is not inferred." : undefined,
  };
}).sort((left, right) => `${left.name}(${left.arguments})`.localeCompare(`${right.name}(${right.arguments})`));

const indexes = [...baseline.matchAll(
  /^CREATE (UNIQUE )?INDEX "([^"]+)" ON "public"\."([^"]+)" ([^;]+);$/gm,
)].map((match) => {
  const migration = firstMigration(new RegExp(escaped(match[2]), "i"));
  return { name: match[2], table: match[3], unique: Boolean(match[1]), definition: match[4], ...provenance(migration) };
}).sort((left, right) => left.name.localeCompare(right.name));

const triggers = [...baseline.matchAll(
  /^CREATE OR REPLACE TRIGGER "([^"]+)" ([^\n]+) ON "public"\."([^"]+)" ([^;]+);$/gm,
)].map((match) => {
  const migration = firstMigration(new RegExp(escaped(match[1]), "i"));
  return { name: match[1], table: match[3], definition: `${match[2]} ON public.${match[3]} ${match[4]}`, ...provenance(migration) };
}).sort((left, right) => left.name.localeCompare(right.name));

const policies = [...baseline.matchAll(
  /^CREATE POLICY "([^"]+)" ON "public"\."([^"]+)" ([\s\S]*?);$/gm,
)].map((match) => {
  const migration = firstMigration(new RegExp(escaped(match[1]), "i"));
  return { name: match[1], table: match[2], definition: match[3].replace(/\s+/g, " ").trim(), ...provenance(migration) };
}).sort((left, right) => `${left.table}.${left.name}`.localeCompare(`${right.table}.${right.name}`));

const views = [...baseline.matchAll(
  /^CREATE OR REPLACE VIEW "public"\."([^"]+)" ([\s\S]*?);$/gm,
)].map((match) => {
  const migration = lastMigration(() => new RegExp(`create\\s+(?:or\\s+replace\\s+)?view\\s+(?:public\\.)?${escaped(match[1])}\\b`, "i"));
  return { name: match[1], definition_sha256: sha256(match[2].replace(/\s+/g, " ").trim()), ...provenance(migration) };
});

const grants = [...baseline.matchAll(/^(GRANT|REVOKE) ([^;]+);$/gm)].map((match) => ({
  action: match[1].toLowerCase(),
  statement_sha256: sha256(`${match[1]} ${match[2]};`),
}));

const manifest = {
  schema_version: "aa.cockpit.stage-a-current-baseline.v2",
  route: "B",
  cutover: {
    version: cutoffVersion,
    captured_at_utc: liveEvidence.captured_at_utc,
    includes_active_migrations_through: "20260731000041",
    rule: `Fresh Supabase-managed environments apply application-schema.sql, then bootstrap-data.sql, then only active migrations with a version greater than ${cutoffVersion}. current-schema.sql is captured authority and derivation input, not the executable local-stack artifact. Existing production continues to use its unchanged historical ledger.`,
  },
  reconstruction_contract: {
    captured_production_authority: {
      path: "supabase/baseline/current-schema.sql",
      sha256: sha256(baseline),
      classification: "immutable captured production authority",
      purpose: "Exact schema-only evidence and deterministic derivation source.",
      live_capture_project_ref: liveEvidence.actual_linked_project_ref,
      live_capture_provenance: "docs/evidence/stage-a-live-provenance-manifest.json",
      directly_executed_by_disposable_bootstrap: false,
    },
    executable_application_reconstruction: {
      path: "supabase/baseline/application-schema.sql",
      sha256: sha256(applicationSchema),
      classification: "canonical executable application reconstruction",
      generated_from: "supabase/baseline/current-schema.sql",
      generator: "scripts/generate-stage-a-bootstrap-schema.mjs",
      exclusion_rules: executableProjectionExclusionRules.map(({ id, classification, description }) => ({ id, classification, description })),
      directly_executed_by_disposable_bootstrap: true,
    },
    bootstrap_configuration_and_data: {
      path: "supabase/baseline/bootstrap-data.sql",
      sha256: sha256(readFileSync(join(root, "supabase/baseline/bootstrap-data.sql"))),
      classification: "application-owned non-secret bootstrap configuration and seed data",
      directly_executed_by_disposable_bootstrap: true,
    },
    post_cutover_migrations: {
      directory: "supabase/migrations",
      version_strictly_greater_than: cutoffVersion,
      currently_applicable_count: migrations.filter(({ version }) => version > cutoffVersion).length,
      classification: "ordered active post-cutover migrations",
    },
  },
  authority: {
    current_schema_path: "supabase/baseline/current-schema.sql",
    current_schema_sha256: sha256(baseline),
    bootstrap_schema_path: "supabase/baseline/application-schema.sql",
    bootstrap_schema_sha256: sha256(applicationSchema),
    external_snapshot_sha256: liveArtifacts.get("remote-schema.sql"),
    snapshot_equivalence: sha256(baseline) === liveArtifacts.get("remote-schema.sql"),
    safety: "current-schema.sql is schema-only captured authority with no COPY/INSERT data section, credentials, connection strings, signed URLs, or client rows. application-schema.sql is the canonical executable projection for a Supabase-managed local stack.",
  },
  verification_scope: {
    captured_snapshot: "Exact byte equality by SHA-256 between current-schema.sql and the provenance-bound external schema-only dump.",
    executable_projection: "Exact deterministic generation of application-schema.sql from current-schema.sql using the recorded platform-owned exclusion rules, plus successful disposable execution.",
    rebuilt_catalogue: "Identifier multiset only: table names, column names, constraint names, enum names/ordered values, public function names, view names, trigger names, policy names, index names, RLS-enabled table flags, selected storage bucket/policy names, and two seed identities. It does not compare function bodies, policy expressions, constraint definitions, index definitions, or ACLs.",
    policies: "RLS-enabled flags for all public tables and total policy/name catalogue; symmetric behavior is representative for clients and organic_master, not exhaustive policy-expression behavior.",
    grants: "Six service-role-only RPC privilege checks are representative. Captured GRANT/REVOKE statement hashes are inventoried but complete rebuilt ACL equivalence is not asserted.",
    behavioral_database: "Named representative constraints, foreign keys/actions, uniqueness, and begin_ideation_run idempotency cases; not exhaustive database behavior.",
  },
  classification_legend: {
    "existed at the foundation cutover": "Not assigned where the stub is the only historical DDL evidence; exact claims are intentionally withheld.",
    "introduced by a later active migration": "A repository migration creates or names the object/column/constraint.",
    "held or intentionally excluded": "Outside the active migration directory and absent from the baseline.",
    "production-only or externally configured": "Supabase platform state or operator-managed state outside the public schema dump.",
    "generated or extension-managed": "Owned by the Supabase local stack or a PostgreSQL extension.",
    unresolved: "Current snapshot object with no provable later repository introduction; exact foundation membership cannot be proven.",
  },
  object_summary: {
    schemas: 2,
    enums: enums.length,
    tables: tables.length,
    columns: tables.reduce((sum, table) => sum + table.columns.length, 0),
    constraints: tables.reduce((sum, table) => sum + table.constraints.length, 0),
    explicit_indexes: indexes.length,
    views: views.length,
    materialized_views: 0,
    explicit_sequences: 0,
    function_signatures: functions.length,
    triggers: triggers.length,
    rls_enabled_tables: tables.filter((table) => table.rls_enabled).length,
    policies: policies.length,
    grant_and_revoke_statements: grants.length,
  },
  schemas: [
    { name: "public", classification: "unresolved", note: "Application schema captured exactly at the Route B cutover; individual object provenance is below." },
    { name: "extensions", classification: "generated or extension-managed", note: "Supabase extension helper functions are retained from the captured dump but are platform-managed." },
    { name: "auth", classification: "generated or extension-managed", note: "Required by public foreign keys/functions; supplied by Supabase, not duplicated in this baseline." },
    { name: "storage", classification: "generated or extension-managed", note: "Supplied by Supabase; application buckets and policies are installed by bootstrap-data.sql." },
    { name: "cron", classification: "production-only or externally configured", note: "pg_cron is platform/operator state and is not installed by the safe bootstrap." },
    { name: "vault", classification: "production-only or externally configured", note: "Secret values and Vault references are never copied by the baseline." },
  ],
  extensions: [
    { name: "pgcrypto", classification: "generated or extension-managed", requirement: "gen_random_uuid() used by public tables" },
    { name: "pg_cron", classification: "production-only or externally configured", requirement: "required only when operators install scheduled jobs" },
    { name: "pg_net", classification: "production-only or externally configured", requirement: "required only when operators install scheduled HTTP jobs" },
    { name: "supabase_vault", classification: "production-only or externally configured", requirement: "required only for out-of-band secret references" },
  ],
  enums,
  tables,
  views,
  materialized_views: [],
  explicit_sequences: [],
  functions,
  triggers,
  indexes,
  policies,
  grants: {
    statement_count: grants.length,
    statement_hashes: grants.map((grant) => grant.statement_sha256).sort(),
    verification: "verify-grants.sql checks six representative service-role-only RPCs remain unavailable to anon/authenticated and executable by service_role. Complete rebuilt ACL equivalence is not claimed.",
  },
  held_or_intentionally_excluded: [
    { object: "public.client_phase3_status_v", source: "supabase/held-migrations/20260717000018_client_phase3_status_view.sql", classification: "held or intentionally excluded" },
    { object: "public.increment_ad_lead(uuid,date) and two retired lead-score trigger functions", source: "supabase/held-migrations/20260622000000_p1_security_lockdown.sql", classification: "held or intentionally excluded" },
  ],
  external_configuration: {
    storage: {
      classification: "production-only or externally configured",
      bootstrap_asset: "supabase/baseline/bootstrap-data.sql",
      buckets: ["client-assets", "video-assets"],
      policies: 8,
    },
    seed_records: {
      classification: "code-confirmed",
      bootstrap_asset: "supabase/baseline/bootstrap-data.sql",
      rows: ["brand_prompt_blocks:brand_dna:v1", "brand_prompt_blocks:brand_sting:v1"],
      note: "Schema-only evidence contains no DML. No production/client data is copied. Client distribution-account backfill is intentionally not replayed into an empty environment.",
    },
    cron_jobs: [
      { name: "publish-worker", schedule: "* * * * *", target: "process-scheduled-publishing", classification: "historically live-verified; external install required" },
      { name: "insights-worker", schedule: "0 * * * *", target: "collect-instagram-insights", classification: "historically live-verified; repository installer missing and deferred" },
      { name: "generation-worker", classification: "held/commented; intentionally not scheduled" },
    ],
    secrets_and_vault: { classification: "externally configured", rule: "Names/configuration are documented; values are prohibited from Git and bootstrap output." },
    auth_and_dashboard_settings: { classification: "externally configured", rule: "Auth users, provider settings, password controls, URLs, and platform toggles are not schema-baseline data." },
  },
  migration_history: {
    active_count: migrations.length,
    held_count: heldMigrations.length,
    active: migrations.map(({ name, path, version, body }) => ({ name: name.slice(15, -4), path, version, sha256: sha256(body), classification: "historical ledger; incorporated into Route B baseline" })),
    held: heldMigrations.map((name) => ({ path: `supabase/held-migrations/${name}`, version: name.slice(0, 14), sha256: sha256(readFileSync(join(root, "supabase/held-migrations", name))) })),
  },
};

const rendered = `${JSON.stringify(manifest, null, 2)}\n`;
if (checkOnly) {
  if (readFileSync(outputPath, "utf8") !== rendered) {
    console.error(`Stage A baseline manifest is stale. Run: node ${relative(root, fileURLToPath(import.meta.url))}`);
    process.exit(1);
  }
  console.log(`Stage A baseline manifest is current (${tables.length} tables, ${functions.length} function signatures, ${policies.length} policies).`);
} else {
  writeFileSync(outputPath, rendered);
  console.log(`Wrote ${relative(root, outputPath)}.`);
}
