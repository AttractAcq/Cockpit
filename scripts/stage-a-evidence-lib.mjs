import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const evidenceDirectory = join(root, "docs", "evidence", "stage-a-local-verification");
export const manifestPath = join(evidenceDirectory, "verification-manifest.json");

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sanitize(text) {
  return text
    .replace(/\bpostgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g, "[REDACTED_JWT]")
    .replace(/\b(?:sbp_|sb_secret_|sk-(?:proj-)?)[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_TOKEN]")
    .replace(/^((?:anon|service_role|secret|publishable) key\s*:\s*).+$/gim, "$1[REDACTED]")
    .replace(/^((?:DB|DATABASE|API) URL\s*:\s*).+$/gim, "$1[REDACTED]")
    .replace(/[ \t]+$/gm, "");
}

export function runCommand(command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  const finishedAt = new Date().toISOString();
  return {
    command: [command, ...args].join(" "),
    startedAt,
    finishedAt,
    exitStatus: result.status ?? 1,
    output: sanitize(`${result.stdout ?? ""}${result.stderr ?? ""}`),
    error: result.error ? sanitize(String(result.error)) : "",
  };
}

export function renderCommand(result, displayCommand = result.command) {
  return [
    `UTC start: ${result.startedAt}`,
    `Command: ${displayCommand}`,
    "--- output ---",
    result.output.trimEnd(),
    result.error ? `runner error: ${result.error}` : "",
    "--- result ---",
    `Exit status: ${result.exitStatus}`,
    `UTC finish: ${result.finishedAt}`,
  ].filter((line) => line !== "").join("\n");
}

export function writeTranscript(filename, body, metadata) {
  mkdirSync(evidenceDirectory, { recursive: true });
  const bytes = Buffer.from(`${body.trimEnd()}\n`, "utf8");
  const path = join(evidenceDirectory, filename);
  writeFileSync(path, bytes);
  let manifest = {
    schema_version: "aa.cockpit.stage-a-local-verification.v3",
    classification: "locally rebuilt and verified",
    generated_at_utc: new Date().toISOString(),
    transcripts: [],
  };
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { /* first transcript */ }
  manifest.schema_version = "aa.cockpit.stage-a-local-verification.v3";
  const entry = {
    path: relative(root, path),
    sha256: sha256(bytes),
    ...metadata,
  };
  manifest.generated_at_utc = new Date().toISOString();
  manifest.transcripts = [...manifest.transcripts.filter((item) => item.path !== entry.path), entry]
    .sort((left, right) => left.path.localeCompare(right.path));
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return entry;
}
