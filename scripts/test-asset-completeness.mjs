import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../src/lib/asset-completeness.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const context = {
  exports: {},
  require(specifier) {
    if (specifier.startsWith("@/types/")) return {};
    throw new Error(`Unexpected import: ${specifier}`);
  },
};
vm.runInNewContext(compiled, context);

const {
  resolveAssetCompleteness,
  warningFingerprint,
  missingSequenceIndexes,
} = context.exports;

function asset(sequence, metadata = {}) {
  return {
    id: `asset-${sequence}`,
    client_id: "client1",
    production_brief_id: "brief1",
    source_ref: "SRC-1",
    asset_format: "carousel",
    asset_group_ref: "group1",
    sequence_index: sequence,
    status: "needs_review",
    is_current: true,
    metadata: { sequence_count: 5, ...metadata },
  };
}

function job(overrides = {}) {
  return {
    id: "job1",
    client_id: "client1",
    production_brief_id: "brief1",
    source_ref: "SRC-1",
    asset_group_ref: "group1",
    asset_format: "carousel",
    expected_output_count: 5,
    completed_output_count: 4,
    status: "partial",
    ...overrides,
  };
}

const fourOfFive = [asset(1), asset(2), asset(3), asset(4)];
assert.equal(JSON.stringify(missingSequenceIndexes(5, fourOfFive)), JSON.stringify([5]));

let state = resolveAssetCompleteness({ rows: fourOfFive, job: job() });
assert.equal(state.originalExpectedCount, 5);
assert.equal(state.actualCurrentCount, 4);
assert.equal(state.isIncomplete, true);
assert.equal(state.canApproveCompleteness, false);
assert.equal(state.visibleWarnings.length, 1);

const fingerprint = warningFingerprint({
  code: "expected_count_mismatch",
  expectedCount: 5,
  actualCount: 4,
  jobId: "job1",
  jobStatus: "partial",
  missingIndexes: [5],
});
state = resolveAssetCompleteness({
  rows: fourOfFive,
  job: job(),
  acknowledgements: [{
    id: "ack1",
    client_id: "client1",
    asset_group_ref: "group1",
    warning_code: "expected_count_mismatch",
    warning_fingerprint: fingerprint,
    dismissed_by: "user1",
    dismissed_at: "2026-07-17T00:00:00Z",
    created_at: "2026-07-17T00:00:00Z",
  }],
});
assert.equal(state.visibleWarnings.length, 0);
assert.equal(state.allWarnings[0].dismissed, true);
assert.equal(state.canApproveCompleteness, false, "dismissal does not enable approval");

const changed = warningFingerprint({
  code: "expected_count_mismatch",
  expectedCount: 5,
  actualCount: 3,
  jobId: "job1",
  jobStatus: "partial",
  missingIndexes: [4, 5],
});
assert.notEqual(changed, fingerprint, "changed actual count changes fingerprint");
assert.notEqual(warningFingerprint({
  code: "expected_count_mismatch",
  expectedCount: 6,
  actualCount: 4,
  jobId: "job1",
  jobStatus: "partial",
  missingIndexes: [5, 6],
}), fingerprint, "changed expected count changes fingerprint");
assert.notEqual(warningFingerprint({
  code: "expected_count_mismatch",
  expectedCount: 5,
  actualCount: 4,
  jobId: "job1",
  jobStatus: "failed",
  missingIndexes: [5],
}), fingerprint, "changed job status changes fingerprint");
assert.notEqual(warningFingerprint({
  code: "expected_count_mismatch",
  expectedCount: 5,
  actualCount: 4,
  jobId: "job1",
  jobStatus: "partial",
  missingIndexes: [4],
}), fingerprint, "changed missing indexes changes fingerprint");

