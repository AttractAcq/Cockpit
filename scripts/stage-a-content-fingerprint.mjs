import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function contentFingerprintEntries(entries) {
  const hash = createHash("sha256");
  const normalized = entries.map((entry) => {
    if (!entry || typeof entry.path !== "string" || !entry.path) throw new Error("fingerprint entry path is required");
    if (entry.bytes === undefined || entry.bytes === null) throw new Error(`fingerprint entry ${entry.path} has no bytes`);
    return { path: entry.path, bytes: Buffer.from(entry.bytes) };
  });
  const paths = normalized.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) throw new Error("fingerprint entry paths must be unique");
  for (const { path, bytes } of normalized.sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(path);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * Hash an explicit, sorted set of repository inputs. Git metadata is never an
 * input: committing identical bytes must not invalidate a generated artifact.
 */
export function contentFingerprint(root, paths) {
  return contentFingerprintEntries([...new Set(paths)].map((path) => ({
    path,
    bytes: readFileSync(join(root, path)),
  })));
}
