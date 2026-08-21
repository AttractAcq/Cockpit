import { access, readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = path.join(ROOT, "supabase/functions/registry.json");
const CONFIG_PATH = path.join(ROOT, "supabase/config.toml");
const LEDGER_PATH = path.join(ROOT, "docs/edge-function-remediation/STEP_01_FINDING_LEDGER.md");

const PROFILE_FIELDS = [
  "lifecycle", "caller", "allowedMethods", "authMode", "allowedStaffRoles",
  "clientScope", "jwtVerification", "alternateSecret", "serviceRoleUsage",
  "deployable", "operationalOwner", "requiredEnvironment",
];

const FUNCTION_FIELDS = [
  "name", "purpose", "system", "page", "profile", "databaseDomains",
  "storageBuckets", "externalProviders", "requiredEnvironment", "auditPhases",
  "remediationIds", "testCoverage", "internalCallers",
];

function add(errors, code, message) {
  errors.push({ code, message });
}

function duplicateValues(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
}

function parseJwtConfiguration(configText) {
  const configured = new Map();
  let currentFunction = null;
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const section = /^\[functions\.([a-z0-9-]+)\]$/.exec(line);
    if (section) {
      currentFunction = section[1];
      continue;
    }
    if (line.startsWith("[") && !section) {
      currentFunction = null;
      continue;
    }
    const verifyJwt = /^verify_jwt\s*=\s*(true|false)$/.exec(line);
    if (currentFunction && verifyJwt) configured.set(currentFunction, verifyJwt[1] === "true");
  }
  return configured;
}

