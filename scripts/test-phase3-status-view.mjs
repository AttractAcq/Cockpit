import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL("../src/lib/phase3-status-view.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {}, require, console };
vm.runInNewContext(output, context);
const { isMissingPhase3StatusViewError } = context.exports;

assert.equal(isMissingPhase3StatusViewError({ code: "42P01", message: "relation does not exist" }), true);
assert.equal(isMissingPhase3StatusViewError({
  code: "PGRST205",
  message: "Could not find the table 'public.client_phase3_status_v' in the schema cache",
}), true);
assert.equal(isMissingPhase3StatusViewError({
  code: "PGRST205",
  details: "Could not find public.client_phase3_status_v in the schema cache",
}), true);

assert.equal(isMissingPhase3StatusViewError({ code: "42501", message: "permission denied for view client_phase3_status_v" }), false);
assert.equal(isMissingPhase3StatusViewError(new TypeError("Failed to fetch")), false);
assert.equal(isMissingPhase3StatusViewError({ code: "PGRST204", message: "Could not find the 'status' column" }), false);
assert.equal(isMissingPhase3StatusViewError({ code: "PGRST205", message: "Could not find unrelated_table in schema cache" }), false);
assert.equal(isMissingPhase3StatusViewError({ message: "timeout" }), false);

console.log("phase3-status-view tests passed");
