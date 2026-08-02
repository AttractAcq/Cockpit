import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readIntendedSnapshot } from "./stage-a-intended-tree.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "docs", "stage-a-current-state-inventory.json");
const checkOnly = process.argv.includes("--check");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function filesBelow(path, suffix) {
  const absolute = join(root, path);
  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(absolute, entry.name);
      if (entry.isDirectory()) {
        return readdirSync(child, { withFileTypes: true })
          .filter((nested) => nested.isFile() && nested.name.endsWith(suffix))
          .map((nested) => join(child, nested.name));
      }
      return entry.isFile() && entry.name.endsWith(suffix) ? [child] : [];
    })
    .sort();
}

function unique(values) {
  return [...new Set(values)].sort();
}

function matches(body, pattern, group = 1) {
  return [...body.matchAll(pattern)].map((match) => match[group]).filter(Boolean);
}

function requireSha256(value, label) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be exactly 64 lowercase hexadecimal characters`);
  return value;
}

const intendedSnapshot = readIntendedSnapshot(root);
const intendedPaths = intendedSnapshot.allPaths;
const sourceFiles = intendedPaths.filter((path) => /^(src|supabase\/functions)\/.*\.(?:ts|tsx)$/.test(path));
const sourceBodies = sourceFiles.map((path) => ({ path, body: read(path) }));
const migrationFiles = filesBelow("supabase/migrations", ".sql");
const heldMigrationFiles = filesBelow("supabase/held-migrations", ".sql");
const baselineManifest = JSON.parse(read("supabase/baseline/manifest.json"));
const liveEvidenceManifest = JSON.parse(read("docs/evidence/stage-a-live-evidence-manifest.json"));
const liveEvidenceHashes = new Map(liveEvidenceManifest.artifacts.map((artifact) => [
  artifact.path,
  requireSha256(artifact.sha256, `live evidence ${artifact.path}`),
]));
const evidenceHash = (path) => {
  const value = liveEvidenceHashes.get(path);
  if (!value) throw new Error(`live evidence manifest is missing ${path}`);
  return value;
};

const inventorySourcePaths = intendedSnapshot.fingerprintedPaths;
const inventorySourceSha256 = intendedSnapshot.sha256;

const ddlTableFiles = new Map();
const ddlFunctionFiles = new Map();
for (const absolute of migrationFiles) {
  const path = relative(root, absolute);
  const body = readFileSync(absolute, "utf8");
  for (const name of matches(body, /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z][a-z0-9_]*)/gi)) {
    const paths = ddlTableFiles.get(name) ?? [];
    paths.push(path);
    ddlTableFiles.set(name, unique(paths));
  }
  for (const name of matches(body, /\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z][a-z0-9_]*)\s*\(/gi)) {
    const paths = ddlFunctionFiles.get(name) ?? [];
    paths.push(path);
    ddlFunctionFiles.set(name, unique(paths));
  }
}

const databaseTables = baselineManifest.tables.map((table) => ({
  name: table.name,
  kind: "table",
  classification: table.classification,
  migration: table.migration ?? null,
  columns: table.columns.map((column) => ({ name: column.name, classification: column.classification, migration: column.migration ?? null })),
  constraints: table.constraints.map((constraint) => ({ name: constraint.name, classification: constraint.classification, migration: constraint.migration ?? null })),
  rls_enabled: table.rls_enabled,
}));

const rpcCallers = new Map();
for (const { path, body } of sourceBodies) {
  for (const name of matches(body, /\.rpc(?:<[^>]*>)?\(\s*["']([a-z][a-z0-9_]*)["']/gi)) {
    const callers = rpcCallers.get(name) ?? [];
    callers.push(path);
    rpcCallers.set(name, unique(callers));
  }
}
const rpcNames = unique([...baselineManifest.functions.map((entry) => entry.name), ...rpcCallers.keys()]);
const rpcs = rpcNames.map((name) => ({
  name,
  definition_files: ddlFunctionFiles.get(name) ?? ["supabase/baseline/current-schema.sql"],
  caller_files: rpcCallers.get(name) ?? [],
  caller_status: rpcCallers.has(name) ? "called-in-current-source" : "no-direct-client-or-edge-caller-found",
}));

const allFunctionNames = readdirSync(join(root, "supabase/functions"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
  .filter((entry) => {
    try { return readFileSync(join(root, "supabase/functions", entry.name, "index.ts"), "utf8").length > 0; }
    catch { return false; }
  })
  .map((entry) => entry.name)
  .sort();

const deployedFunctions = new Set(liveEvidenceManifest.parsed_claims.deployed_edge_function_names);
if (deployedFunctions.size !== liveEvidenceManifest.parsed_claims.deployed_edge_function_count) {
  throw new Error("live evidence Edge Function count does not match its unique names");
}
const deprecatedFunctions = new Set(["meta-webhook"]);
const disconnectedFunctions = new Set(["process-asset-generation-jobs"]);

const invocationCallers = new Map();
for (const { path, body } of sourceBodies) {
  for (const name of matches(body, /(?:invokeFn(?:<[\s\S]{0,500}?>)?|functions\.invoke)\(\s*["']([a-z][a-z0-9-]*)["']/gi)) {
    const callers = invocationCallers.get(name) ?? [];
    callers.push(path);
    invocationCallers.set(name, unique(callers));
  }
}
for (const name of ["generate-ad-static-asset", "generate-carousel-assets", "generate-feed-post-asset", "generate-story-assets"]) {
  invocationCallers.set(name, ["src/lib/api.ts: AI_ASSET_FUNCTIONS capability map"]);
}
invocationCallers.set("process-scheduled-publishing", ["supabase/scheduler/install_scheduled_publishing_cron.sql"]);
invocationCallers.set("collect-instagram-insights", ["live pg_cron: insights-worker (2026-07-31 evidence)"]);

const edgeFunctions = allFunctionNames.map((name) => {
  let classification = deployedFunctions.has(name) ? "deployed and used" : "local only";
  if (deprecatedFunctions.has(name)) classification = "deprecated";
  if (disconnectedFunctions.has(name)) classification = "deployed but disconnected";
  return {
    name,
    classification,
    source: `supabase/functions/${name}/index.ts`,
    callers: invocationCallers.get(name) ?? [],
    deployment_evidence: deployedFunctions.has(name)
      ? `currently live-verified at ${liveEvidenceManifest.captured_at_utc} for project ${liveEvidenceManifest.actual_linked_project_ref} by provenance-bound functions-list.json (sha256 ${evidenceHash("functions-list.json")})`
      : `not present in the provenance-bound function list captured at ${liveEvidenceManifest.captured_at_utc}`,
  };
});

const migrations = [
  ...migrationFiles.map((absolute) => ({
    version: basename(absolute).slice(0, 14),
    name: basename(absolute).slice(15, -4),
    path: relative(root, absolute),
    classification: "applied",
    evidence: `currently live-verified at ${liveEvidenceManifest.captured_at_utc} for project ${liveEvidenceManifest.actual_linked_project_ref}: 47 paired entries (migration-list sha256 ${evidenceHash("migration-list.txt")}) and up-to-date dry run (sha256 ${evidenceHash("db-push-dry-run.txt")})`,
  })),
  ...heldMigrationFiles.map((absolute) => ({
    version: basename(absolute).slice(0, 14),
    name: basename(absolute).slice(15, -4),
    path: relative(root, absolute),
    classification: "held",
    evidence: "physically outside supabase/migrations; see supabase/held-migrations/README.md",
  })),
].sort((left, right) => left.version.localeCompare(right.version));

const directRelationReferences = new Map();
for (const { path, body } of sourceBodies) {
  for (const name of matches(body, /\.from\(\s*["']([a-z][a-z0-9_]*)["']/gi)) {
    const paths = directRelationReferences.get(name) ?? [];
    paths.push(path);
    directRelationReferences.set(name, unique(paths));
  }
}

const inventory = {
  schema_version: "aa.cockpit.stage-a-inventory.v3",
  as_of: liveEvidenceManifest.captured_at_utc,
  repository: {
    name: "AttractAcq/Cockpit",
    canonical_remote: "https://github.com/AttractAcq/Cockpit.git",
    stage_a_source_baseline_commit: "7d4c1b96cdd7f3a59e28dc9826b44b1aad3b4e5e",
    stage_a_source_baseline_classification: "immutable source baseline",
    orchestrator_snapshot_commit: {
      classification: "lifecycle-pending",
      value: null,
      owner: "Programme Orchestrator",
    },
    inventory_source_identity: {
      algorithm: "sha256(path NUL exact-bytes NUL, sorted paths)",
      sha256: inventorySourceSha256,
      input_count: inventorySourcePaths.length,
      total_intended_files: intendedSnapshot.allPaths.length,
      total_fingerprinted_files: intendedSnapshot.fingerprintedPaths.length,
      exclusions: intendedSnapshot.exclusions,
      excluded_paths: intendedSnapshot.exclusions.map((entry) => entry.path),
      note: "Covers every Git-enumerated tracked or intended-untracked file except the generated inventory itself. Git metadata and ignored dependency/build/local metadata are not enumerated, so an identical-content commit does not change this fingerprint.",
    },
    production_supabase_project_ref: "xivewedajschthjlblfb",
    local_supabase_cli_project_slug: "cockpit",
    evidence_boundary: `Repository state is code-confirmed and deterministic-test-confirmed. Currently live-verified claims are limited to the read-only capture at ${liveEvidenceManifest.captured_at_utc}, bound to project ${liveEvidenceManifest.actual_linked_project_ref} by docs/evidence/stage-a-live-provenance-manifest.json. This generator validates recorded hashes but does not rerun linked commands.`,
    route: "B — formal current-state baseline replacement",
    baseline_cutover_version: baselineManifest.cutover.version,
  },
  frontend: {
    routes: [
      { path: "/login", surface: "LoginPage", status: "active" },
      { path: "/cockpit", surface: "CockpitPage", status: "active" },
      { path: "/clients", surface: "ClientsPage", status: "active" },
      { path: "/clients/:id", surface: "ClientDetailPage", status: "active" },
      { path: "/clients/:id/:section", surface: "ClientDetailPage", status: "active" },
      { path: "/website", surface: "WebsitePage", status: "active" },
      { path: "/website/:id", surface: "WebsiteClientDetailPage", status: "placeholder" },
      { path: "/operations", surface: "OperationsPage", status: "legacy-unrouted-actions-retired" },
      { path: "/settings", surface: "SettingsPage", status: "active" },
    ],
    client_tabs: [
      ["overview", "Overview", "active"], ["client_settings", "Client Settings", "active"],
      ["automations", "Automations", "placeholder"], ["pipeline", "Pipeline", "active"],
      ["context_inputs", "Context Inputs", "active"], ["context_files", "Context Files", "active"],
      ["execution_files", "Execution Files", "active"], ["proof_upload", "Proof Upload", "placeholder"],
      ["ideation", "Ideation", "active"], ["calendar", "Calendar", "active"],
      ["masters", "Content", "active"], ["content_creation", "Content Briefs", "active"],
      ["reel_studio", "Reel Studio", "active"], ["assets", "Assets", "active"],
      ["distribution", "Organic Distribution", "active"], ["paid_distribution", "Paid Distribution", "placeholder"],
      ["analytics", "Analytics", "active"], ["performance-iteration", "Performance & Iteration", "active"],
      ["archive", "Archive", "active"], ["activity", "Activity Log", "active"],
    ].map(([key, label, status]) => ({ key, label, status })),
    compatibility_routes: [
      { section: "sops", redirects_to: "execution_files" },
      { section: "analysis", redirects_to: "analytics" },
    ],
  },
  database: {
    tables: databaseTables,
    schemas: baselineManifest.schemas,
    extensions: baselineManifest.extensions,
    enums: baselineManifest.enums,
    views: [
      ...baselineManifest.views.map((view) => ({ ...view, status: "included in the canonical current-state baseline" })),
      { name: "client_phase3_status_v", status: "held / absent live; API has missing-view fallback", evidence: "supabase/held-migrations/20260717000018_client_phase3_status_view.sql" },
    ],
    materialized_views: baselineManifest.materialized_views,
    explicit_sequences: baselineManifest.explicit_sequences,
    triggers: baselineManifest.triggers,
    indexes: baselineManifest.indexes,
    policies: baselineManifest.policies,
    grants: baselineManifest.grants,
    rpcs,
    relation_references: [...directRelationReferences].sort(([left], [right]) => left.localeCompare(right)).map(([name, paths]) => ({ name, paths })),
    generated_types: { status: "absent", evidence: "No generated Supabase Database type file exists; application row/RPC shapes are maintained manually under src/types and src/lib/api.ts." },
    baseline: baselineManifest.cutover,
    externally_configured: baselineManifest.external_configuration,
    inventory_limit: "Route B deliberately does not assert exact foundation membership for snapshot objects with no later CREATE evidence. Those objects are classified unresolved while the executable current-state baseline makes fresh reconstruction operational.",
  },
  edge_functions: edgeFunctions,
  cron_jobs: [
    { name: "publish-worker", schedule: "* * * * *", target: "process-scheduled-publishing", classification: "active; live-verified 2026-07-31" },
    { name: "insights-worker", schedule: "0 * * * *", target: "collect-instagram-insights", classification: "active; live-verified 2026-07-31" },
    { name: "generation-worker", schedule: "* * * * *", target: "process-asset-generation-jobs", classification: "placeholder only; installer SQL is commented" },
  ],
  external_providers: [
    { provider: "Anthropic", capability: "text generation and analysis", paths: ["supabase/functions/_shared/anthropic.ts"], status: "active server-side adapter" },
    { provider: "OpenAI", capability: "image generation and batch image generation", paths: ["supabase/functions/_shared/ai-asset-generation.ts", "supabase/functions/_shared/ai-background-image.ts"], status: "active server-side adapter" },
    { provider: "Higgsfield", capability: "still-image and image-to-video generation", paths: ["supabase/functions/_shared/higgsfield.ts"], status: "active server-side adapter" },
    { provider: "Meta Graph API", capability: "Instagram publishing and insights", paths: ["supabase/functions/_shared/instagram-publish.ts", "supabase/functions/_shared/instagram-reels-publish.ts", "supabase/functions/collect-instagram-insights/index.ts"], status: "active organic path; paid-ad path disconnected" },
    { provider: "Resend", capability: "contractor email delivery", paths: ["supabase/functions/send-production-brief-to-contractor/index.ts"], status: "active server-side adapter" },
    { provider: "PayFast", capability: "deposit link and webhook", paths: ["supabase/functions/payfast-create-link/index.ts", "supabase/functions/payfast-webhook/index.ts"], status: `local only; absent from the deployed function list captured at ${liveEvidenceManifest.captured_at_utc} and disconnected from the current UI` },
    { provider: "Apify", capability: "lead scraping", paths: ["supabase/functions/apify-scrape/index.ts"], status: "local only; retired entity-model path" },
    { provider: "360dialog", capability: "WhatsApp delivery", paths: ["supabase/functions/dialog360-send/index.ts"], status: "local only; retired entity-model path" },
    { provider: "n8n", capability: "onboarding handoff", paths: ["supabase/functions/onboarding/index.ts", "n8n/workflows"], status: "local-only function / disconnected legacy path" },
  ],
  production_state_machines: [
    { domain: "authority review", states: ["draft", "needs_review", "approved", "rejected", "superseded"] },
    { domain: "production brief", states: ["brief", "assigned_human", "ai_ready", "producing", "produced", "failed"] },
    { domain: "asset generation job", states: ["queued", "processing", "partial", "complete", "failed", "cancelled"] },
    { domain: "distribution", states: ["ready", "scheduled", "publishing", "published", "failed", "cancelled", "needs_reconciliation"] },
    { domain: "analytics", states: ["awaiting_metrics", "metrics_partial", "complete", "failed"] },
    { domain: "ideation cycle", states: ["pending", "running", "completed", "completed_with_errors", "failed", "cancelled"] },
    { domain: "ideation proposal", states: ["generating", "draft", "needs_review", "approved", "failed", "superseded"] },
    { domain: "ideation commit", states: ["committing", "committed", "partial", "failed"] },
    { domain: "Reel Studio project", states: ["storyboarding", "generating", "editing", "review", "approved", "handed_off", "cancelled"] },
    { domain: "Reel Studio shot", states: ["pending", "still_submitted", "still_rendering", "still_complete", "submitted", "rendering", "complete", "failed"] },
    { domain: "final Reel", states: ["uploading", "uploaded", "needs_review", "approved", "rejected", "superseded", "failed"] },
  ],
  migrations,
  placeholders: [
    { surface: "client/automations", evidence: "SECTION_PLACEHOLDERS in ClientDetailPage.tsx" },
    { surface: "client/proof_upload", evidence: "SECTION_PLACEHOLDERS in ClientDetailPage.tsx" },
    { surface: "client/paid_distribution", evidence: "SECTION_PLACEHOLDERS in ClientDetailPage.tsx" },
    { surface: "website/landing_pages", evidence: "WebsiteClientDetailPage.tsx EmptyState" },
  ],
  deprecated_paths: [
    { path: "archive/edge-functions", status: "archived; excluded from deploy" },
    { path: "archive/application-code/MoneyPage.tsx", status: "archived; unrouted" },
    { path: "supabase/functions/meta-webhook", status: "deprecated source retained for deprecation contract test" },
    { path: "supabase/functions/{apify-scrape,brief-generator,dialog360-send,meta-ad-ops,mjr-generate,mrr-calc,onboarding}", status: "undeployed local-only legacy functions; no active frontend callers" },
    { path: "src/pages/{CampaignsPage,ConversationsPage,EntityPage,PipelinePage,StudioPage}.tsx", status: "unrouted legacy surfaces retained for Stage P" },
    { path: "legacy full-month generate-phase-3", status: "operational compatibility path; superseded architecture terminology, not removed" },
  ],
};

const rendered = `${JSON.stringify(inventory, null, 2)}\n`;
if (checkOnly) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== rendered) {
    console.error(`Stage A inventory is stale. Run: node ${relative(root, fileURLToPath(import.meta.url))}`);
    process.exit(1);
  }
  console.log(`Stage A inventory is current (${inventory.database.tables.length} tables, ${inventory.database.rpcs.length} RPC names, ${inventory.edge_functions.length} Edge Functions, ${inventory.migrations.length} migrations).`);
} else {
  writeFileSync(outputPath, rendered);
  console.log(`Wrote ${relative(root, outputPath)}.`);
}