function activeException(registry, functionName, check, today, errors) {
  const matches = registry.exceptions.filter((entry) => entry.function === functionName && entry.check === check);
  if (matches.length > 1) add(errors, "DUPLICATE_EXCEPTION", `${functionName} has more than one ${check} exception.`);
  const exception = matches[0];
  if (!exception) return null;
  for (const field of ["id", "owner", "reason", "reviewBy"]) {
    if (typeof exception[field] !== "string" || !exception[field].trim()) {
      add(errors, "INVALID_EXCEPTION", `${functionName} ${check} exception is missing ${field}.`);
    }
  }
  if (!Array.isArray(exception.remediationIds) || exception.remediationIds.length === 0) {
    add(errors, "INVALID_EXCEPTION", `${functionName} ${check} exception needs at least one remediation ID.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.reviewBy ?? "")) {
    add(errors, "INVALID_EXCEPTION_DATE", `${functionName} ${check} exception reviewBy must be YYYY-MM-DD.`);
    return null;
  }
  if (exception.reviewBy < today) {
    add(errors, "EXPIRED_EXCEPTION", `${functionName} ${check} exception expired on ${exception.reviewBy}.`);
    return null;
  }
  return exception;
}

export function resolveFunctionContract(registry, entry) {
  const profile = registry.profiles[entry.profile];
  if (!profile) return null;
  return {
    ...profile,
    ...entry,
    requiredEnvironment: [...new Set([...(profile.requiredEnvironment ?? []), ...(entry.requiredEnvironment ?? [])])].sort(),
  };
}

export function validateRegistryState({
  registry,
  localFunctionNames,
  configText,
  ledgerIds,
  existingPaths,
  today = new Date().toISOString().slice(0, 10),
}) {
  const errors = [];
  const warnings = [];

  if (registry.schemaVersion !== 1) add(errors, "SCHEMA_VERSION", "Registry schemaVersion must be 1.");
  if (!registry.profiles || typeof registry.profiles !== "object") add(errors, "PROFILES_MISSING", "Registry profiles are required.");
  if (!Array.isArray(registry.functions)) add(errors, "FUNCTIONS_MISSING", "Registry functions must be an array.");
  if (!Array.isArray(registry.exceptions)) add(errors, "EXCEPTIONS_MISSING", "Registry exceptions must be an array.");
  if (errors.length) return { errors, warnings, contracts: [] };

  for (const [name, profile] of Object.entries(registry.profiles)) {
    for (const field of PROFILE_FIELDS) {
      if (!(field in profile)) add(errors, "PROFILE_FIELD_MISSING", `Profile ${name} is missing ${field}.`);
    }
  }

  const names = registry.functions.map((entry) => entry.name);
  for (const duplicate of duplicateValues(names)) add(errors, "DUPLICATE_FUNCTION", `Registry contains ${duplicate} more than once.`);

  const local = [...localFunctionNames].sort();
  const registered = [...new Set(names)].sort();
  for (const name of local.filter((value) => !registered.includes(value))) {
    add(errors, "UNREGISTERED_LOCAL_FUNCTION", `Local function ${name} has no registry entry.`);
  }
  for (const name of registered.filter((value) => !local.includes(value))) {
    add(errors, "STALE_REGISTRY_FUNCTION", `Registry function ${name} has no local function directory.`);
  }

  const contracts = [];
  for (const entry of registry.functions) {
    for (const field of FUNCTION_FIELDS) {
      if (!(field in entry)) add(errors, "FUNCTION_FIELD_MISSING", `${entry.name ?? "<unnamed>"} is missing ${field}.`);
    }
    const contract = resolveFunctionContract(registry, entry);
    if (!contract) {
      add(errors, "UNKNOWN_PROFILE", `${entry.name} references unknown profile ${entry.profile}.`);
      continue;
    }
    contracts.push(contract);
    for (const field of ["allowedMethods", "allowedStaffRoles", "requiredEnvironment", "databaseDomains", "storageBuckets", "externalProviders", "auditPhases", "remediationIds", "testCoverage", "internalCallers"]) {
      if (!Array.isArray(contract[field])) add(errors, "INVALID_ARRAY_FIELD", `${entry.name}.${field} must be an array.`);
    }
    if (!contract.purpose?.trim() || !contract.system?.trim() || !contract.page?.trim() || !contract.operationalOwner?.trim()) {
      add(errors, "INCOMPLETE_OWNERSHIP", `${entry.name} must declare purpose, system, page, and operational owner.`);
    }
    if (contract.lifecycle === "retired" && contract.deployable) {
      add(errors, "RETIRED_DEPLOYABLE", `${entry.name} is retired and cannot be deployable.`);
    }
    if (contract.lifecycle === "retired" && contract.caller !== "none") {
      add(errors, "RETIRED_CALLER", `${entry.name} is retired and must have caller=none.`);
    }
    if (contract.deployable && !contract.allowedMethods.includes("OPTIONS")) {
      add(errors, "OPTIONS_MISSING", `${entry.name} is deployable but does not declare OPTIONS.`);
    }
    if ((contract.lifecycle === "background" || contract.caller === "webhook") &&
        (!contract.authMode || contract.authMode === "not_applicable")) {
      add(errors, "BACKGROUND_AUTH_MISSING", `${entry.name} requires an explicit background/webhook auth mode.`);
    }
    if (contract.lifecycle === "background" && !contract.alternateSecret) {
      add(errors, "BACKGROUND_SECRET_MISSING", `${entry.name} requires an explicit alternate secret.`);
    }
    if (contract.jwtVerification === "disabled_with_alternate_auth" && !contract.alternateSecret) {
      add(errors, "JWT_ALTERNATE_AUTH_MISSING", `${entry.name} disables JWT without an alternate secret.`);
    }
    for (const id of contract.remediationIds) {
      if (!ledgerIds.has(id)) add(errors, "UNKNOWN_REMEDIATION_ID", `${entry.name} references unknown remediation ID ${id}.`);
    }
    for (const testPath of contract.testCoverage) {
      if (!existingPaths.has(testPath)) add(errors, "MISSING_TEST_REFERENCE", `${entry.name} references missing test ${testPath}.`);
    }
  }

  const expected = registry.expectedCounts ?? {};
  const uiCount = contracts.filter((entry) => entry.caller === "ui").length;
  const retiredCount = contracts.filter((entry) => entry.lifecycle === "retired").length;
  if (local.length !== expected.localFunctions) add(errors, "LOCAL_COUNT_MISMATCH", `Expected ${expected.localFunctions} local functions, found ${local.length}.`);
  if (uiCount !== expected.uiCalled) add(errors, "UI_COUNT_MISMATCH", `Expected ${expected.uiCalled} UI-called functions, found ${uiCount}.`);
  if (contracts.length - uiCount !== expected.nonUiCalled) add(errors, "NON_UI_COUNT_MISMATCH", `Expected ${expected.nonUiCalled} non-UI functions, found ${contracts.length - uiCount}.`);
  if (retiredCount !== expected.retired) add(errors, "RETIRED_COUNT_MISMATCH", `Expected ${expected.retired} retired functions, found ${retiredCount}.`);

  const config = parseJwtConfiguration(configText);
  for (const contract of contracts.filter((entry) => entry.deployable)) {
    const localJwt = config.get(contract.name) ?? true;
    const expectedJwt = contract.jwtVerification === "verified";
    if (localJwt !== expectedJwt) {
      const exception = activeException(registry, contract.name, "jwt_config_mismatch", today, errors);
      if (exception) warnings.push({
        code: "JWT_CONFIG_EXCEPTION",
        message: `${contract.name} JWT posture differs from local config under ${exception.id}; review by ${exception.reviewBy}.`,
      });
      else add(errors, "JWT_CONFIG_MISMATCH", `${contract.name} expects verify_jwt=${expectedJwt}, local config resolves to ${localJwt}.`);
    }
  }

  const expectedInternalCalls = new Map([
    ["validate-execution-pack", ["generate-phase-2", "generate-phase-3"]],
    ["onboarding", ["payfast-webhook"]],
  ]);
  for (const contract of contracts) {
    const expectedCallers = expectedInternalCalls.get(contract.name) ?? [];
    const actualCallers = [...contract.internalCallers].sort();
    if (JSON.stringify(actualCallers) !== JSON.stringify([...expectedCallers].sort())) {
      add(errors, "INTERNAL_CALLER_MISMATCH", `${contract.name} internal callers must be [${expectedCallers.join(", ")}].`);
    }
  }

  for (const requiredPath of [...(registry.authority?.sourceAudits ?? []), registry.authority?.maintainerGuide].filter(Boolean)) {
    if (!existingPaths.has(requiredPath)) add(errors, "MISSING_AUTHORITY_REFERENCE", `Registry authority reference does not exist: ${requiredPath}.`);
  }

  return { errors, warnings, contracts };
}

async function pathExists(relativePath) {
  try {
    await access(path.join(ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function validateRepositoryRegistry() {
  const [registryText, configText, ledgerText, functionEntries] = await Promise.all([
    readFile(REGISTRY_PATH, "utf8"),
    readFile(CONFIG_PATH, "utf8"),
    readFile(LEDGER_PATH, "utf8"),
    readdir(path.join(ROOT, "supabase/functions"), { withFileTypes: true }),
  ]);
  const registry = JSON.parse(registryText);
  const localFunctionNames = functionEntries
    // node_modules is Deno-managed (nodeModulesDir: "auto" in
    // supabase/functions/deno.json, materialized by `deno check`/`deno install`
    // -- eslint.config.js already excludes it for the same reason), not a
    // function directory.
    .filter((entry) => entry.isDirectory() && entry.name !== "_shared" && entry.name !== "node_modules")
    .map((entry) => entry.name);
  const ledgerIds = new Set([...ledgerText.matchAll(/`(EF-[A-Z0-9-]+)`/g)].map((match) => match[1]));
  const referencedPaths = new Set([
    ...(registry.authority?.sourceAudits ?? []),
    registry.authority?.maintainerGuide,
    ...registry.functions.flatMap((entry) => entry.testCoverage ?? []),
  ].filter(Boolean));
  const existingPaths = new Set();
  await Promise.all([...referencedPaths].map(async (relativePath) => {
    if (await pathExists(relativePath)) existingPaths.add(relativePath);
  }));
  return validateRegistryState({ registry, localFunctionNames, configText, ledgerIds, existingPaths });
}

async function main() {
  const result = await validateRepositoryRegistry();
  for (const warning of result.warnings) console.warn(`WARN ${warning.code}: ${warning.message}`);
  if (result.errors.length) {
    for (const error of result.errors) console.error(`ERROR ${error.code}: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const ui = result.contracts.filter((entry) => entry.caller === "ui").length;
  const retired = result.contracts.filter((entry) => entry.lifecycle === "retired").length;
  console.log(`Edge Function registry passed: ${result.contracts.length} functions, ${ui} UI-called, ${result.contracts.length - ui} non-UI, ${retired} retired.`);
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) await main();
