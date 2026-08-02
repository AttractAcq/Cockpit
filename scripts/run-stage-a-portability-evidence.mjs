import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { root, sanitize, writeTranscript } from "./stage-a-evidence-lib.mjs";
import { readIntendedSnapshot } from "./stage-a-intended-tree.mjs";
import {
  readTestSourceBinding,
  testEvidenceSourceExclusions,
} from "./stage-a-test-source-binding.mjs";

const externalEvidenceDirectory = "/Users/alex/Desktop/Cockpit Stage A Live Evidence";
const transcriptName = "fresh-checkout-portability-transcript.txt";
const bootstrapEvidence = process.argv.includes("--bootstrap-evidence");
const startedAt = new Date().toISOString();
const originalSnapshot = readIntendedSnapshot(root);
const originalBinding = readTestSourceBinding(root);
const localManifest = JSON.parse(readFileSync(join(root, "docs/evidence/stage-a-local-verification/verification-manifest.json"), "utf8"));
const latestPreservedTranscriptFinishMs = Math.max(...localManifest.transcripts
  .map((entry) => Date.parse(entry.finished_at_utc))
  .filter(Number.isFinite));
const forcedMtimeMs = Math.max(Date.now(), latestPreservedTranscriptFinishMs + 1_000);
const forcedMtime = new Date(forcedMtimeMs);
const temporaryRoot = mkdtempSync(join(tmpdir(), "cockpit-stage-a-fresh-checkout-"));
const copyRoot = join(temporaryRoot, "repository");

let copiedSnapshot;
let copiedBinding;
let copiedMinimumSourceMtimeMs = Number.POSITIVE_INFINITY;
let copiedMaximumSourceMtimeMs = 0;
let checkerResult;
let cleanupExitStatus = 1;

function run(command, args, cwd = copyRoot, options = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
}

function requireSuccess(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
}

function sanitized(text) {
  return sanitize(text)
    .split(temporaryRoot).join("[SANITIZED_TEMP_ROOT]")
    .split(copyRoot).join("[SANITIZED_COPIED_TREE]");
}

try {
  mkdirSync(copyRoot, { recursive: true });
  for (const path of originalSnapshot.allPaths) {
    const source = join(root, path);
    const destination = join(copyRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination, { dereference: false, preserveTimestamps: false });
  }

  requireSuccess(run("git", ["init", "-q"]), "temporary git init");
  requireSuccess(run("git", ["add", "-A"]), "temporary intended-tree index creation");

  const copiedIntended = readIntendedSnapshot(copyRoot);
  const sourcePaths = copiedIntended.fingerprintedPaths.filter((path) => (
    !testEvidenceSourceExclusions.some((entry) => path.startsWith(entry.prefix))
  ));
  for (const path of sourcePaths) {
    const absolute = join(copyRoot, path);
    const stat = lstatSync(absolute);
    if (stat.isFile()) utimesSync(absolute, forcedMtime, forcedMtime);
  }

  copiedSnapshot = readIntendedSnapshot(copyRoot);
  copiedBinding = readTestSourceBinding(copyRoot);
  for (const path of sourcePaths) {
    const mtimeMs = lstatSync(join(copyRoot, path)).mtimeMs;
    copiedMinimumSourceMtimeMs = Math.min(copiedMinimumSourceMtimeMs, mtimeMs);
    copiedMaximumSourceMtimeMs = Math.max(copiedMaximumSourceMtimeMs, mtimeMs);
  }

  if (copiedSnapshot.sha256 !== originalSnapshot.sha256) throw new Error("copied intended-tree content fingerprint differs from the original");
  if (copiedBinding.sha256 !== originalBinding.sha256) throw new Error("copied deterministic source binding differs from the original");
  if (copiedBinding.path_set_sha256 !== originalBinding.path_set_sha256) throw new Error("copied deterministic source path set differs from the original");
  if (!(copiedMinimumSourceMtimeMs > latestPreservedTranscriptFinishMs)) throw new Error("copied source mtimes are not newer than all preserved transcripts");

  checkerResult = run(process.execPath, [
    "scripts/check-stage-a-evidence.mjs",
    "--external-dir",
    externalEvidenceDirectory,
  ], copyRoot, {
    env: bootstrapEvidence
      ? { ...process.env, STAGE_A_EVIDENCE_REGENERATION: "1" }
      : process.env,
  });
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
  cleanupExitStatus = existsSync(temporaryRoot) ? 1 : 0;
}

