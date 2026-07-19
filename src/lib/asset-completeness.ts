import type { AssetGenerationJobRow, ClientAssetRow } from "@/types/phase";

export type AssetWarningCode = "generation_in_progress" | "expected_count_mismatch";

export interface AssetWarningAcknowledgementRow {
  id: string;
  client_id: string;
  asset_group_ref: string;
  warning_code: AssetWarningCode | string;
  warning_fingerprint: string;
  dismissed_by: string;
  dismissed_at: string;
  created_at: string;
}

export interface AssetGroupCompletenessOverrideRow {
  id: string;
  client_id: string;
  asset_group_ref: string;
  generation_job_id: string;
  production_brief_id: string | null;
  original_expected_count: number;
  actual_count_at_acceptance: number;
  accepted_output_count: number;
  accepted_sequence_indexes: number[];
  missing_sequence_indexes: number[];
  override_reason: string;
  overridden_by: string;
  overridden_at: string;
  source_job_status: string;
  source_job_snapshot: Record<string, unknown>;
  is_active: boolean;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
  created_at: string;
}

export interface AssetCompletenessWarning {
  code: AssetWarningCode;
  fingerprint: string;
  message: string;
  dismissed: boolean;
}

export interface AssetCompletenessState {
  originalExpectedCount: number | null;
  actualCurrentCount: number;
  activeOverride: AssetGroupCompletenessOverrideRow | null;
  acceptedOutputCount: number | null;
  acceptedSequenceIndexes: number[];
  effectiveExpectedCount: number | null;
  missingIndexes: number[];
  isGenerating: boolean;
  isIncomplete: boolean;
  isAcceptedPartial: boolean;
  canApproveCompleteness: boolean;
  visibleWarnings: AssetCompletenessWarning[];
  allWarnings: AssetCompletenessWarning[];
}

const MULTI_IMAGE_FORMATS = new Set(["carousel", "story_sequence"]);

export function expectedGroupCount(rows: ClientAssetRow[], job?: AssetGenerationJobRow | null): number | null {
  if (job?.expected_output_count && job.expected_output_count > 0) return job.expected_output_count;
  const counts = rows
    .map((row) => (typeof row.metadata?.sequence_count === "number" ? row.metadata.sequence_count : null))
    .filter((value): value is number => value !== null && value >= 1);
  return counts.length ? Math.max(...counts) : null;
}

export function missingSequenceIndexes(expectedCount: number | null, rows: Array<Pick<ClientAssetRow, "sequence_index">>): number[] {
  if (!expectedCount || expectedCount < 1) return [];
  const present = new Set(rows.map((row) => row.sequence_index));
  const missing: number[] = [];
  for (let index = 1; index <= expectedCount; index += 1) {
    if (!present.has(index)) missing.push(index);
  }
  return missing;
}

export function warningFingerprint(input: {
  code: AssetWarningCode;
  expectedCount: number | null;
  actualCount: number;
  jobId?: string | null;
  jobStatus?: string | null;
  missingIndexes: number[];
}): string {
  return [
    input.code,
    `expected:${input.expectedCount ?? "unknown"}`,
    `actual:${input.actualCount}`,
    `job:${input.jobId ?? "none"}`,
    `status:${input.jobStatus ?? "none"}`,
    `missing:${input.missingIndexes.join(",") || "none"}`,
  ].join("|");
}

export function resolveAssetCompleteness(input: {
  rows: ClientAssetRow[];
  job?: AssetGenerationJobRow | null;
  override?: AssetGroupCompletenessOverrideRow | null;
  acknowledgements?: AssetWarningAcknowledgementRow[];
}): AssetCompletenessState {
  const rows = [...input.rows].sort((a, b) => a.sequence_index - b.sequence_index);
  const first = rows[0];
  const isMulti = first ? MULTI_IMAGE_FORMATS.has(first.asset_format) : false;
  const job = input.job ?? null;
  const override = input.override && input.override.is_active && !input.override.revoked_at ? input.override : null;
  const actualCurrentCount = rows.length;
  const originalExpectedCount = expectedGroupCount(rows, job);
  const uniqueSequenceCount = new Set(rows.map((row) => row.sequence_index)).size;
  const hasDuplicateSequence = uniqueSequenceCount !== rows.length;
  const acceptedSequenceIndexes = override?.accepted_sequence_indexes ?? [];
  const acceptedOutputCount = override?.accepted_output_count ?? null;
  const effectiveExpectedCount = override ? override.accepted_output_count : originalExpectedCount;
  const missingIndexes = override?.missing_sequence_indexes ?? missingSequenceIndexes(originalExpectedCount, rows);
  const isGenerating = !!job && job.status === "queued" || !!job && job.status === "processing";
  const jobIncomplete = !!job && job.status !== "complete" && !override;
  const normalIncomplete = isMulti && originalExpectedCount !== null && actualCurrentCount < originalExpectedCount;
  const overrideSequenceValid = !override || (
    acceptedSequenceIndexes.length === actualCurrentCount
    && new Set(acceptedSequenceIndexes).size === acceptedSequenceIndexes.length
    && !hasDuplicateSequence
    && acceptedSequenceIndexes.every((seq) => rows.some((row) => row.sequence_index === seq))
    && rows.every((row) => acceptedSequenceIndexes.includes(row.sequence_index))
  );
  const isAcceptedPartial = !!override && overrideSequenceValid;
  const isIncomplete = isAcceptedPartial ? false : (normalIncomplete || jobIncomplete);
  const canApproveCompleteness = actualCurrentCount > 0 && !hasDuplicateSequence && !isGenerating && !isIncomplete && overrideSequenceValid;

  const dismissed = new Set((input.acknowledgements ?? []).map((ack) => `${ack.warning_code}:${ack.warning_fingerprint}`));
  const allWarnings: AssetCompletenessWarning[] = [];
  if (!isAcceptedPartial) {
    if (isGenerating) {
      const code: AssetWarningCode = "generation_in_progress";
      const fingerprint = warningFingerprint({ code, expectedCount: originalExpectedCount, actualCount: actualCurrentCount, jobId: job?.id, jobStatus: job?.status, missingIndexes });
      allWarnings.push({
        code,
        fingerprint,
        dismissed: dismissed.has(`${code}:${fingerprint}`),
        message: `Generation in progress — ${job?.completed_output_count ?? actualCurrentCount} of ${job?.expected_output_count ?? originalExpectedCount ?? "?"} ${first?.asset_format === "carousel" ? "slides" : "frames"} so far.`,
      });
    } else if (isIncomplete) {
      const code: AssetWarningCode = "expected_count_mismatch";
      const fingerprint = warningFingerprint({ code, expectedCount: originalExpectedCount, actualCount: actualCurrentCount, jobId: job?.id, jobStatus: job?.status, missingIndexes });
      allWarnings.push({
        code,
        fingerprint,
        dismissed: dismissed.has(`${code}:${fingerprint}`),
        message: `Expected ${originalExpectedCount ?? job?.expected_output_count ?? "?"} ${first?.asset_format === "carousel" ? "slides" : "frames"}; found ${actualCurrentCount}.`,
      });
    }
  }

  return {
    originalExpectedCount,
    actualCurrentCount,
    activeOverride: override,
    acceptedOutputCount,
    acceptedSequenceIndexes,
    effectiveExpectedCount,
    missingIndexes,
    isGenerating,
    isIncomplete,
    isAcceptedPartial,
    canApproveCompleteness,
    allWarnings,
    visibleWarnings: allWarnings.filter((warning) => !warning.dismissed),
  };
}
