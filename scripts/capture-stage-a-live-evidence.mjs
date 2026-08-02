import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const linkedCheckout = "/Users/alex/Desktop/Attract Acq/Application Surfaces/Cockpit";
const externalDirectory = "/Users/alex/Desktop/Cockpit Stage A Live Evidence";
const expectedRef = "xivewedajschthjlblfb";
const pagesUrl = "https://attractacq.github.io/Cockpit/";
const repository = "AttractAcq/Cockpit";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sanitize(value) {
  return String(value ?? "")
    .replace(/\bpostgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, "[REDACTED_JWT]")
    .replace(/\b(?:sbp_|sb_secret_|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TOKEN]")
    .replace(/"host"\s*:\s*"[^"]+"/g, '"host": "[REDACTED_DATABASE_HOST]"')
    .replace(/[ \t]+$/gm, "");
}

function exactCommand(command, args) {
  return [command, ...args.map((arg) => JSON.stringify(arg))].join(" ");
}

function run(command, args, cwd = linkedCheckout) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  return {
    command: exactCommand(command, args),
    started_at_utc: startedAt,
    finished_at_utc: new Date().toISOString(),
    exit_status: result.status ?? 1,
    stdout: sanitize(result.stdout),
    stderr: sanitize(`${result.stderr ?? ""}${result.error ? `\n${result.error}` : ""}`),
  };
}

function requireSuccess(result, component) {
  if (result.exit_status !== 0) throw new Error(`${component} failed with exit ${result.exit_status}: ${result.stderr}`);
}

function writeArtifact(path, bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes), "utf8");
  writeFileSync(join(externalDirectory, path), body);
  return { path, sha256: sha256(body), bytes: body.length };
}

mkdirSync(externalDirectory, { recursive: true });
const linkMetadataPath = join(linkedCheckout, "supabase/.temp/project-ref");
const metadataRef = readFileSync(linkMetadataPath, "utf8").trim();
if (metadataRef !== expectedRef) throw new Error(`linked checkout metadata targets ${metadataRef}, expected ${expectedRef}`);

const versionResults = {
  supabase: run("supabase", ["--version"]),
  gh: run("gh", ["--version"]),
  curl: run("curl", ["--version"]),
};
for (const [tool, result] of Object.entries(versionResults)) requireSuccess(result, `${tool} version`);
const toolVersions = Object.fromEntries(Object.entries(versionResults).map(([tool, result]) => [tool, result.stdout.trim().split("\n")[0]]));

const discovery = run("supabase", ["projects", "list", "--output", "json"]);
requireSuccess(discovery, "linked project discovery");
let discoveredProjects;
try { discoveredProjects = JSON.parse(discovery.stdout); } catch (error) { throw new Error("Supabase project discovery did not return JSON", { cause: error }); }
const linkedProjects = discoveredProjects.filter((project) => project.linked === true);
if (linkedProjects.length !== 1 || linkedProjects[0].ref !== expectedRef) {
  throw new Error(`Supabase CLI linked project mismatch: ${JSON.stringify(linkedProjects.map((project) => project.ref))}`);
}
const actualLinkedRef = linkedProjects[0].ref;

const captures = [];
function capture({ name, command, args, tool, targetMode, artifactPath, transform, cwd = linkedCheckout }) {
  const result = run(command, args, cwd);
  const stdoutArtifact = writeArtifact(`${name}.stdout.txt`, result.stdout);
  const stderrArtifact = writeArtifact(`${name}.stderr.txt`, result.stderr);
  requireSuccess(result, name);
  const output = transform ? transform(result.stdout) : result.stdout;
  const artifact = artifactPath ? writeArtifact(artifactPath, output) : stdoutArtifact;
  const record = {
    component: name,
    command: result.command,
    expected_production_project_ref: expectedRef,
    target_mode: targetMode,
    actual_project_ref: targetMode === "not-applicable" ? null : actualLinkedRef,
    started_at_utc: result.started_at_utc,
    finished_at_utc: result.finished_at_utc,
    tool,
    tool_version: toolVersions[tool],
    exit_status: result.exit_status,
    stdout: stdoutArtifact,
    stderr: stderrArtifact,
    output_artifact: artifact,
  };
  captures.push(record);
  return { result, record, output };
}

