import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(resolve(root, "supabase/baseline/manifest.json"), "utf8"));
const args = process.argv.slice(2);
const catalogIndex = args.indexOf("--catalog");
const snapshotIndex = args.indexOf("--snapshot");

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function sorted(values) {
  return [...values].sort();
}

function multisetDifference(left, right) {
  const remaining = new Map();
  for (const value of right) remaining.set(value, (remaining.get(value) ?? 0) + 1);
  const difference = [];
  for (const value of left) {
    const count = remaining.get(value) ?? 0;
    if (count === 0) difference.push(value);
    else remaining.set(value, count - 1);
  }
  return difference;
}

function expectedCatalog() {
  const values = [];
  for (const table of manifest.tables) {
    values.push(`table|${table.name}`);
    if (table.rls_enabled) values.push(`rls|${table.name}`);
    for (const column of table.columns) values.push(`column|${table.name}.${column.name}`);
    for (const constraint of table.constraints) values.push(`constraint|${table.name}.${constraint.name}`);
  }
  for (const value of manifest.enums) {
    values.push(`enum|${value.name}`);
    value.values.forEach((label, index) => values.push(`enum_value|${value.name}.${index + 1}.${label}`));
  }
  for (const fn of manifest.functions) values.push(`function|${fn.name}`);
  for (const view of manifest.views) values.push(`view|${view.name}`);
  for (const trigger of manifest.triggers) values.push(`trigger|${trigger.table}.${trigger.name}`);
  for (const policy of manifest.policies) values.push(`policy|${policy.table}.${policy.name}`);
  for (const index of manifest.indexes) values.push(`index|${index.name}`);
  for (const table of manifest.tables) {
    for (const constraint of table.constraints) {
      if (/^(PRIMARY KEY|UNIQUE)\b/.test(constraint.definition)) values.push(`index|${constraint.name}`);
    }
  }
  values.push("storage_bucket|client-assets", "storage_bucket|video-assets");
  for (const name of [
    "client_assets_storage_staff_select", "client_assets_storage_staff_insert",
    "client_assets_storage_staff_update", "client_assets_storage_staff_delete",
    "video_assets_storage_staff_select", "video_assets_storage_staff_insert",
    "video_assets_storage_staff_update", "video_assets_storage_staff_delete",
  ]) values.push(`storage_policy|${name}`);
  values.push("seed|brand_dna.1", "seed|brand_sting.1");
  return sorted(values);
}

if (snapshotIndex >= 0) {
  const path = args[snapshotIndex + 1];
  if (!path) throw new Error("--snapshot requires a path");
  const actual = sha256(readFileSync(resolve(path)));
  assert.equal(actual, manifest.authority.external_snapshot_sha256, "snapshot hash does not match the recorded production evidence");
  assert.equal(actual, manifest.authority.current_schema_sha256, "repository baseline is not byte-identical to the recorded production snapshot");
  console.log(`Stage A production snapshot comparison passed (sha256 ${actual}; exact schema-only match).`);
} else if (catalogIndex >= 0) {
  const path = args[catalogIndex + 1];
  if (!path) throw new Error("--catalog requires a path");
  const actual = readFileSync(resolve(path), "utf8").split("\n").map((line) => line.trim()).filter(Boolean).sort();
  const expected = expectedCatalog();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const missing = multisetDifference(expected, actual);
    const unexpected = multisetDifference(actual, expected);
    const preview = (values) => values.slice(0, 20).join(", ") || "none";
    throw new Error(
      `rebuilt identifier catalogue differs from the canonical baseline manifest: ` +
      `${actual.length} actual, ${expected.length} expected; ` +
      `${missing.length} missing (${preview(missing)}); ` +
      `${unexpected.length} unexpected (${preview(unexpected)})`,
    );
  }
  console.log(`Stage A rebuilt identifier catalogue comparison passed (${actual.length} name/value/flag entries; definitions and ACLs are outside this comparison scope).`);
} else {
  const baselinePath = resolve(root, manifest.authority.current_schema_path);
  const actual = sha256(readFileSync(baselinePath));
  assert.equal(actual, manifest.authority.current_schema_sha256, "repository baseline hash does not match its generated manifest");
  assert.equal(actual, manifest.authority.external_snapshot_sha256, "repository baseline is not byte-identical to the trusted production snapshot hash");
  console.log(`Stage A captured-authority comparison passed (sha256 ${actual}; current-schema.sql matches its manifest and the provenance-bound production snapshot hash).`);
}