state = resolveAssetCompleteness({
  rows: fourOfFive,
  job: job({ closed_at: "2026-07-17T00:00:00Z", closure_type: "partial_accepted", accepted_partial: true }),
  override: {
    id: "override1",
    client_id: "client1",
    asset_group_ref: "group1",
    generation_job_id: "job1",
    production_brief_id: "brief1",
    original_expected_count: 5,
    actual_count_at_acceptance: 4,
    accepted_output_count: 4,
    accepted_sequence_indexes: [1, 2, 3, 4],
    missing_sequence_indexes: [5],
    override_reason: "Approved as an intentional four-frame sequence.",
    overridden_by: "user1",
    overridden_at: "2026-07-17T00:00:00Z",
    source_job_status: "partial",
    source_job_snapshot: {},
    is_active: true,
    revoked_at: null,
    revoked_by: null,
    revoked_reason: null,
    created_at: "2026-07-17T00:00:00Z",
  },
});
assert.equal(state.isAcceptedPartial, true);
assert.equal(state.isIncomplete, false);
assert.equal(state.effectiveExpectedCount, 4);
assert.equal(state.canApproveCompleteness, true);
assert.equal(JSON.stringify(state.missingIndexes), JSON.stringify([5]));

state = resolveAssetCompleteness({
  rows: [asset(1), asset(2), asset(4)],
  job: job({ closed_at: "2026-07-17T00:00:00Z", closure_type: "partial_accepted", accepted_partial: true }),
  override: {
    id: "override1",
    client_id: "client1",
    asset_group_ref: "group1",
    generation_job_id: "job1",
    production_brief_id: "brief1",
    original_expected_count: 5,
    actual_count_at_acceptance: 4,
    accepted_output_count: 4,
    accepted_sequence_indexes: [1, 2, 3, 4],
    missing_sequence_indexes: [5],
    override_reason: "Approved as an intentional four-frame sequence.",
    overridden_by: "user1",
    overridden_at: "2026-07-17T00:00:00Z",
    source_job_status: "partial",
    source_job_snapshot: {},
    is_active: true,
    revoked_at: null,
    revoked_by: null,
    revoked_reason: null,
    created_at: "2026-07-17T00:00:00Z",
  },
});
assert.equal(state.canApproveCompleteness, false, "removed accepted frame blocks approval");

state = resolveAssetCompleteness({
  rows: [asset(1), asset(2), asset(3), asset(4), asset(5)],
  job: job({ status: "complete", completed_output_count: 5 }),
});
assert.equal(state.isIncomplete, false);
assert.equal(state.canApproveCompleteness, true, "complete group is normally approvable and should not need partial acceptance");

state = resolveAssetCompleteness({
  rows: [asset(1), asset(2), asset(3), asset(4), asset(5)],
  job: job({ closed_at: "2026-07-17T00:00:00Z", closure_type: "partial_accepted", accepted_partial: true }),
  override: {
    id: "override1",
    client_id: "client1",
    asset_group_ref: "group1",
    generation_job_id: "job1",
    production_brief_id: "brief1",
    original_expected_count: 5,
    actual_count_at_acceptance: 4,
    accepted_output_count: 4,
    accepted_sequence_indexes: [1, 2, 3, 4],
    missing_sequence_indexes: [5],
    override_reason: "Approved as an intentional four-frame sequence.",
    overridden_by: "user1",
    overridden_at: "2026-07-17T00:00:00Z",
    source_job_status: "partial",
    source_job_snapshot: {},
    is_active: true,
    revoked_at: null,
    revoked_by: null,
    revoked_reason: null,
    created_at: "2026-07-17T00:00:00Z",
  },
});
assert.equal(state.canApproveCompleteness, false, "unexpected extra frame invalidates active override");

state = resolveAssetCompleteness({
  rows: [asset(1), asset(1), asset(2), asset(3)],
  job: job({ closed_at: "2026-07-17T00:00:00Z", closure_type: "partial_accepted", accepted_partial: true }),
  override: {
    id: "override1",
    client_id: "client1",
    asset_group_ref: "group1",
    generation_job_id: "job1",
    production_brief_id: "brief1",
    original_expected_count: 5,
    actual_count_at_acceptance: 4,
    accepted_output_count: 4,
    accepted_sequence_indexes: [1, 2, 3, 4],
    missing_sequence_indexes: [5],
    override_reason: "Approved as an intentional four-frame sequence.",
    overridden_by: "user1",
    overridden_at: "2026-07-17T00:00:00Z",
    source_job_status: "partial",
    source_job_snapshot: {},
    is_active: true,
    revoked_at: null,
    revoked_by: null,
    revoked_reason: null,
    created_at: "2026-07-17T00:00:00Z",
  },
});
assert.equal(state.canApproveCompleteness, false, "duplicate sequence invalidates approval");

console.log("asset-completeness tests passed");