const discoveryStdout = writeArtifact("linked-project-discovery.stdout.txt", discovery.stdout);
const discoveryStderr = writeArtifact("linked-project-discovery.stderr.txt", discovery.stderr);
captures.push({
  component: "linked-project-discovery",
  command: discovery.command,
  expected_production_project_ref: expectedRef,
  target_mode: "linked",
  actual_project_ref: actualLinkedRef,
  linked_metadata_ref: metadataRef,
  linked_project_flag: true,
  started_at_utc: discovery.started_at_utc,
  finished_at_utc: discovery.finished_at_utc,
  tool: "supabase",
  tool_version: toolVersions.supabase,
  exit_status: discovery.exit_status,
  stdout: discoveryStdout,
  stderr: discoveryStderr,
  output_artifact: writeArtifact("linked-project.json", `${JSON.stringify(linkedProjects[0], null, 2)}\n`),
});

capture({ name: "migration-list", command: "supabase", args: ["migration", "list", "--linked"], tool: "supabase", targetMode: "linked", artifactPath: "migration-list.txt" });
capture({ name: "db-push-dry-run", command: "supabase", args: ["db", "push", "--linked", "--dry-run"], tool: "supabase", targetMode: "linked", artifactPath: "db-push-dry-run.txt" });
capture({ name: "functions-list", command: "supabase", args: ["functions", "list", "--project-ref", expectedRef, "--output", "json"], tool: "supabase", targetMode: "explicit-project-ref", artifactPath: "functions-list.json" });
capture({ name: "db-lint", command: "supabase", args: ["db", "lint", "--linked", "--level", "error"], tool: "supabase", targetMode: "linked", artifactPath: "db-lint.txt" });

const schemaTemp = join(externalDirectory, ".remote-schema.tmp.sql");
rmSync(schemaTemp, { force: true });
const schemaResult = run("supabase", ["db", "dump", "--linked", "--schema", "public,extensions", "--file", schemaTemp]);
const schemaStdout = writeArtifact("remote-schema.stdout.txt", schemaResult.stdout);
const schemaStderr = writeArtifact("remote-schema.stderr.txt", schemaResult.stderr);
requireSuccess(schemaResult, "remote-schema");
const schemaBytes = readFileSync(schemaTemp);
rmSync(schemaTemp, { force: true });
const schemaArtifact = writeArtifact("remote-schema.sql", schemaBytes);
captures.push({
  component: "remote-schema", command: schemaResult.command,
  expected_production_project_ref: expectedRef, target_mode: "linked", actual_project_ref: actualLinkedRef,
  started_at_utc: schemaResult.started_at_utc, finished_at_utc: schemaResult.finished_at_utc,
  tool: "supabase", tool_version: toolVersions.supabase, exit_status: schemaResult.exit_status,
  stdout: schemaStdout, stderr: schemaStderr, output_artifact: schemaArtifact,
});

