import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  renderCommand,
  root,
  runCommand,
  writeTranscript,
} from "./stage-a-evidence-lib.mjs";
import {
  databaseSourceBindingSchema,
  expectedDatabaseComponentInputs,
  readDatabaseSourceBinding,
} from "./stage-a-database-source-binding.mjs";

const mode = process.argv[2];
const productionRef = "xivewedajschthjlblfb";

function toolVersions() {
  return [
    runCommand("node", ["--version"]),
    runCommand("npm", ["--version"]),
    runCommand("supabase", ["--version"]),
    runCommand("docker", ["--version"]),
  ];
}

function versionsBlock(versions) {
  return ["Relevant tool versions", ...versions.map((result) => `${result.command}: ${result.output.trim()} (exit ${result.exitStatus})`)].join("\n");
}

function versionManifest(versions) {
  return Object.fromEntries(versions.map((result) => [result.command, {
    version: result.output.trim(),
    exit_status: result.exitStatus,
  }]));
}

const requiredDatabaseComponents = [
  "empty_application_schema",
  "executable_application_schema",
  "bootstrap_data",
  "post_cutover_migrations",
  "baseline_reconstruction",
  "baseline_catalogue",
  "rls",
  "grants",
  "storage",
  "seeds",
  "symmetric_isolation",
  "constraints",
  "foreign_keys",
  "uniqueness",
  "database_idempotency",
  "catalogue_comparison",
];

const namedDatabaseCases = {
  symmetric_isolation: [
    "isolation.client_one_sees_own_exact_record",
    "isolation.client_one_cannot_see_client_two",
    "isolation.client_two_sees_own_exact_record",
    "isolation.client_two_cannot_see_client_one",
  ],
  constraints: [
    "constraints.clients_name_not_null_rejects_null",
    "constraints.clients_health_score_check_rejects_101",
    "constraints.organic_content_type_check_rejects_video",
    "constraints.client_status_domain_rejects_unknown_state",
    "constraints.valid_control_row_is_accepted",
  ],
  foreign_keys: [
    "foreign_keys.organic_valid_client_parent_is_accepted",
    "foreign_keys.organic_nonexistent_client_is_rejected",
    "foreign_keys.organic_client_delete_cascades",
    "foreign_keys.organic_client_update_no_action_rejects",
  ],
  uniqueness: [
    "uniqueness.clients_slug_first_and_distinct_are_accepted",
    "uniqueness.clients_slug_duplicate_is_rejected",
    "uniqueness.organic_same_client_ref_duplicate_is_rejected",
    "uniqueness.organic_same_ref_for_different_clients_is_accepted",
    "uniqueness.organic_distinct_ref_for_same_client_is_accepted",
  ],
  database_idempotency: [
    "idempotency.begin_ideation_run_first_request_creates_one_cycle_seven_runs_one_event",
    "idempotency.begin_ideation_run_exact_replay_creates_no_duplicates",
    "idempotency.begin_ideation_run_exact_replay_returns_same_cycle_and_lease",
    "idempotency.begin_ideation_run_conflicting_hash_reuse_fails_closed",
  ],
};

function parseDatabaseComponentEvidence(output) {
  const statuses = {};
  const commands = {};
  const inputs = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^STAGE_A_COMPONENT_EXIT\|([^|]+)\|(\d+)\|(.+)$/);
    if (match) {
      if (match[1] in statuses) throw new Error(`duplicate database component status: ${match[1]}`);
      statuses[match[1]] = Number(match[2]);
      commands[match[1]] = match[3];
      continue;
    }
    const input = line.match(/^STAGE_A_COMPONENT_INPUT\|([^|]+)\|([^|]+)\|([0-9a-f]{64})$/);
    if (input) (inputs[input[1]] ??= []).push({ path: input[2], sha256: input[3] });
  }
  return { statuses, commands, inputs };
}

