import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import {
  validateRegistryState,
  validateRepositoryRegistry,
} from "../scripts/check-edge-function-registry.mjs";

const root = new URL("../", import.meta.url);
const read = (relativePath: string) => readFile(new URL(relativePath, root), "utf8");

type Registry = {
  authority: { sourceAudits: string[]; maintainerGuide: string };
  expectedCounts: Record<string, number>;
  profiles: Record<string, Record<string, unknown>>;
  exceptions: Array<Record<string, unknown>>;
  functions: Array<Record<string, unknown> & { name: string; testCoverage: string[] }>;
};

async function state() {
  const [registryText, configText, ledgerText, entries] = await Promise.all([
    read("supabase/functions/registry.json"),
    read("supabase/config.toml"),
    read("docs/edge-function-remediation/STEP_01_FINDING_LEDGER.md"),
    readdir(new URL("supabase/functions/", root), { withFileTypes: true }),
  ]);
  const registry = JSON.parse(registryText) as Registry;
  const localFunctionNames = entries.filter((entry) => entry.isDirectory() && entry.name !== "_shared").map((entry) => entry.name);
  const ledgerIds = new Set([...ledgerText.matchAll(/`(EF-[A-Z0-9-]+)`/g)].map((match) => match[1]));
  const existingPaths = new Set([
    ...registry.authority.sourceAudits,
    registry.authority.maintainerGuide,
    ...registry.functions.flatMap((entry) => entry.testCoverage),
  ]);
  return { registry, localFunctionNames, configText, ledgerIds, existingPaths, today: "2026-08-14" };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

test("canonical Edge Function registry reconciles all local functions", async () => {
  const result = await validateRepositoryRegistry();
  assert.deepEqual(result.errors, []);
  assert.equal(result.contracts.length, 103);
  assert.equal(result.contracts.filter((entry) => entry.caller === "ui").length, 81);
  assert.equal(result.contracts.filter((entry) => entry.lifecycle === "retired").length, 13);
  assert.deepEqual(result.warnings.map((entry) => entry.code), ["JWT_CONFIG_EXCEPTION"]);
});

test("an unregistered local function and a stale registry entry both fail", async () => {
  const baseline = await state();
  const missing = validateRegistryState({ ...baseline, localFunctionNames: [...baseline.localFunctionNames, "unregistered-example"] });
  assert.ok(missing.errors.some((entry) => entry.code === "UNREGISTERED_LOCAL_FUNCTION"));

  const staleRegistry = clone(baseline.registry);
  staleRegistry.functions.push({ ...clone(staleRegistry.functions[0]), name: "stale-example" });
  const stale = validateRegistryState({ ...baseline, registry: staleRegistry });
  assert.ok(stale.errors.some((entry) => entry.code === "STALE_REGISTRY_FUNCTION"));
});

test("retired functions cannot become deployable", async () => {
  const baseline = await state();
  const registry = clone(baseline.registry);
  registry.profiles.retired.deployable = true;
  const result = validateRegistryState({ ...baseline, registry });
  assert.ok(result.errors.some((entry) => entry.code === "RETIRED_DEPLOYABLE"));
});

test("background workers require explicit alternate authentication", async () => {
  const baseline = await state();
  const registry = clone(baseline.registry);
  registry.profiles.cron_jwt_disabled.alternateSecret = null;
  const result = validateRegistryState({ ...baseline, registry });
  assert.ok(result.errors.some((entry) => entry.code === "BACKGROUND_SECRET_MISSING"));
  assert.ok(result.errors.some((entry) => entry.code === "JWT_ALTERNATE_AUTH_MISSING"));
});

test("JWT configuration mismatch fails without a current bounded exception", async () => {
  const baseline = await state();
  const registry = clone(baseline.registry);
  registry.exceptions = [];
  const result = validateRegistryState({ ...baseline, registry });
  assert.ok(result.errors.some((entry) => entry.code === "JWT_CONFIG_MISMATCH" && entry.message.includes("process-asset-generation-jobs")));
});

test("bounded exceptions fail after their review date", async () => {
  const baseline = await state();
  const registry = clone(baseline.registry);
  registry.exceptions[0].reviewBy = "2026-08-13";
  const result = validateRegistryState({ ...baseline, registry });
  assert.ok(result.errors.some((entry) => entry.code === "EXPIRED_EXCEPTION"));
});

test("known function-to-function relationships remain explicit", async () => {
  const baseline = await state();
  const registry = clone(baseline.registry);
  const validator = registry.functions.find((entry) => entry.name === "validate-execution-pack");
  assert.ok(validator);
  validator.internalCallers = [];
  const result = validateRegistryState({ ...baseline, registry });
  assert.ok(result.errors.some((entry) => entry.code === "INTERNAL_CALLER_MISMATCH"));
});
