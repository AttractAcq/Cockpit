import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { excludedProjectionRule, executableProjectionExclusionRules } from "./stage-a-bootstrap-schema-rules.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = resolve(root, "supabase/baseline/current-schema.sql");
const outputPath = resolve(root, "supabase/baseline/application-schema.sql");
const checkOnly = process.argv.includes("--check");
const sql = readFileSync(inputPath, "utf8");

function statements(body) {
  const result = [];
  let start = 0;
  let single = false;
  let double = false;
  let lineComment = false;
  let blockComment = false;
  let dollar = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (dollar) {
      if (body.startsWith(dollar, index)) { index += dollar.length - 1; dollar = null; }
      continue;
    }
    if (single) {
      if (char === "'" && next === "'") { index += 1; continue; }
      if (char === "'") single = false;
      continue;
    }
    if (double) {
      if (char === '"' && next === '"') { index += 1; continue; }
      if (char === '"') double = false;
      continue;
    }
    if (char === "-" && next === "-") { lineComment = true; index += 1; continue; }
    if (char === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (char === "'") { single = true; continue; }
    if (char === '"') { double = true; continue; }
    if (char === "$") {
      const match = /^\$[A-Za-z0-9_]*\$/.exec(body.slice(index));
      if (match) { dollar = match[0]; index += dollar.length - 1; continue; }
    }
    if (char === ";") {
      result.push(body.slice(start, index + 1).trim());
      start = index + 1;
    }
  }
  const tail = body.slice(start).trim();
  if (tail) result.push(tail);
  return result;
}

const parsedStatements = statements(sql);
const excluded = parsedStatements.filter((statement) => excludedProjectionRule(statement));
const retained = parsedStatements.filter((statement) => !excludedProjectionRule(statement));
const rendered = `${retained.join("\n\n")}\n`;

if (checkOnly) {
  if (readFileSync(outputPath, "utf8") !== rendered) {
    console.error(`Stage A bootstrap schema is stale. Run: node ${relative(root, fileURLToPath(import.meta.url))}`);
    process.exit(1);
  }
  console.log(`Stage A executable application schema is current (${retained.length} retained statements; ${excluded.length} platform-owned statements excluded by ${executableProjectionExclusionRules.length} rules).`);
} else {
  writeFileSync(outputPath, rendered);
  console.log(`Wrote canonical executable reconstruction ${relative(root, outputPath)} (${retained.length} retained; ${excluded.length} excluded).`);
}
