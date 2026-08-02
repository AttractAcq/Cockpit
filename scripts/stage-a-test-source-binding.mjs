import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentFingerprintEntries } from "./stage-a-content-fingerprint.mjs";
import { sha256 } from "./stage-a-evidence-lib.mjs";
import { readIntendedSnapshot } from "./stage-a-intended-tree.mjs";

export const testEvidenceSourceBindingSchema = "aa.cockpit.stage-a-test-source-binding.v1";
export const frozenStageASourceBaseline = "7d4c1b96cdd7f3a59e28dc9826b44b1aad3b4e5e";
export const testEvidenceEnumerationRule = "git ls-files --cached --others --exclude-standard -z; sort paths; exclude the generated inventory and local execution outputs";

export const testEvidenceSourceExclusions = [
  {
    prefix: "docs/evidence/stage-a-local-verification/",
    reason: "execution outputs and their manifest are produced after the commands they describe",
  },
];

export function testSourceBindingEntries(entries) {
  const normalized = entries
    .map(({ path, bytes }) => ({ path, bytes }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const exactHashes = Object.fromEntries(normalized.map((entry) => [entry.path, sha256(entry.bytes)]));
  const testSourceHashes = Object.fromEntries(normalized
    .filter((entry) => entry.path.startsWith("tests/") && entry.path.endsWith(".test.ts"))
    .map((entry) => [entry.path, exactHashes[entry.path]]));
  const packageAndWorkflowPaths = [".github/workflows/ci.yml", "package.json", "package-lock.json"];
  const packageAndWorkflowHashes = Object.fromEntries(packageAndWorkflowPaths
    .filter((path) => exactHashes[path])
    .map((path) => [path, exactHashes[path]]));
  return {
    schema_version: testEvidenceSourceBindingSchema,
    frozen_source_baseline_commit: frozenStageASourceBaseline,
    enumeration_rule: testEvidenceEnumerationRule,
    algorithm: "sha256(path NUL exact-bytes NUL, sorted paths)",
    sha256: contentFingerprintEntries(normalized),
    path_set_sha256: contentFingerprintEntries(normalized.map(({ path }) => ({ path, bytes: Buffer.alloc(0) }))),
    file_count: normalized.length,
    test_source_hashes: testSourceHashes,
    package_and_workflow_hashes: packageAndWorkflowHashes,
    exclusions: testEvidenceSourceExclusions,
    intended_tree_fingerprint_reference: "docs/stage-a-current-state-inventory.json#/repository/inventory_source_identity/sha256",
  };
}

export function readTestSourceBinding(root) {
  const intended = readIntendedSnapshot(root);
  const paths = intended.fingerprintedPaths.filter((path) => (
    !testEvidenceSourceExclusions.some((entry) => path.startsWith(entry.prefix))
  ));
  const entries = paths.map((path) => ({ path, bytes: readFileSync(join(root, path)) }));
  return testSourceBindingEntries(entries);
}
