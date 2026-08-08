// Programme Stage K — Organic Distribution Consolidation: per-client
// approval policy (internal-only vs client-approval-required, auto-schedule,
// manual-publish-only, blackout periods, restricted weekdays).
//
// All pure/testable — no database or network dependency. The gate decides
// whether a schedule/publish attempt is ALLOWED; it never mutates state
// itself, matching the existing capability-check pattern
// (_shared/publish-capability.ts) where the check is separate from the
// action.

export type ApprovalMode = "internal_only" | "client_approval_required";

export interface BlackoutPeriod {
  start_date: string; // YYYY-MM-DD, inclusive
  end_date: string;   // YYYY-MM-DD, inclusive
  reason: string;
}

export interface ClientDistributionPolicy {
  approvalMode: ApprovalMode;
  autoScheduleAfterApproval: boolean;
  manualPublishOnly: boolean;
  blackoutPeriods: BlackoutPeriod[];
  restrictedWeekdays: number[]; // 0 (Sunday) - 6 (Saturday)
}

/** The policy a client with no explicit row gets: least restrictive, matching current behaviour before this stage. */
export const DEFAULT_DISTRIBUTION_POLICY: ClientDistributionPolicy = {
  approvalMode: "internal_only",
  autoScheduleAfterApproval: false,
  manualPublishOnly: false,
  blackoutPeriods: [],
  restrictedWeekdays: [],
};

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function validateBlackoutPeriods(raw: unknown): BlackoutPeriod[] | null {
  if (!Array.isArray(raw)) return null;
  const periods: BlackoutPeriod[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) return null;
    const row = entry as Record<string, unknown>;
    if (!isValidDateString(row.start_date) || !isValidDateString(row.end_date)) return null;
    if (row.start_date > row.end_date) return null;
    if (typeof row.reason !== "string" || row.reason.trim().length === 0) return null;
    periods.push({ start_date: row.start_date, end_date: row.end_date, reason: row.reason });
  }
  return periods;
}

export function validateRestrictedWeekdays(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const days: number[] = [];
  for (const entry of raw) {
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry > 6) return null;
    days.push(entry);
  }
  return [...new Set(days)].sort((a, b) => a - b);
}

export interface ScheduleCheckResult {
  allowed: boolean;
  reason: string | null;
}

const OK: ScheduleCheckResult = { allowed: true, reason: null };

/**
 * Whether a given scheduled publish moment is allowed by the client's
 * blackout periods and restricted weekdays. Dates are compared in UTC —
 * scheduled_publish_at is stored as a timestamptz, and the blackout
 * boundaries are calendar dates, so the check uses the UTC calendar date of
 * the scheduled moment (the same convention the existing Distribution
 * Calendar already uses for date grouping).
 */
export function checkScheduleAllowed(policy: ClientDistributionPolicy, scheduledAtIso: string): ScheduleCheckResult {
  const scheduled = new Date(scheduledAtIso);
  if (Number.isNaN(scheduled.getTime())) {
    return { allowed: false, reason: "scheduled_publish_at is not a valid date." };
  }
  const dateOnly = scheduled.toISOString().slice(0, 10);
  const weekday = scheduled.getUTCDay();

  if (policy.restrictedWeekdays.includes(weekday)) {
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return { allowed: false, reason: `Publishing is restricted on ${names[weekday]}s for this client.` };
  }

  for (const period of policy.blackoutPeriods) {
    if (dateOnly >= period.start_date && dateOnly <= period.end_date) {
      return { allowed: false, reason: `${dateOnly} falls inside a blackout period (${period.start_date} to ${period.end_date}): ${period.reason}` };
    }
  }

  return OK;
}

/**
 * Whether scheduling/publishing may proceed given the client's approval
 * mode. `internal_only` never blocks here — AA's own approval already
 * happened upstream (Content Brief approval, Stage H). `client_approval_
 * required` blocks until the client has explicitly approved this specific
 * record — never inferred from AA's own internal approval.
 */
export function checkApprovalModeGate(policy: ClientDistributionPolicy, record: { clientApprovedAt: string | null }): ScheduleCheckResult {
  if (policy.approvalMode === "internal_only") return OK;
  if (record.clientApprovedAt) return OK;
  return { allowed: false, reason: "This client's policy requires explicit client approval before scheduling or publishing. No client approval is recorded for this record." };
}

/**
 * Whether a record may move directly from "Content Brief approved" to
 * "scheduled" without an explicit operator scheduling action.
 * auto_schedule_after_approval only fires once the approval-mode gate above
 * also passes — a client-approval-required policy can still auto-schedule,
 * but only after the client has actually approved.
 */
export function checkAutoScheduleAllowed(policy: ClientDistributionPolicy, record: { clientApprovedAt: string | null }): ScheduleCheckResult {
  if (!policy.autoScheduleAfterApproval) {
    return { allowed: false, reason: "auto_schedule_after_approval is not enabled for this client." };
  }
  if (policy.manualPublishOnly) {
    return { allowed: false, reason: "This client's policy requires manual publish; auto-schedule is disabled." };
  }
  return checkApprovalModeGate(policy, record);
}