const nodeVersion = process.version;
const npmVersionResult = spawnSync("npm", ["--version"], { cwd: root, encoding: "utf8" });
const npmVersion = (npmVersionResult.stdout ?? "").trim();
const checkerExitStatus = checkerResult?.status ?? 1;
const finishedAt = new Date().toISOString();
const body = [
  "Stage A fresh-checkout/new-mtime portability evidence",
  "Classification: deterministic content-portability proof",
  "Safety boundary: synthesized external tree containing only Git-enumerated intended files; ignored dependencies and local metadata excluded; no network, linked Supabase, deployment, or production mutation.",
  `UTC start: ${startedAt}`,
  `Node version: ${nodeVersion}`,
  `npm version: ${npmVersion}`,
  `Evidence bootstrap exemption: ${bootstrapEvidence}`,
  "Exact command: node scripts/check-stage-a-evidence.mjs --external-dir \"/Users/alex/Desktop/Cockpit Stage A Live Evidence\"",
  `Original intended-tree fingerprint: ${originalSnapshot.sha256}`,
  `Copied intended-tree fingerprint: ${copiedSnapshot?.sha256 ?? "missing"}`,
  `Original deterministic source binding: ${originalBinding.sha256}`,
  `Copied deterministic source binding: ${copiedBinding?.sha256 ?? "missing"}`,
  `Latest preserved transcript finish before proof: ${new Date(latestPreservedTranscriptFinishMs).toISOString()}`,
  `Copied minimum source mtime: ${Number.isFinite(copiedMinimumSourceMtimeMs) ? new Date(copiedMinimumSourceMtimeMs).toISOString() : "missing"}`,
  `Copied maximum source mtime: ${copiedMaximumSourceMtimeMs ? new Date(copiedMaximumSourceMtimeMs).toISOString() : "missing"}`,
  `All copied source mtimes newer than all preserved transcripts: ${copiedMinimumSourceMtimeMs > latestPreservedTranscriptFinishMs}`,
  "--- raw stdout ---",
  sanitized(checkerResult?.stdout ?? "").trimEnd(),
  "--- raw stderr ---",
  sanitized(checkerResult?.stderr ?? "").trimEnd(),
  "--- result ---",
  `Evidence-check exit status: ${checkerExitStatus}`,
  `Temporary-copy cleanup exit status: ${cleanupExitStatus}`,
  `UTC finish: ${finishedAt}`,
].join("\n");

const entry = writeTranscript(transcriptName, body, {
  command: `node scripts/check-stage-a-evidence.mjs --external-dir "${externalEvidenceDirectory}"`,
  started_at_utc: startedAt,
  finished_at_utc: finishedAt,
  exit_status: checkerExitStatus || cleanupExitStatus,
  node_version: nodeVersion,
  npm_version: npmVersion,
  original_intended_tree_sha256: originalSnapshot.sha256,
  copied_intended_tree_sha256: copiedSnapshot?.sha256 ?? "missing",
  original_source_binding_sha256: originalBinding.sha256,
  copied_source_binding_sha256: copiedBinding?.sha256 ?? "missing",
  source_binding_schema_version: originalBinding.schema_version,
  evidence_bootstrap_exemption: bootstrapEvidence,
  latest_preserved_transcript_finished_at_utc: new Date(latestPreservedTranscriptFinishMs).toISOString(),
  copied_minimum_source_mtime_utc: Number.isFinite(copiedMinimumSourceMtimeMs) ? new Date(copiedMinimumSourceMtimeMs).toISOString() : null,
  copied_maximum_source_mtime_utc: copiedMaximumSourceMtimeMs ? new Date(copiedMaximumSourceMtimeMs).toISOString() : null,
  copied_source_mtimes_newer_than_all_preserved_transcripts: copiedMinimumSourceMtimeMs > latestPreservedTranscriptFinishMs,
  content_fingerprint_match: copiedSnapshot?.sha256 === originalSnapshot.sha256,
  source_binding_match: copiedBinding?.sha256 === originalBinding.sha256,
  path_set_match: copiedBinding?.path_set_sha256 === originalBinding.path_set_sha256,
  raw_stdout_present: true,
  raw_stderr_present: true,
  cleanup_exit_status: cleanupExitStatus,
  claims: [
    "byte-identical intended tree with newer checkout-local mtimes",
    "exact evidence checker passes without timestamp freshness",
    "temporary copied tree cleanup",
  ],
});

const inventoryRefresh = spawnSync(process.execPath, ["scripts/generate-stage-a-inventory.mjs"], { cwd: root, encoding: "utf8" });
if (inventoryRefresh.status !== 0) {
  console.error(`${inventoryRefresh.stdout ?? ""}${inventoryRefresh.stderr ?? ""}`);
  process.exit(1);
}
console.log(`Preserved ${entry.path} (sha256 ${entry.sha256}, exit ${entry.exit_status}).`);
process.exit(entry.exit_status);
