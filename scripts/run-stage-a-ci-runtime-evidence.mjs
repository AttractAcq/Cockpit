import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root, sanitize, writeTranscript } from "./stage-a-evidence-lib.mjs";
import { readIntendedSnapshot } from "./stage-a-intended-tree.mjs";
import { readTestSourceBinding } from "./stage-a-test-source-binding.mjs";

const image = "node:20.19.4-bookworm";
const containerName = "cockpit-stage-a-node20-ci-evidence";
const bootstrapEvidence = process.argv.includes("--bootstrap-evidence");
const startedAt = new Date().toISOString();
const inputSnapshot = readIntendedSnapshot(root);
const sourceBinding = readTestSourceBinding(root);
const temporaryRoot = mkdtempSync(join(tmpdir(), "cockpit-stage-a-node20-ci-"));
const copyRoot = join(temporaryRoot, "source");
let dockerResult;
let cleanupExitStatus = 1;

function copyFilter(source) {
  const relative = source.slice(root.length).replace(/^\//, "");
  return !relative || ![".git", "node_modules", "dist"].some((name) => relative === name || relative.startsWith(`${name}/`));
}

function runCopyCommand(command, args) {
  const result = spawnSync(command, args, { cwd: copyRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
}

try {
  cpSync(root, copyRoot, { recursive: true, dereference: false, preserveTimestamps: true, filter: copyFilter });
  if (bootstrapEvidence) {
    const copyManifestPath = join(copyRoot, "docs/evidence/stage-a-local-verification/verification-manifest.json");
    const copyManifest = JSON.parse(readFileSync(copyManifestPath, "utf8"));
    copyManifest.schema_version = "aa.cockpit.stage-a-local-verification.v3";
    copyManifest.transcripts = copyManifest.transcripts.filter((entry) => !entry.path.endsWith("/ci-node20-runtime-transcript.txt"));
    writeFileSync(copyManifestPath, `${JSON.stringify(copyManifest, null, 2)}\n`);
    rmSync(join(copyRoot, "docs/evidence/stage-a-local-verification/ci-node20-runtime-transcript.txt"), { force: true });
  }
  runCopyCommand("git", ["init", "-q"]);
  runCopyCommand("git", ["config", "user.name", "Stage A CI Evidence"]);
  runCopyCommand("git", ["config", "user.email", "stage-a-ci-evidence@invalid.local"]);
  if (bootstrapEvidence) runCopyCommand(process.execPath, ["scripts/generate-stage-a-inventory.mjs"]);
  runCopyCommand("git", ["add", "-A"]);
  runCopyCommand("git", ["commit", "-q", "-m", "ephemeral exact-byte CI input"]);
  const shell = [
    "set +e",
    "run_component() {",
    "  component=\"$1\"; shift",
    "  component_start=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "  printf 'STAGE_A_CI_COMPONENT_START|%s|%s|%s\\n' \"$component\" \"$component_start\" \"$*\"",
    "  \"$@\"",
    "  status=$?",
    "  component_finish=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "  printf 'STAGE_A_CI_COMPONENT_EXIT|%s|%s|%s\\n' \"$component\" \"$status\" \"$component_finish\"",
    "  return $status",
    "}",
    "overall=0",
    "run_component node_version node --version || overall=1",
    "run_component npm_version npm --version || overall=1",
    "run_component npm_ci npm ci || overall=1",
    "run_component typecheck npm run typecheck || overall=1",
    "run_component lint npm run lint || overall=1",
    "run_component test npm test || overall=1",
    "run_component build npm run build || overall=1",
    "exit $overall",
  ].join("\n");
  dockerResult = spawnSync("docker", [
    "run", "--name", containerName, "--rm",
    ...(bootstrapEvidence ? ["--env", "STAGE_A_EVIDENCE_REGENERATION=1"] : []),
    "--mount", `type=bind,source=${copyRoot},target=/workspace`,
    "--workdir", "/workspace",
    image,
    "bash", "-lc", shell,
  ], { cwd: root, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 900_000 });
} finally {
  try {
    chmodSync(temporaryRoot, 0o700);
    rmSync(temporaryRoot, { recursive: true, force: true });
    const residue = spawnSync("docker", ["ps", "-a", "--filter", `name=^/${containerName}$`, "--format", "{{.Names}}"], { encoding: "utf8" });
    cleanupExitStatus = residue.status === 0 && !(residue.stdout ?? "").trim() ? 0 : 1;
  } catch {
    cleanupExitStatus = 1;
  }
}

const stdout = sanitize(dockerResult?.stdout ?? "");
const stderr = sanitize(dockerResult?.stderr ?? "");
const exitStatus = dockerResult?.status ?? 1;
const finishedAt = new Date().toISOString();
const componentStatuses = Object.fromEntries([...stdout.matchAll(/^STAGE_A_CI_COMPONENT_EXIT\|([^|]+)\|(\d+)\|/gm)].map((match) => [match[1], Number(match[2])]));
const body = [
  "Stage A exact Node 20 CI-runtime execution evidence",
  "Classification: CI-runtime-confirmed",
  `Runtime image: ${image}`,
  `UTC start: ${startedAt}`,
  `Source-tree execution-input fingerprint: ${inputSnapshot.sha256}`,
  `Test-source binding fingerprint: ${sourceBinding.sha256}`,
  `Evidence bootstrap exemption: ${bootstrapEvidence}`,
  `Exact container command: docker run --rm ${bootstrapEvidence ? "--env STAGE_A_EVIDENCE_REGENERATION=1 " : ""}--mount type=bind,source=[SANITIZED_TEMP_COPY],target=/workspace --workdir /workspace node:20.19.4-bookworm bash -lc [RECORDED_COMPONENT_SCRIPT]`,
  "--- raw stdout ---",
  stdout.trimEnd(),
  "--- raw stderr ---",
  stderr.trimEnd(),
  "--- result ---",
  `Container exit status: ${exitStatus}`,
  `Cleanup exit status: ${cleanupExitStatus}`,
  `UTC finish: ${finishedAt}`,
].join("\n");
const entry = writeTranscript("ci-node20-runtime-transcript.txt", body, {
  command: `docker run --rm ${bootstrapEvidence ? "--env STAGE_A_EVIDENCE_REGENERATION=1 " : ""}--mount type=bind,source=[SANITIZED_TEMP_COPY],target=/workspace --workdir /workspace node:20.19.4-bookworm bash -lc [node --version; npm --version; npm ci; npm run typecheck; npm run lint; npm test; npm run build]`,
  runtime_image: image,
  started_at_utc: startedAt,
  finished_at_utc: finishedAt,
  exit_status: exitStatus || cleanupExitStatus,
  component_exit_statuses: { ...componentStatuses, cleanup: cleanupExitStatus },
  execution_input_fingerprint: inputSnapshot.sha256,
  evidence_bootstrap_exemption: bootstrapEvidence,
  source_binding: sourceBinding,
  raw_stdout_present: stdout.length > 0,
  raw_stderr_present: true,
  claims: ["exact pinned Node 20 CI runtime", "npm ci", "typecheck", "lint", "complete deterministic suite", "production build", "container cleanup"],
});
const inventoryRefresh = spawnSync(process.execPath, ["scripts/generate-stage-a-inventory.mjs"], { cwd: root, encoding: "utf8" });
if (inventoryRefresh.status !== 0) {
  console.error(`${inventoryRefresh.stdout ?? ""}${inventoryRefresh.stderr ?? ""}`);
  process.exit(1);
}
console.log(`Preserved ${entry.path} (sha256 ${entry.sha256}, exit ${entry.exit_status}).`);
process.exit(entry.exit_status);