if (mode === "build") {
  const versions = toolVersions();
  const result = runCommand("npm", ["run", "build"]);
  const body = [
    "Stage A production build execution evidence",
    "Classification: locally rebuilt and verified",
    versionsBlock(versions),
    "",
    renderCommand(result),
  ].join("\n");
  const entry = writeTranscript("build-transcript.txt", body, {
    command: result.command,
    started_at_utc: result.startedAt,
    finished_at_utc: result.finishedAt,
    exit_status: result.exitStatus,
    claims: ["production build"],
  });
  console.log(`Preserved ${entry.path} (sha256 ${entry.sha256}, exit ${entry.exit_status}).`);
  process.exit(result.exitStatus);
}

if (mode === "bootstrap") {
  for (const name of ["SUPABASE_PROJECT_REF", "PROJECT_REF", "STAGE_A_PROJECT_REF"]) {
    if (process.env[name] === productionRef) throw new Error(`Refusing local evidence run: ${name} names production`);
  }
  const linkedRefPath = join(root, "supabase", ".temp", "project-ref");
  if (existsSync(linkedRefPath) && readFileSync(linkedRefPath, "utf8").trim() === productionRef) {
    throw new Error("Refusing local evidence run: worktree link metadata names production");
  }

  const databaseBinding = readDatabaseSourceBinding(root);
  const versions = toolVersions();
  // Only PostgreSQL is required for this database reconstruction. Supabase's
  // DB initialization still installs its owned auth/storage schemas and roles;
  // excluding network/UI/runtime services avoids unrelated container health
  // from deciding a schema evidence gate.
  const excludedServices = "edge-runtime,gotrue,imgproxy,kong,logflare,mailpit,postgres-meta,postgrest,realtime,storage-api,studio,supavisor,vector";
  // Docker Desktop 4.82 can leave the first container at `created` while this
  // CLI version waits for its start API call. Starting that exact, fixed local
  // container is idempotent and lets the CLI retain ownership of all schema
  // initialization and health checks.
  const startupScript = [
    "set -euo pipefail",
    `supabase start --exclude "${excludedServices}" &`,
    "cli_pid=$!",
    "container_started=0",
    "for attempt in {1..120}; do",
    "  state=$(docker inspect --format '{{.State.Status}}' supabase_db_cockpit 2>/dev/null || true)",
    "  if [[ \"$state\" == \"created\" ]]; then docker start supabase_db_cockpit; container_started=1; break; fi",
    "  if [[ \"$state\" == \"running\" ]]; then container_started=1; break; fi",
    "  sleep 1",
    "done",
    "if [[ \"$container_started\" != \"1\" ]]; then kill \"$cli_pid\" 2>/dev/null || true; wait \"$cli_pid\" 2>/dev/null || true; exit 1; fi",
    "database_healthy=0",
    "for attempt in {1..120}; do",
    "  health=$(docker inspect --format '{{.State.Health.Status}}' supabase_db_cockpit 2>/dev/null || true)",
    "  if [[ \"$health\" == \"healthy\" ]]; then database_healthy=1; break; fi",
    "  sleep 1",
    "done",
    "platform_schema_ready=0",
    "for attempt in {1..120}; do",
    "  ready=$(docker exec supabase_db_cockpit psql -X -U postgres -d postgres -Atqc \"select (to_regclass('storage.objects') is not null and to_regclass('auth.users') is not null and exists (select 1 from pg_roles where rolname='service_role'))::int\" 2>/dev/null || true)",
    "  if [[ \"$ready\" == \"1\" ]]; then platform_schema_ready=1; break; fi",
    "  sleep 1",
    "done",
    "pkill -KILL -P \"$cli_pid\" 2>/dev/null || true",
    "kill -KILL \"$cli_pid\" 2>/dev/null || true",
    "wait \"$cli_pid\" 2>/dev/null || true",
    "[[ \"$database_healthy\" == \"1\" ]]",
    "[[ \"$platform_schema_ready\" == \"1\" ]]",
    "[[ \"$(docker inspect --format '{{.State.Running}}' supabase_db_cockpit)\" == \"true\" ]]",
    "printf 'Disposable database container is healthy; auxiliary Supabase services were intentionally excluded.\\n'",
  ].join("\n");
  const start = runCommand("bash", ["-c", startupScript], { timeout: 300_000 });
  const startDisplayCommand = `bash -c ${JSON.stringify(startupScript)}`;
  let bootstrap = null;
  if (start.exitStatus === 0) {
    bootstrap = runCommand("bash", ["scripts/bootstrap-disposable-supabase.sh"], {
      env: {
        ...process.env,
        STAGE_A_DISPOSABLE_CONFIRM: "reset-local-cockpit-disposable",
        STAGE_A_EXPECTED_DATABASE_BINDING_SHA256: databaseBinding.sha256,
        STAGE_A_EXPECTED_POST_CUTOVER_MIGRATIONS: databaseBinding.applicable_post_cutover_migrations.join("\n"),
      },
    });
  }
  const cleanup = runCommand("supabase", ["stop", "--no-backup"]);
  const bootstrapStatus = bootstrap?.exitStatus ?? 1;
  const parsedComponents = parseDatabaseComponentEvidence(bootstrap?.output ?? "");
  const missingDatabaseComponents = requiredDatabaseComponents.filter((name) => !(name in parsedComponents.statuses));
  const failedDatabaseComponents = requiredDatabaseComponents.filter((name) => parsedComponents.statuses[name] !== 0);
  const databaseBindingAfter = readDatabaseSourceBinding(root);
  const databaseBindingStatus = databaseBindingAfter.sha256 === databaseBinding.sha256 ? 0 : 1;
  const componentOrder = ["start", ...requiredDatabaseComponents, "bootstrap", "cleanup"];
  const componentCommands = {
    start: startDisplayCommand,
    ...parsedComponents.commands,
    bootstrap: "STAGE_A_DISPOSABLE_CONFIRM=reset-local-cockpit-disposable bash scripts/bootstrap-disposable-supabase.sh",
    cleanup: cleanup.command,
  };
  const componentStatuses = {
    start: start.exitStatus,
    ...Object.fromEntries(requiredDatabaseComponents.map((name) => [name, parsedComponents.statuses[name] ?? null])),
    bootstrap: bootstrap?.exitStatus ?? null,
    cleanup: cleanup.exitStatus,
  };
  const componentEvidence = Object.fromEntries(componentOrder.map((name) => [name, {
    command: componentCommands[name] ?? null,
    bound_inputs: ["start", "bootstrap", "cleanup"].includes(name)
      ? expectedDatabaseComponentInputs(databaseBinding, name)
      : (parsedComponents.inputs[name] ?? []),
    exit_status: componentStatuses[name],
  }]));
  let componentBindingStatus = 0;
  for (const name of componentOrder) {
    const expected = expectedDatabaseComponentInputs(databaseBinding, name);
    if (JSON.stringify(componentEvidence[name].bound_inputs) !== JSON.stringify(expected)) componentBindingStatus = 1;
    if (!componentEvidence[name].command || componentEvidence[name].exit_status !== 0) componentBindingStatus = 1;
  }
  const componentEvidenceStatus = missingDatabaseComponents.length === 0 && failedDatabaseComponents.length === 0 && componentBindingStatus === 0 ? 0 : 1;
  const overallStatus = start.exitStatus || bootstrapStatus || componentEvidenceStatus || databaseBindingStatus || cleanup.exitStatus;
  const migrationIdentities = databaseBinding.applicable_post_cutover_migrations.map((path) => `${path}=${databaseBinding.applicable_post_cutover_migration_hashes[path]}`);
  const componentEvidenceLines = componentOrder.map((name) => `STAGE_A_BOUND_COMPONENT ${JSON.stringify({ name, ...componentEvidence[name] })}`);
  const body = [
    "Stage A disposable Route B reconstruction execution evidence",
    "Classification: locally rebuilt and verified",
    "Safety boundary: fixed local project slug cockpit; production ref rejected before startup and again by the bootstrap; no linked command is accepted.",
    `Database source-binding schema: ${databaseBinding.schema_version}`,
    `Frozen source baseline: ${databaseBinding.frozen_source_baseline_commit}`,
    `Database input path-set SHA-256: ${databaseBinding.path_set_sha256}`,
    `Database input aggregate SHA-256: ${databaseBinding.sha256}`,
    `Database input file count: ${databaseBinding.file_count}`,
    `Executable application schema SHA-256: ${databaseBinding.executable_application_schema_sha256}`,
    `Captured authority SHA-256: ${databaseBinding.captured_authority_sha256}`,
    `Baseline manifest SHA-256: ${databaseBinding.baseline_manifest_sha256}`,
    `Supabase configuration SHA-256: ${databaseBinding.supabase_configuration_sha256}`,
    `Applicable post-cutover migration count: ${databaseBinding.applicable_post_cutover_migrations.length}`,
    `Applicable post-cutover migration identities: ${migrationIdentities.length ? migrationIdentities.join(", ") : "none"}`,
    "Timestamps record execution provenance only; filesystem times do not participate in database evidence validity.",
    "--- database source binding JSON ---",
    JSON.stringify(databaseBinding, null, 2),
    "--- end database source binding JSON ---",
    versionsBlock(versions),
    "",
    renderCommand(start, startDisplayCommand),
    "",
    bootstrap
      ? renderCommand(bootstrap, "STAGE_A_DISPOSABLE_CONFIRM=reset-local-cockpit-disposable bash scripts/bootstrap-disposable-supabase.sh")
      : "Bootstrap command not invoked because local stack startup failed.\nExit status: not run",
    "",
    renderCommand(cleanup),
    "",
    `Required database components: ${requiredDatabaseComponents.join(", ")}`,
    `Missing database components: ${missingDatabaseComponents.length === 0 ? "none" : missingDatabaseComponents.join(", ")}`,
    `Failed database components: ${failedDatabaseComponents.length === 0 ? "none" : failedDatabaseComponents.join(", ")}`,
    `Database binding unchanged through execution: ${databaseBindingStatus === 0}`,
    `Every component input matches the pre-execution binding: ${componentBindingStatus === 0}`,
    ...componentEvidenceLines,
    "",
    `Overall exit status: ${overallStatus}`,
  ].join("\n");
  const entry = writeTranscript("disposable-bootstrap-transcript.txt", body, {
    command: `${startDisplayCommand}; STAGE_A_DISPOSABLE_CONFIRM=reset-local-cockpit-disposable bash scripts/bootstrap-disposable-supabase.sh; supabase stop --no-backup`,
    started_at_utc: start.startedAt,
    finished_at_utc: cleanup.finishedAt,
    exit_status: overallStatus,
    tool_versions: versionManifest(versions),
    database_source_binding: databaseBinding,
    database_source_binding_schema_version: databaseSourceBindingSchema,
    database_source_binding_unchanged_through_execution: databaseBindingStatus === 0,
    component_exit_statuses: componentStatuses,
    component_commands: componentCommands,
    component_evidence: componentEvidence,
    named_database_cases: namedDatabaseCases,
    claims: [
      "disposable baseline reconstruction",
      "recorded identifier catalogue comparison",
      "RLS flags/policy count and representative six-RPC grant verification",
      "symmetric two-client isolation verification",
      "representative constraint behavior verification",
      "representative foreign-key behavior verification",
      "representative uniqueness behavior verification",
      "begin_ideation_run database idempotency verification",
      "disposable stack cleanup",
    ],
  });
  console.log(`Preserved ${entry.path} (sha256 ${entry.sha256}, exit ${entry.exit_status}).`);
  process.exit(overallStatus);
}

throw new Error("Usage: node scripts/run-stage-a-local-evidence.mjs build|bootstrap");
