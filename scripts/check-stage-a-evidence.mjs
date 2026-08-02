import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sha256 } from "./stage-a-evidence-lib.mjs";
import {
  frozenStageASourceBaseline,
  readTestSourceBinding,
  testEvidenceEnumerationRule,
  testEvidenceSourceBindingSchema,
} from "./stage-a-test-source-binding.mjs";
import {
  assertCurrentDatabaseSourceBinding,
  databaseComponentInputPaths,
  databaseSourceBindingSchema,
  databaseSqlComponentPaths,
  expectedDatabaseComponentInputs,
  readDatabaseSourceBinding,
} from "./stage-a-database-source-binding.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const productionProjectRef = "xivewedajschthjlblfb";
const requiredLiveComponents = [
  "linked-project-discovery",
  "migration-list",
  "db-push-dry-run",
  "functions-list",
  "db-lint",
  "remote-schema",
  "cockpit-main-sha",
  "pages-config",
  "pages-deployment-workflow-api",
  "pages-main-deployment-run",
  "pages-http-response",
];
const supabaseLiveComponents = new Set(requiredLiveComponents.slice(0, 6));
const requiredDatabaseComponents = [
  "empty_application_schema", "executable_application_schema", "bootstrap_data", "post_cutover_migrations",
  "baseline_reconstruction", "baseline_catalogue", "rls", "grants", "storage", "seeds",
  "symmetric_isolation", "constraints", "foreign_keys", "uniqueness", "database_idempotency",
  "catalogue_comparison",
];
const allDatabaseComponents = ["start", ...requiredDatabaseComponents, "bootstrap", "cleanup"];
const requiredDatabaseCases = {
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

export function assertSha256(value, label) {
  assert.match(value, /^[0-9a-f]{64}$/, `${label} must be exactly 64 lowercase hexadecimal characters`);
}

function validateHashes(value, label = "manifest") {
  if (Array.isArray(value)) return value.forEach((entry, index) => validateHashes(entry, `${label}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (key.endsWith("sha256")) {
      assert.equal(typeof entry, "string", `${label}.${key} must be a string`);
      assertSha256(entry, `${label}.${key}`);
    } else validateHashes(entry, `${label}.${key}`);
  }
}

function parseUtc(value, label) {
  assert.equal(typeof value, "string", `${label} must be a UTC timestamp`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `${label} must be an ISO-8601 UTC timestamp`);
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed), `${label} is not a valid timestamp`);
  return parsed;
}

function artifactMap(manifest) {
  const map = new Map();
  for (const artifact of manifest.artifacts) {
    assert.ok(!map.has(artifact.path), `duplicate live artifact ${artifact.path}`);
    map.set(artifact.path, artifact);
  }
  return map;
}

function assertArtifactBytes(directory, artifact, label = "external artifact") {
  const path = join(directory, artifact.path);
  assert.ok(existsSync(path), `${label} ${artifact.path} is mandatory`);
  assert.equal(sha256(readFileSync(path)), artifact.sha256, `${label} ${artifact.path} hash mismatch`);
}

function validateLiveProvenance(live, provenance) {
  assert.equal(live.schema_version, "aa.cockpit.stage-a-live-evidence.v2");
  assert.equal(provenance.schema_version, "aa.cockpit.stage-a-live-provenance.v2");
  assert.equal(live.classification, "currently live-verified with timestamp and project provenance");
  assert.equal(live.expected_production_project_ref, productionProjectRef);
  assert.equal(live.actual_linked_project_ref, productionProjectRef);
  assert.equal(provenance.expected_production_project_ref, productionProjectRef);
  assert.equal(provenance.actual_linked_project_ref, productionProjectRef);
  assert.equal(provenance.linked_metadata_ref, productionProjectRef);
  assert.equal(provenance.linked_project_discovery.linked_flag, true);
  const capturedAt = parseUtc(live.captured_at_utc, "live.captured_at_utc");
  assert.equal(provenance.captured_at_utc, live.captured_at_utc);
  for (const [tool, version] of Object.entries(provenance.tool_versions)) {
    assert.ok(["supabase", "gh", "curl"].includes(tool), `unexpected live-capture tool ${tool}`);
    assert.equal(typeof version, "string");
    assert.ok(version.length > 0, `${tool} version is empty`);
  }
  for (const tool of ["supabase", "gh", "curl"]) assert.ok(provenance.tool_versions[tool], `${tool} version is required`);

  assert.deepEqual(provenance.commands.map((entry) => entry.component), requiredLiveComponents);
  for (const entry of provenance.commands) {
    assert.equal(typeof entry.command, "string", `${entry.component} exact command is missing`);
    assert.ok(entry.command.length > 0, `${entry.component} exact command is empty`);
    assert.equal(entry.expected_production_project_ref, productionProjectRef);
    const started = parseUtc(entry.started_at_utc, `${entry.component}.started_at_utc`);
    const finished = parseUtc(entry.finished_at_utc, `${entry.component}.finished_at_utc`);
    assert.ok(started <= finished, `${entry.component} timestamps are reversed`);
    assert.ok(finished <= capturedAt, `${entry.component} finished after capture timestamp`);
    assert.equal(typeof entry.tool_version, "string", `${entry.component} tool version is missing`);
    assert.ok(entry.tool_version.length > 0, `${entry.component} tool version is empty`);
    assert.equal(entry.tool_version, provenance.tool_versions[entry.tool]);
    assert.equal(entry.exit_status, 0, `${entry.component} returned nonzero`);
    for (const stream of ["stdout", "stderr", "output_artifact"]) {
      assert.equal(typeof entry[stream]?.path, "string", `${entry.component} ${stream} path is missing`);
      assertSha256(entry[stream].sha256, `${entry.component}.${stream}.sha256`);
      assert.equal(typeof entry[stream].bytes, "number", `${entry.component} ${stream} byte count is missing`);
    }
    if (supabaseLiveComponents.has(entry.component)) {
      assert.equal(entry.actual_project_ref, productionProjectRef, `${entry.component} actual project ref mismatch`);
      assert.ok(["linked", "explicit-project-ref"].includes(entry.target_mode), `${entry.component} target mode is unsafe`);
    } else {
      assert.equal(entry.target_mode, "not-applicable");
      assert.equal(entry.actual_project_ref, null);
    }
  }

  const claims = live.parsed_claims;
  assert.equal(claims.paired_migration_count, 47);
  assert.equal(claims.dry_run_up_to_date, true);
  assert.equal(claims.database_lint_error_count, 0);
  assert.equal(claims.deployed_edge_function_count, 50);
  assert.equal(new Set(claims.deployed_edge_function_names).size, 50, "captured deployed function names must be unique");
  assert.match(claims.current_main_sha, /^[0-9a-f]{40}$/);
  assert.equal(claims.pages_workflow_conclusion, "success");
  assert.equal(claims.pages_workflow_head_sha, claims.current_main_sha);
  assert.equal(claims.pages_http_status, 200);
  assert.equal(claims.pages_url, "https://attractacq.github.io/Cockpit/");
  assert.deepEqual(provenance.parsed_claims, claims);
}

export function assertCurrentSourceBinding(recorded, current, label) {
  assert.ok(recorded && typeof recorded === "object", `${label} deterministic source binding is missing`);
  assert.equal(recorded.schema_version, testEvidenceSourceBindingSchema, `${label} source-binding schema is missing or unsupported`);
  assert.equal(current.schema_version, testEvidenceSourceBindingSchema, `${label} recomputed source-binding schema is unsupported`);
  assert.equal(recorded.frozen_source_baseline_commit, frozenStageASourceBaseline, `${label} frozen source baseline differs`);
  assert.equal(recorded.enumeration_rule, testEvidenceEnumerationRule, `${label} source enumeration rule differs`);
  assert.equal(recorded.algorithm, "sha256(path NUL exact-bytes NUL, sorted paths)", `${label} source-binding algorithm differs`);
  assert.equal(recorded.sha256, current.sha256, `${label} source fingerprint differs from the current final source bytes`);
  assert.equal(recorded.path_set_sha256, current.path_set_sha256, `${label} source path set differs`);
  assert.equal(recorded.file_count, current.file_count, `${label} source file count differs`);
  assert.deepEqual(recorded.test_source_hashes, current.test_source_hashes, `${label} test-source hashes differ`);
  assert.deepEqual(recorded.package_and_workflow_hashes, current.package_and_workflow_hashes, `${label} package/workflow hashes differ`);
  assert.equal(recorded.intended_tree_fingerprint_reference, current.intended_tree_fingerprint_reference);
  assert.deepEqual(recorded.exclusions, current.exclusions);
}

export function assertDatabaseComponentEvidence(bootstrap, currentBinding, transcript) {
  assert.equal(bootstrap.database_source_binding_schema_version, databaseSourceBindingSchema, "database evidence binding schema is missing or unsupported");
  assertCurrentDatabaseSourceBinding(bootstrap.database_source_binding, currentBinding, "disposable PostgreSQL transcript");
  assert.equal(bootstrap.database_source_binding_unchanged_through_execution, true, "database binding changed during execution");
  assert.ok(
    transcript.includes(`--- database source binding JSON ---\n${JSON.stringify(bootstrap.database_source_binding, null, 2)}\n--- end database source binding JSON ---`),
    "disposable transcript does not contain its exact database source binding",
  );
  assert.deepEqual(Object.keys(bootstrap.component_evidence ?? {}), allDatabaseComponents, "database component evidence set or order differs");
  const componentInputs = databaseComponentInputPaths(currentBinding);
  for (const component of allDatabaseComponents) {
    const evidence = bootstrap.component_evidence[component];
    assert.ok(evidence && typeof evidence === "object", `database component ${component} lacks bound evidence`);
    assert.equal(evidence.exit_status, 0, `database component ${component} returned nonzero`);
    assert.equal(evidence.exit_status, bootstrap.component_exit_statuses?.[component], `database component ${component} status differs from its manifest record`);
    assert.equal(evidence.command, bootstrap.component_commands?.[component], `database component ${component} command differs from its manifest record`);
    assert.equal(typeof evidence.command, "string", `database component ${component} exact command is missing`);
    assert.ok(evidence.command.length > 0, `database component ${component} exact command is empty`);
    const expectedInputs = expectedDatabaseComponentInputs(currentBinding, component);
    assert.deepEqual(evidence.bound_inputs, expectedInputs, `database component ${component} bound inputs differ`);
    assert.ok(expectedInputs.length > 0, `database component ${component} has no bound input`);
    for (const input of evidence.bound_inputs) {
      assert.equal(currentBinding.file_hashes[input.path], input.sha256, `database component ${component} input ${input.path} is outside the binding`);
      if (!["start", "bootstrap", "cleanup"].includes(component)) {
        assert.ok(transcript.includes(`STAGE_A_COMPONENT_INPUT|${component}|${input.path}|${input.sha256}`), `database component ${component} did not record execution of ${input.path}`);
      }
    }
    const marker = `STAGE_A_BOUND_COMPONENT ${JSON.stringify({ name: component, ...evidence })}`;
    assert.ok(transcript.includes(marker), `database component ${component} exact manifest record is absent from the transcript`);
  }
  for (const [component, path] of Object.entries(databaseSqlComponentPaths)) {
    assert.ok(componentInputs[component].includes(path), `executed SQL ${path} lacks a component mapping`);
    assert.equal(bootstrap.component_evidence[component].bound_inputs.length, 1, `SQL component ${component} must bind exactly its executed file`);
  }
  assert.deepEqual(
    bootstrap.component_evidence.post_cutover_migrations.bound_inputs.slice(1).map((entry) => entry.path),
    currentBinding.applicable_post_cutover_migrations,
    "executed post-cutover migration set differs from the bound applicable set",
  );
  for (const migration of currentBinding.applicable_post_cutover_migrations) {
    assert.equal(
      bootstrap.component_evidence.post_cutover_migrations.bound_inputs.find((entry) => entry.path === migration)?.sha256,
      currentBinding.applicable_post_cutover_migration_hashes[migration],
      `applicable migration ${migration} lacks its executed hash`,
    );
  }
}

function validateFinalTestEvidence(local, options) {
  if (process.env.STAGE_A_EVIDENCE_REGENERATION === "1") return;
  assert.equal(local.schema_version, "aa.cockpit.stage-a-local-verification.v3");
  const byName = new Map(local.transcripts.map((entry) => [entry.path.split("/").at(-1), entry]));
  const required = [
    "ci-node20-runtime-transcript.txt",
    "test-stability-transcript.txt",
    "final-suite-transcript.txt",
    "read-only-suite-transcript.txt",
  ];
  for (const name of required) assert.ok(byName.has(name), `${name} is mandatory final-source evidence`);
  const current = readTestSourceBinding(root);
  for (const name of required) {
    const entry = byName.get(name);
    assertCurrentSourceBinding(entry.source_binding, current, name);
    assert.ok(parseUtc(entry.started_at_utc, `${name}.started_at_utc`) <= parseUtc(entry.finished_at_utc, `${name}.finished_at_utc`), `${name} timestamps are reversed`);
    assert.equal(entry.exit_status, 0, `${name} did not pass`);
    assert.equal(entry.raw_stdout_present, true, `${name} lacks raw stdout`);
    assert.equal(entry.raw_stderr_present, true, `${name} lacks raw stderr`);
    const transcript = readFileSync(join(root, entry.path), "utf8");
    assert.ok(transcript.includes("--- raw stdout ---"), `${name} lacks raw stdout bytes`);
    assert.ok(transcript.includes("--- raw stderr ---"), `${name} lacks raw stderr bytes`);
  }

  const ci = byName.get("ci-node20-runtime-transcript.txt");
  assert.equal(ci.runtime_image, "node:20.19.4-bookworm");
  if (options.requireFinalExecution) {
    assert.equal(ci.evidence_bootstrap_exemption, false, "final CI proof must run without the evidence-generation exemption");
  }
  for (const component of ["node_version", "npm_version", "npm_ci", "typecheck", "lint", "test", "build", "cleanup"]) {
    assert.equal(ci.component_exit_statuses[component], 0, `Node 20 CI component ${component} did not pass`);
  }
  const ciTranscript = readFileSync(join(root, ci.path), "utf8");
  assert.match(ciTranscript, /\bv20\.19\.4\b/);
  assert.match(ciTranscript, /\b10\.8\.2\b/);
  for (const command of ["npm ci", "npm run typecheck", "npm run lint", "npm test", "npm run build"]) assert.ok(ciTranscript.includes(command), `CI transcript lacks ${command}`);

  const stability = byName.get("test-stability-transcript.txt");
  assert.equal(stability.targeted_runs, 20);
  assert.equal(stability.full_suite_runs, 10);
  assert.ok(Number.isInteger(stability.full_suite_test_total) && stability.full_suite_test_total > 0, "stability test total is absent");
  const stabilityTranscript = readFileSync(join(root, stability.path), "utf8");
  assert.equal((stabilityTranscript.match(/^===== provider reliability \d+\/20 =====$/gm) ?? []).length, 20);
  assert.equal((stabilityTranscript.match(/^===== complete suite \d+\/10 =====$/gm) ?? []).length, 10);
  const fullBlocks = [...stabilityTranscript.matchAll(/^===== complete suite \d+\/10 =====$[\s\S]*?^Tests: (\d+)$[\s\S]*?^Pass: (\d+)$[\s\S]*?^Fail: (\d+)$[\s\S]*?^Skipped: (\d+)$/gm)];
  assert.equal(fullBlocks.length, 10, "ten complete-suite totals are required");
  for (const block of fullBlocks) {
    assert.equal(Number(block[1]), stability.full_suite_test_total);
    assert.equal(Number(block[2]), stability.full_suite_test_total);
    assert.equal(Number(block[3]), 0);
    assert.equal(Number(block[4]), 0);
  }

  for (const name of ["final-suite-transcript.txt", "read-only-suite-transcript.txt"]) {
    const entry = byName.get(name);
    assert.deepEqual(entry.test_totals, {
      tests: stability.full_suite_test_total,
      pass: stability.full_suite_test_total,
      fail: 0,
      skipped: 0,
    }, `${name} totals differ from repeated suite evidence`);
  }
  const readOnly = byName.get("read-only-suite-transcript.txt");
  assert.equal(readOnly.repository_write_bits, 0);
  assert.equal(readOnly.temporary_fixture_dependency, false);
  assert.equal(readOnly.residue_check.copied_repository_removed, true);
}

export function checkStageAEvidence(options = {}) {
  const live = JSON.parse(readFileSync(join(root, "docs/evidence/stage-a-live-evidence-manifest.json"), "utf8"));
  const provenanceBytes = readFileSync(join(root, "docs/evidence/stage-a-live-provenance-manifest.json"));
  const provenance = JSON.parse(provenanceBytes.toString("utf8"));
  const local = JSON.parse(readFileSync(join(root, "docs/evidence/stage-a-local-verification/verification-manifest.json"), "utf8"));
  validateHashes(live, "live");
  validateHashes(provenance, "provenance");
  validateHashes(local, "local");
  validateLiveProvenance(live, provenance);

  const artifactEntries = artifactMap(live);
  const artifacts = new Map([...artifactEntries].map(([path, entry]) => [path, entry.sha256]));
  assert.equal(sha256(provenanceBytes), live.repository_provenance_manifest.sha256);
  assert.equal(live.repository_provenance_manifest.sha256, live.provenance_manifest.sha256);
  assert.equal(artifacts.get("provenance-manifest.json"), live.provenance_manifest.sha256);
  assert.equal(artifacts.get("live-capture-transcript.txt"), live.provenance_transcript.sha256);
  for (const command of provenance.commands) {
    for (const stream of ["stdout", "stderr", "output_artifact"]) {
      assert.equal(artifacts.get(command[stream].path), command[stream].sha256, `${command.component} ${stream} is not bound to the artifact manifest`);
    }
  }

  const regenerating = process.env.STAGE_A_EVIDENCE_REGENERATION === "1";
  const selfGeneratedTestTranscripts = new Set([
    "ci-node20-runtime-transcript.txt",
    "test-stability-transcript.txt",
    "final-suite-transcript.txt",
    "read-only-suite-transcript.txt",
  ]);
  for (const entry of local.transcripts) {
    if (regenerating && selfGeneratedTestTranscripts.has(entry.path.split("/").at(-1))) continue;
    const bytes = readFileSync(join(root, entry.path));
    assert.equal(sha256(bytes), entry.sha256, `${entry.path} hash mismatch`);
    assert.equal(entry.exit_status, 0, `${entry.path} did not pass`);
  }
  validateFinalTestEvidence(local, options);

  const bootstrap = local.transcripts.find((entry) => entry.path.endsWith("/disposable-bootstrap-transcript.txt"));
  assert.ok(bootstrap, "disposable bootstrap transcript is required");
  const bootstrapTranscript = readFileSync(join(root, bootstrap.path), "utf8");
  const currentDatabaseBinding = readDatabaseSourceBinding(root);
  assertDatabaseComponentEvidence(bootstrap, currentDatabaseBinding, bootstrapTranscript);
  for (const component of allDatabaseComponents) {
    assert.equal(bootstrap.component_exit_statuses?.[component], 0, `database component ${component} lacks a successful executed status`);
  }
  for (const component of requiredDatabaseComponents) {
    assert.equal(typeof bootstrap.component_commands?.[component], "string", `database component ${component} lacks its exact command`);
    assert.ok(bootstrap.component_commands[component].length > 0, `database component ${component} has an empty command`);
  }
  assert.deepEqual(bootstrap.named_database_cases, requiredDatabaseCases, "named database cases do not match the required Stage A evidence matrix");
  for (const cases of Object.values(requiredDatabaseCases)) {
    for (const name of cases) {
      assert.ok(bootstrapTranscript.includes(`STAGE_A_CASE ${name} PASS`), `${name} lacks executed transcript evidence`);
    }
  }
  for (const command of ["node --version", "npm --version", "supabase --version", "docker --version"]) {
    assert.equal(bootstrap.tool_versions?.[command]?.exit_status, 0, `${command} version was not recorded successfully`);
    assert.ok(bootstrap.tool_versions[command].version.length > 0, `${command} version is empty`);
  }

  const summary = readFileSync(join(root, "docs/evidence/STAGE_A_LIVE_VERIFICATION_SUMMARY.md"), "utf8");
  for (const path of ["migration-list.txt", "db-push-dry-run.txt", "functions-list.json", "remote-schema.sql"]) {
    assert.ok(summary.includes(artifacts.get(path)), `${path} hash is not reconciled in the live summary`);
  }
  const inventory = readFileSync(join(root, "docs/stage-a-current-state-inventory.json"), "utf8");
  validateHashes(JSON.parse(inventory), "inventory");
  for (const path of ["migration-list.txt", "db-push-dry-run.txt", "functions-list.json"]) {
    assert.ok(inventory.includes(artifacts.get(path)), `${path} hash is not reconciled in the inventory`);
  }
  const baseline = JSON.parse(readFileSync(join(root, "supabase/baseline/manifest.json"), "utf8"));
  validateHashes(baseline, "baseline");
  assert.equal(baseline.authority.external_snapshot_sha256, artifacts.get("remote-schema.sql"));
  const report = readFileSync(join(root, "docs/STAGE_A_IMPLEMENTATION_REPORT.md"), "utf8");
  assert.ok(report.includes("docs/evidence/stage-a-local-verification/verification-manifest.json"), "implementation report must reference the local verification manifest rather than recursively copying its hashes");
  assert.ok(report.includes("docs/evidence/stage-a-live-provenance-manifest.json"), "implementation report must reference the provenance-bound live manifest");
  for (const cases of Object.values(requiredDatabaseCases)) {
    for (const name of cases) assert.ok(report.includes(name), `${name} is missing from the implementation report evidence matrix`);
  }

  if (options.externalDirectory) {
    for (const artifact of live.artifacts) {
      assertArtifactBytes(options.externalDirectory, artifact);
    }
    const externalProvenance = readFileSync(join(options.externalDirectory, live.provenance_manifest.path));
    assert.equal(sha256(externalProvenance), live.provenance_manifest.sha256, "external provenance manifest hash mismatch");
    assert.equal(
      sha256(readFileSync(join(options.externalDirectory, "evidence-sha256.txt"))),
      live.external_bundle_manifest_sha256,
      "external evidence manifest hash mismatch",
    );
    const checksumLines = readFileSync(join(options.externalDirectory, "evidence-sha256.txt"), "utf8").trim().split("\n");
    const checksumMap = new Map(checksumLines.map((line) => {
      const match = line.match(/^([0-9a-f]{64}) {2}(.+)$/);
      assert.ok(match, `malformed external checksum line: ${line}`);
      return [match[2], match[1]];
    }));
    for (const artifact of live.artifacts) assert.equal(checksumMap.get(artifact.path), artifact.sha256, `${artifact.path} is missing from evidence-sha256.txt`);

    const migrationOutput = readFileSync(join(options.externalDirectory, "migration-list.txt"), "utf8");
    assert.equal([...migrationOutput.matchAll(/^\s*\d{14}\s+\|\s+\d{14}\s+\|/gm)].length, 47, "migration list does not contain 47 paired rows");
    assert.match(readFileSync(join(options.externalDirectory, "db-push-dry-run.txt"), "utf8"), /Remote database is up to date\./);
    const functions = JSON.parse(readFileSync(join(options.externalDirectory, "functions-list.json"), "utf8"));
    assert.equal(functions.length, 50);
    assert.deepEqual([...new Set(functions.map((entry) => entry.name))].sort(), live.parsed_claims.deployed_edge_function_names);
    assert.equal(readFileSync(join(options.externalDirectory, "db-lint.txt"), "utf8"), "");
    assert.equal(sha256(readFileSync(join(options.externalDirectory, "remote-schema.sql"))), artifacts.get("remote-schema.sql"));
    const pagesRun = JSON.parse(readFileSync(join(options.externalDirectory, "pages-main-deployment-run.json"), "utf8"));
    assert.equal(pagesRun[0].conclusion, "success");
    assert.equal(pagesRun[0].headSha, live.parsed_claims.current_main_sha);
    const pagesResponse = JSON.parse(readFileSync(join(options.externalDirectory, "pages-http-response.json"), "utf8"));
    assert.equal(pagesResponse.http_code, 200);
    assert.equal(pagesResponse.url_effective, live.parsed_claims.pages_url);
    const transcript = readFileSync(join(options.externalDirectory, "live-capture-transcript.txt"), "utf8");
    for (const command of provenance.commands) {
      assert.ok(transcript.includes(command.command), `${command.component} exact command is absent from the raw transcript`);
      assert.ok(transcript.includes(command.actual_project_ref ?? "not-applicable"), `${command.component} target binding is absent from the raw transcript`);
    }
  }
  return { liveArtifacts: live.artifacts.length, transcripts: local.transcripts.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const externalIndex = process.argv.indexOf("--external-dir");
  const externalDirectory = externalIndex >= 0 ? process.argv[externalIndex + 1] : undefined;
  const result = checkStageAEvidence({ externalDirectory, requireFinalExecution: true });
  console.log(`Stage A evidence validation passed (${result.liveArtifacts} trusted live artifacts; ${result.transcripts} exact local transcript hashes).`);
}
