import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { contentFingerprintEntries } from "./stage-a-content-fingerprint.mjs";

export const intendedTreeExclusions = [
  {
    path: "docs/stage-a-current-state-inventory.json",
    reason: "generated inventory contains the fingerprint and is excluded only to prevent direct recursion",
  },
];

export function assertSafeRelativePath(path) {
  if (!path || isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`) || path.split(/[\\/]/).includes("..")) {
    throw new Error(`unsafe intended-tree path: ${path}`);
  }
}

export function assertResolvedWithinRoot(root, resolvedPath, label = "path") {
  const fromRoot = relative(resolve(root), resolve(resolvedPath));
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} escapes the repository: ${resolvedPath}`);
  }
}

export function enumerateIntendedPaths(root) {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  const paths = output.split("\0").filter(Boolean).sort();
  if (new Set(paths).size !== paths.length) throw new Error("Git intended-tree enumeration returned duplicate paths");
  for (const path of paths) assertSafeRelativePath(path);
  return paths;
}

export function readIntendedSnapshot(root) {
  const allPaths = enumerateIntendedPaths(root);
  const exclusionMap = new Map(intendedTreeExclusions.map((entry) => [entry.path, entry.reason]));
  for (const excluded of exclusionMap.keys()) {
    if (!allPaths.includes(excluded)) throw new Error(`explicit intended-tree exclusion is not enumerated: ${excluded}`);
  }
  const fingerprintedPaths = allPaths.filter((path) => !exclusionMap.has(path));
  const entries = fingerprintedPaths.map((path) => {
    const absolute = resolve(root, path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch (error) {
      throw new Error(`enumerated intended-tree file is missing: ${path}`, { cause: error });
    }
    if (stat.isDirectory()) throw new Error(`enumerated intended-tree path is unexpectedly a directory: ${path}`);
    if (stat.isSymbolicLink()) {
      const resolvedTarget = realpathSync(absolute);
      assertResolvedWithinRoot(root, resolvedTarget, `symlink ${path}`);
      return { path, bytes: Buffer.from(readlinkSync(absolute), "utf8"), kind: "symlink" };
    }
    if (!stat.isFile()) throw new Error(`unsupported intended-tree file type: ${path}`);
    return { path, bytes: readFileSync(absolute), kind: "file" };
  });
  return {
    allPaths,
    fingerprintedPaths,
    entries,
    exclusions: intendedTreeExclusions,
    sha256: contentFingerprintEntries(entries),
  };
}