const mainSha = capture({ name: "cockpit-main-sha", command: "gh", args: ["api", `repos/${repository}/commits/main`, "--jq", ".sha"], tool: "gh", targetMode: "not-applicable", artifactPath: "cockpit-main-sha.txt", cwd: repositoryRoot });
capture({ name: "pages-config", command: "gh", args: ["api", `repos/${repository}/pages`], tool: "gh", targetMode: "not-applicable", artifactPath: "pages-config.json", cwd: repositoryRoot });
const workflow = capture({
  name: "pages-deployment-workflow-api", command: "gh",
  args: ["api", "--method", "GET", `repos/${repository}/contents/.github/workflows/deploy.yml`, "-f", "ref=main"],
  tool: "gh", targetMode: "not-applicable", artifactPath: "pages-deployment-workflow-api.json", cwd: repositoryRoot,
});
let workflowJson;
try { workflowJson = JSON.parse(workflow.output); } catch (error) { throw new Error("Pages workflow API output was not JSON", { cause: error }); }
writeArtifact("pages-deployment-workflow.yml", Buffer.from(String(workflowJson.content).replace(/\n/g, ""), "base64"));
const pagesRun = capture({
  name: "pages-main-deployment-run", command: "gh",
  args: ["run", "list", "--repo", repository, "--workflow", "deploy.yml", "--branch", "main", "--status", "success", "--limit", "1", "--json", "databaseId,headSha,status,conclusion,createdAt,updatedAt,url,workflowName,event"],
  tool: "gh", targetMode: "not-applicable", artifactPath: "pages-main-deployment-run.json", cwd: repositoryRoot,
});
const pagesResponse = capture({
  name: "pages-http-response", command: "curl",
  args: ["-sS", "-o", "/dev/null", "-w", '{"http_code":%{http_code},"url_effective":"%{url_effective}","remote_ip":"%{remote_ip}"}\n', pagesUrl],
  tool: "curl", targetMode: "not-applicable", artifactPath: "pages-http-response.json", cwd: repositoryRoot,
});

const mainShaValue = mainSha.output.trim();
const runRows = JSON.parse(pagesRun.output);
if (!/^[0-9a-f]{40}$/.test(mainShaValue)) throw new Error("GitHub main SHA is malformed");
if (!Array.isArray(runRows) || runRows.length !== 1 || runRows[0].conclusion !== "success" || runRows[0].headSha !== mainShaValue) {
  throw new Error("latest successful Pages workflow is not bound to current main");
}
const pagesHttp = JSON.parse(pagesResponse.output);
if (pagesHttp.http_code !== 200 || pagesHttp.url_effective !== pagesUrl) throw new Error(`Pages HTTP verification failed: ${pagesResponse.output}`);

const functionRows = JSON.parse(readFileSync(join(externalDirectory, "functions-list.json"), "utf8"));
const functionNames = functionRows.map((row) => row.name).sort();
if (functionNames.length === 0 || new Set(functionNames).size !== functionNames.length) throw new Error("deployed function list is empty or duplicated");
const migrationOutput = readFileSync(join(externalDirectory, "migration-list.txt"), "utf8");
const pairedMigrationRows = migrationOutput.split("\n").filter((line) => /^\s*\d{14}\s+\|\s+\d{14}/.test(line)).length;
if (pairedMigrationRows !== 47) throw new Error(`expected 47 paired migrations, parsed ${pairedMigrationRows}`);
if (!/Remote database is up to date\./.test(readFileSync(join(externalDirectory, "db-push-dry-run.txt"), "utf8"))) throw new Error("linked dry run did not report up to date");
if (readFileSync(join(externalDirectory, "db-lint.txt"), "utf8").trim() !== "") throw new Error("database lint produced error-level findings");

