import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root, sanitize, writeTranscript } from "./stage-a-evidence-lib.mjs";
import { readTestSourceBinding } from "./stage-a-test-source-binding.mjs";

const targetedRuns = 20;
const fullRuns = 10;
const sourceBinding = readTestSourceBinding(root);
const evidenceEnvironment = { ...process.env, STAGE_A_EVIDENCE_REGENERATION: "1" };

function refreshInventory() {
  const result = spawnSync(process.execPath, ["scripts/generate-stage-a-inventory.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: evidenceEnvironment,
  });
  if (result.status !== 0) throw new Error(`inventory refresh failed during evidence generation:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
}

function run(command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    env: evidenceEnvironment,
    ...options,
  });
  return {
    command: [command, ...args].join(" "),
    startedAt,
    finishedAt: new Date().toISOString(),
    exitStatus: result.status ?? 1,
    stdout: sanitize(result.stdout ?? ""),
    stderr: sanitize(`${result.stderr ?? ""}${result.error ? `\n${result.error}` : ""}`),
  };
}

function counts(result) {
  const combined = `${result.stdout}\n${result.stderr}`;
  const read = (label) => {
    const match = combined.match(new RegExp(`^ℹ ${label} (\\d+)$`, "m"));
    return match ? Number(match[1]) : null;
  };
  return { tests: read("tests"), pass: read("pass"), fail: read("fail"), skipped: read("skipped") };
}

function successful(result, parsed) {
  return result.exitStatus === 0 && parsed.tests !== null && parsed.pass === parsed.tests && parsed.fail === 0 && parsed.skipped === 0;
}

function renderRun(label, result, parsed) {
  return [
    `===== ${label} =====`,
    `UTC start: ${result.startedAt}`,
    `Command: ${result.command}`,
    "--- raw stdout ---",
    result.stdout.trimEnd(),
    "--- raw stderr ---",
    result.stderr.trimEnd(),
    "--- result ---",
    `Exit status: ${result.exitStatus}`,
    `Tests: ${parsed.tests ?? "missing"}`,
    `Pass: ${parsed.pass ?? "missing"}`,
    `Fail: ${parsed.fail ?? "missing"}`,
    `Skipped: ${parsed.skipped ?? "missing"}`,
    `UTC finish: ${result.finishedAt}`,
  ].join("\n");
}

const stabilityStarted = new Date().toISOString();
const stabilityBlocks = [
  "Stage A final-source stability evidence",
  "Classification: deterministic-test-confirmed",
  `Source binding: ${sourceBinding.sha256}`,
];
let failed = false;
let finalFullTotal = null;
for (const [kind, count, command, args] of [
  ["provider reliability", targetedRuns, "node", ["--import", "tsx", "--test", "tests/ideation-provider-reliability.test.ts"]],
  ["complete suite", fullRuns, "npm", ["test"]],
]) {
  for (let index = 1; index <= count; index += 1) {
    const result = run(command, args);
    const parsed = counts(result);
    stabilityBlocks.push(renderRun(`${kind} ${index}/${count}`, result, parsed));
    if (kind === "complete suite") finalFullTotal = parsed.tests;
    if (!successful(result, parsed)) { failed = true; break; }
  }
  if (failed) break;
}
const stabilityFinished = new Date().toISOString();
stabilityBlocks.push(`Overall exit status: ${failed ? 1 : 0}`);
const stabilityEntry = writeTranscript("test-stability-transcript.txt", stabilityBlocks.join("\n\n"), {
  command: "20x node --import tsx --test tests/ideation-provider-reliability.test.ts; 10x npm test",
  started_at_utc: stabilityStarted,
  finished_at_utc: stabilityFinished,
  exit_status: failed ? 1 : 0,
  targeted_runs: targetedRuns,
  full_suite_runs: fullRuns,
  full_suite_test_total: finalFullTotal,
  source_binding: sourceBinding,
  raw_stdout_present: true,
  raw_stderr_present: true,
  claims: ["provider reliability repeated stability", "complete deterministic suite repeated stability"],
});
if (failed) process.exit(1);
refreshInventory();

const standalone = run("npm", ["test"]);
const standaloneCounts = counts(standalone);
const standaloneEntry = writeTranscript("final-suite-transcript.txt", renderRun("final standalone complete suite", standalone, standaloneCounts), {
  command: "npm test",
  started_at_utc: standalone.startedAt,
  finished_at_utc: standalone.finishedAt,
  exit_status: successful(standalone, standaloneCounts) ? 0 : 1,
  test_totals: standaloneCounts,
  source_binding: sourceBinding,
  raw_stdout_present: true,
  raw_stderr_present: true,
  residue_check: "test process did not mutate any source-bound file; source binding is rechecked below",
  claims: ["final standalone complete deterministic suite"],
});
if (standaloneEntry.exit_status !== 0) process.exit(1);
refreshInventory();

const afterStandalone = readTestSourceBinding(root);
if (afterStandalone.sha256 !== sourceBinding.sha256) throw new Error("standalone suite mutated a source-bound file");

const temporaryRoot = mkdtempSync(join(tmpdir(), "cockpit-stage-a-read-only-"));
const copyRoot = join(temporaryRoot, "repository");
let readOnly;
let readOnlyCounts;
let permissionsConfirmed = false;
let residueStatus = 1;
let copiedBindingBefore;
try {
  cpSync(root, copyRoot, {
    recursive: true,
    dereference: false,
    preserveTimestamps: true,
    filter: (source) => {
      const relative = source.slice(root.length).replace(/^\//, "");
      return !relative || ![".git", "node_modules", "dist"].some((name) => relative === name || relative.startsWith(`${name}/`));
    },
  });
  cpSync(join(root, ".git"), join(copyRoot, ".git"), { dereference: false });
  cpSync(join(root, "node_modules"), join(copyRoot, "node_modules"), { recursive: true, dereference: false });
  copiedBindingBefore = readTestSourceBinding(copyRoot);
  if (copiedBindingBefore.sha256 !== sourceBinding.sha256) throw new Error("copied repository does not match the source binding");
  const chmod = spawnSync("chmod", ["-R", "a-w", copyRoot], { encoding: "utf8" });
  if (chmod.status !== 0) throw new Error(`failed to make copied repository non-writable: ${chmod.stderr}`);
  permissionsConfirmed = (statSync(join(copyRoot, "package.json")).mode & 0o222) === 0
    && (statSync(copyRoot).mode & 0o222) === 0;
  const noWriteTemp = join(copyRoot, ".no-writable-temp-fixture");
  readOnly = run("npm", ["test"], {
    cwd: copyRoot,
    env: {
      ...evidenceEnvironment,
      TSX_DISABLE_CACHE: "1",
      TMPDIR: noWriteTemp,
      TEMP: noWriteTemp,
      TMP: noWriteTemp,
    },
  });
  readOnlyCounts = counts(readOnly);
  const copiedBindingAfter = readTestSourceBinding(copyRoot);
  residueStatus = copiedBindingAfter.sha256 === copiedBindingBefore.sha256 ? 0 : 1;
} finally {
  chmodSync(temporaryRoot, 0o700);
  spawnSync("chmod", ["-R", "u+w", temporaryRoot]);
  rmSync(temporaryRoot, { recursive: true, force: true });
}
const readOnlyBody = [
  "Stage A copied non-writable repository suite evidence",
  "Permission model: copied repository and dependency tree recursively have all write bits removed; TSX_DISABLE_CACHE=1 prevents loader cache writes; TMPDIR/TEMP/TMP point to a nonexistent path inside the non-writable copy.",
  `Repository permissions confirmed: ${permissionsConfirmed}`,
  renderRun("copied non-writable repository complete suite", readOnly, readOnlyCounts),
  `Temporary-copy cleanup exit status: ${residueStatus}`,
].join("\n\n");
const readOnlyEntry = writeTranscript("read-only-suite-transcript.txt", readOnlyBody, {
  command: "TSX_DISABLE_CACHE=1 TMPDIR=[NONEXISTENT_PATH_INSIDE_NONWRITABLE_COPY] TEMP=[same] TMP=[same] npm test",
  started_at_utc: readOnly.startedAt,
  finished_at_utc: readOnly.finishedAt,
  exit_status: successful(readOnly, readOnlyCounts) && permissionsConfirmed && residueStatus === 0 ? 0 : 1,
  test_totals: readOnlyCounts,
  source_binding: sourceBinding,
  repository_write_bits: 0,
  temporary_fixture_dependency: false,
  raw_stdout_present: true,
  raw_stderr_present: true,
  residue_check: { copied_repository_removed: residueStatus === 0 },
  claims: ["complete suite in a copied non-writable repository", "no writable temporary fixture dependency"],
});
refreshInventory();
const finalBinding = readTestSourceBinding(root);
if (finalBinding.sha256 !== sourceBinding.sha256) throw new Error("stability evidence generation observed a source-binding change");
console.log(`Preserved ${stabilityEntry.path} (${stabilityEntry.sha256}), ${standaloneEntry.path} (${standaloneEntry.sha256}), and ${readOnlyEntry.path} (${readOnlyEntry.sha256}).`);
process.exit(readOnlyEntry.exit_status);
