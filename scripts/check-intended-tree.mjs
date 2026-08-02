import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = /^(?:node_modules|dist|dist-ssr|build|coverage|supabase\/.temp)(?:\/|$)/;

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.split("\n").filter(Boolean);
}

const paths = [...new Set([
  ...git(["diff", "--name-only", "--diff-filter=ACMRTUXB"]),
  ...git(["diff", "--cached", "--name-only", "--diff-filter=ACMRTUXB"]),
  ...git(["ls-files", "--others", "--exclude-standard"]),
])].filter((path) => !ignored.test(path)).sort();

const findings = [];
for (const path of paths) {
  let bytes;
  try { bytes = readFileSync(resolve(root, path)); }
  catch { continue; }
  if (bytes.includes(0)) continue;
  const lines = bytes.toString("utf8").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, "");
    if (/[ \t]+$/.test(line)) findings.push(`${path}:${index + 1}: trailing whitespace`);
    if (/^ +\t/.test(line)) findings.push(`${path}:${index + 1}: space before tab in indentation`);
    if (/^(?:<{7}|={7}|>{7})(?: |$)/.test(line)) findings.push(`${path}:${index + 1}: conflict marker`);
  }
}

for (const args of [["diff", "--check"], ["diff", "--cached", "--check"]]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    findings.push(...`${result.stdout}${result.stderr}`.trim().split("\n").filter(Boolean));
  }
}

if (findings.length > 0) {
  console.error(`Intended-tree hygiene failed:\n${[...new Set(findings)].map((line) => `- ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`Intended-tree hygiene passed across ${paths.length} modified or intended-untracked text candidates; git diff --check also passed.`);
