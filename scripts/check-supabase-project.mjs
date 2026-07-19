import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EXPECTED_REF = "xivewedajschthjlblfb";
// Split deliberately so the forbidden identifier itself never remains tracked.
const OBSOLETE_REF = ["iwkhdqqg", "fjtpdhcbpftu"].join("");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

const tracked = git(["ls-files"]).split("\n").filter(Boolean);
const trackedTemp = tracked.filter((file) => file.startsWith("supabase/.temp/"));
if (trackedTemp.length) {
  throw new Error("supabase/.temp must remain untracked; remove it from the Git index.");
}

const obsoleteLocations = tracked.filter((file) => {
  try { return readFileSync(file, "utf8").includes(OBSOLETE_REF); }
  catch { return false; }
});
if (obsoleteLocations.length) {
  throw new Error(`Obsolete Supabase project reference remains in tracked files: ${obsoleteLocations.join(", ")}`);
}

const safeExpectedLocations = [
  "src/lib/constants.ts",
  "supabase/scheduler/install_scheduled_publishing_cron.sql",
];
for (const file of safeExpectedLocations) {
  if (!readFileSync(file, "utf8").includes(EXPECTED_REF)) {
    throw new Error(`Expected Supabase project reference is missing from ${file}.`);
  }
}

console.log(`Supabase project hygiene passed for ${EXPECTED_REF}; local .temp metadata was not inspected or printed.`);