const transcriptLines = [
  "Stage A fresh read-only live capture",
  `Expected production project ref: ${expectedRef}`,
  `Actual linked project ref: ${actualLinkedRef}`,
  `Linked checkout: ${linkedCheckout}`,
  `Supabase CLI linked flag: true`,
  "Safety: read-only list/lint/dump/API/HTTP commands plus db push --dry-run; no write command is present.",
];
for (const record of captures) {
  transcriptLines.push(
    "",
    `Component: ${record.component}`,
    `Command: ${record.command}`,
    `Target mode: ${record.target_mode}`,
    `Expected project ref: ${record.expected_production_project_ref}`,
    `Actual project ref: ${record.actual_project_ref ?? "not-applicable"}`,
    `Tool version: ${record.tool_version}`,
    `UTC start: ${record.started_at_utc}`,
    "--- stdout ---",
    readFileSync(join(externalDirectory, record.stdout.path), "utf8").trimEnd(),
    "--- stderr ---",
    readFileSync(join(externalDirectory, record.stderr.path), "utf8").trimEnd(),
    `Exit status: ${record.exit_status}`,
    `Output artifact: ${record.output_artifact.path}`,
    `Output SHA-256: ${record.output_artifact.sha256}`,
    `UTC finish: ${record.finished_at_utc}`,
  );
}
const transcript = writeArtifact("live-capture-transcript.txt", `${transcriptLines.join("\n")}\n`);
const capturedAt = captures.reduce((latest, record) => record.finished_at_utc > latest ? record.finished_at_utc : latest, captures[0].finished_at_utc);
const provenance = {
  schema_version: "aa.cockpit.stage-a-live-provenance.v2",
  classification: "currently live-verified with timestamp and project provenance",
  expected_production_project_ref: expectedRef,
  actual_linked_project_ref: actualLinkedRef,
  linked_checkout: linkedCheckout,
  linked_metadata_ref: metadataRef,
  linked_project_discovery: { command: discovery.command, linked_flag: true },
  captured_at_utc: capturedAt,
  tool_versions: toolVersions,
  commands: captures,
  parsed_claims: {
    paired_migration_count: pairedMigrationRows,
    dry_run_up_to_date: true,
    database_lint_error_count: 0,
    deployed_edge_function_count: functionNames.length,
    deployed_edge_function_names: functionNames,
    current_main_sha: mainShaValue,
    pages_workflow_conclusion: runRows[0].conclusion,
    pages_workflow_head_sha: runRows[0].headSha,
    pages_http_status: pagesHttp.http_code,
    pages_url: pagesHttp.url_effective,
  },
  transcript,
};
const provenanceArtifact = writeArtifact("provenance-manifest.json", `${JSON.stringify(provenance, null, 2)}\n`);
const repositoryProvenancePath = join(repositoryRoot, "docs/evidence/stage-a-live-provenance-manifest.json");
writeFileSync(repositoryProvenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

const externalFiles = captures.flatMap((record) => [record.stdout.path, record.stderr.path, record.output_artifact.path])
  .concat(["pages-deployment-workflow.yml", transcript.path, provenanceArtifact.path]);
const uniqueFiles = [...new Set(externalFiles)].sort();
const hashLines = uniqueFiles.map((path) => `${sha256(readFileSync(join(externalDirectory, path)))}  ${path}`);
const bundleHashArtifact = writeArtifact("evidence-sha256.txt", `${hashLines.join("\n")}\n`);

const liveManifest = {
  schema_version: "aa.cockpit.stage-a-live-evidence.v2",
  classification: "currently live-verified with timestamp and project provenance",
  captured_at_utc: capturedAt,
  expected_production_project_ref: expectedRef,
  actual_linked_project_ref: actualLinkedRef,
  provenance_manifest: provenanceArtifact,
  repository_provenance_manifest: {
    path: relative(repositoryRoot, repositoryProvenancePath),
    sha256: provenanceArtifact.sha256,
  },
  provenance_transcript: transcript,
  external_bundle_manifest_sha256: bundleHashArtifact.sha256,
  artifacts: uniqueFiles.map((path) => ({ path, sha256: sha256(readFileSync(join(externalDirectory, path))) })),
  parsed_claims: provenance.parsed_claims,
};
writeFileSync(join(repositoryRoot, "docs/evidence/stage-a-live-evidence-manifest.json"), `${JSON.stringify(liveManifest, null, 2)}\n`);
console.log(`Fresh live capture complete at ${capturedAt}.`);
console.log(`Project binding: expected=${expectedRef} actual=${actualLinkedRef} linked=true.`);
console.log(`Provenance transcript SHA-256: ${transcript.sha256}.`);
console.log(`Provenance manifest SHA-256: ${provenanceArtifact.sha256}.`);
console.log(`External bundle manifest SHA-256: ${bundleHashArtifact.sha256}.`);
