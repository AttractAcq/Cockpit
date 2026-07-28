// Ideation Stage 2 — exact authority reconstruction.
//
// Scoring must use the same immutable authority identity the Ideation cycle
// used, not whatever happens to be current at scoring time. Every Context,
// strategic, and Execution file recorded in the cycle snapshot is re-read by id
// and its version and content hash are re-verified. Any drift fails closed: the
// operator must run a new Ideation cycle rather than silently re-basing an old
// cycle's scoring authority.

import { createEvidenceSource, type IdeationEvidenceSource } from "../evidence.ts";
import { sha256 } from "../hash.ts";

export interface AuthorityFileRow {
  id: string;
  file_number: number;
  file_name: string;
  version: number;
  content_md: string;
  month?: string;
}

interface SnapshotEntry {
  id: string;
  file_number: number;
  file_name: string;
  version: number;
  content_hash: string;
  month?: string;
}

export interface ReconstructedScoringAuthority {
  context: IdeationEvidenceSource[];
  strategicPlaybooks: IdeationEvidenceSource[];
  execution: IdeationEvidenceSource[];
  /** Verified identity of every authority row, in snapshot order. */
  verified: {
    context: SnapshotEntry[];
    strategic_playbooks: SnapshotEntry[];
    execution: SnapshotEntry[];
  };
}

export type AuthorityReconstructionResult =
  | { ok: true; authority: ReconstructedScoringAuthority }
  | { ok: false; code: "AUTHORITY_SNAPSHOT_MISMATCH" | "AUTHORITY_SNAPSHOT_INVALID"; message: string };

function readSnapshotEntries(value: unknown, requireMonth: boolean): SnapshotEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: SnapshotEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    if (
      typeof row.id !== "string"
      || typeof row.file_name !== "string"
      || typeof row.content_hash !== "string"
      || !Number.isInteger(row.file_number)
      || !Number.isInteger(row.version)
    ) return null;
    if (requireMonth && typeof row.month !== "string") return null;
    entries.push({
      id: row.id,
      file_number: row.file_number as number,
      file_name: row.file_name,
      version: row.version as number,
      content_hash: row.content_hash,
      ...(requireMonth ? { month: row.month as string } : {}),
    });
  }
  return entries;
}

async function reconstructGroup(
  entries: SnapshotEntry[],
  rows: AuthorityFileRow[],
  sourceType: "approved_context" | "approved_strategic_playbook" | "approved_execution",
  clientId: string,
  urlSegment: string,
): Promise<{ ok: true; sources: IdeationEvidenceSource[] } | { ok: false; message: string }> {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const sources: IdeationEvidenceSource[] = [];
  for (const entry of entries) {
    const row = rowsById.get(entry.id);
    if (!row) {
      return {
        ok: false,
        message: `Authority ${entry.file_name} recorded by this cycle no longer exists.`,
      };
    }
    if (row.version !== entry.version) {
      return {
        ok: false,
        message: `Authority ${entry.file_name} changed version since this cycle was generated.`,
      };
    }
    if (await sha256(row.content_md) !== entry.content_hash) {
      return {
        ok: false,
        message: `Authority ${entry.file_name} content changed since this cycle was generated.`,
      };
    }
    sources.push(await createEvidenceSource({
      sourceId: `${urlSegment}:${row.id}:v${row.version}`,
      sourceRef: entry.month ? `${entry.month}:${row.file_name}` : row.file_name,
      sourceType,
      sourceUrl: `aa-authority://client/${clientId}/${urlSegment}/${row.id}`,
      excerpt: row.content_md,
    }));
  }
  return { ok: true, sources };
}

/**
 * Rebuilds the cycle's exact authority. Context, strategic, and Execution
 * authority stay separately classified, preserving the Stage 1 hierarchy.
 */
export async function reconstructScoringAuthority(input: {
  clientId: string;
  configurationSnapshot: Record<string, unknown>;
  contextRows: AuthorityFileRow[];
  executionRows: AuthorityFileRow[];
}): Promise<AuthorityReconstructionResult> {
  const authoritySnapshot = input.configurationSnapshot?.authority;
  if (!authoritySnapshot || typeof authoritySnapshot !== "object" || Array.isArray(authoritySnapshot)) {
    return {
      ok: false,
      code: "AUTHORITY_SNAPSHOT_INVALID",
      message: "The Ideation cycle does not carry a usable authority snapshot.",
    };
  }
  const snapshot = authoritySnapshot as Record<string, unknown>;
  const context = readSnapshotEntries(snapshot.context, false);
  const strategic = readSnapshotEntries(snapshot.strategic_playbooks, false);
  const execution = readSnapshotEntries(snapshot.execution, true);
  if (!context || !strategic || !execution) {
    return {
      ok: false,
      code: "AUTHORITY_SNAPSHOT_INVALID",
      message: "The Ideation cycle authority snapshot is malformed.",
    };
  }
  if (context.length + strategic.length + execution.length === 0) {
    return {
      ok: false,
      code: "AUTHORITY_SNAPSHOT_INVALID",
      message: "The Ideation cycle authority snapshot is empty.",
    };
  }

  const contextResult = await reconstructGroup(
    context,
    input.contextRows,
    "approved_context",
    input.clientId,
    "context",
  );
  if (!contextResult.ok) {
    return { ok: false, code: "AUTHORITY_SNAPSHOT_MISMATCH", message: contextResult.message };
  }
  const strategicResult = await reconstructGroup(
    strategic,
    input.contextRows,
    "approved_strategic_playbook",
    input.clientId,
    "context",
  );
  if (!strategicResult.ok) {
    return { ok: false, code: "AUTHORITY_SNAPSHOT_MISMATCH", message: strategicResult.message };
  }
  const executionResult = await reconstructGroup(
    execution,
    input.executionRows,
    "approved_execution",
    input.clientId,
    "execution",
  );
  if (!executionResult.ok) {
    return { ok: false, code: "AUTHORITY_SNAPSHOT_MISMATCH", message: executionResult.message };
  }

  return {
    ok: true,
    authority: {
      context: contextResult.sources,
      strategicPlaybooks: strategicResult.sources,
      execution: executionResult.sources,
      verified: { context, strategic_playbooks: strategic, execution },
    },
  };
}

/** Every source id the scoring prompt makes citable, deduplicated and sorted. */
export function scoringAuthoritySourceIds(authority: ReconstructedScoringAuthority): string[] {
  return [...new Set([
    ...authority.execution.map((source) => source.source_id),
    ...authority.strategicPlaybooks.map((source) => source.source_id),
    ...authority.context.map((source) => source.source_id),
  ])].sort();
}
