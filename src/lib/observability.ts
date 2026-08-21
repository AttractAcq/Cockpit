// Programme Stage O — Multi-Client Scale and Operational Control:
// observability aggregation. Pure functions over already-fetched rows from
// real tables (client_publish_attempts, client_exception_queue,
// client_work_items) — no network, no database, so the numbers on the
// operator dashboard are exactly what these functions compute from real
// evidence, never a separately-maintained (and driftable) counter.

export interface PublishAttemptLike {
  result: string; // 'published' | 'permanent_failure' | 'retryable_failure' | 'skipped' | 'started'
  completed_at: string | null;
  started_at: string;
}

export interface PublishSuccessRate {
  totalAttempts: number;
  terminalAttempts: number; // excludes 'started' (still in progress)
  published: number;
  permanentFailures: number;
  successRate: number | null; // null when there are no terminal attempts to compute a rate from
}

/**
 * "Publishing success" observability metric. Only 'published' and
 * 'permanent_failure' are terminal outcomes counted toward the rate —
 * 'retryable_failure'/'skipped'/'started' are still in flight and would
 * distort the rate if counted as failures before they're actually decided.
 */
export function computePublishSuccessRate(attempts: readonly PublishAttemptLike[]): PublishSuccessRate {
  const published = attempts.filter((a) => a.result === "published").length;
  const permanentFailures = attempts.filter((a) => a.result === "permanent_failure").length;
  const terminalAttempts = published + permanentFailures;
  return {
    totalAttempts: attempts.length, terminalAttempts, published, permanentFailures,
    successRate: terminalAttempts > 0 ? Math.round((published / terminalAttempts) * 1000) / 10 : null,
  };
}

export interface ExceptionLike {
  status: string; // 'open' | 'acknowledged' | 'resolved'
  severity: string; // 'low' | 'medium' | 'high'
  created_at: string;
}

export interface FailureRateSummary {
  openCount: number;
  acknowledgedCount: number;
  resolvedCount: number;
  highSeverityOpenCount: number;
}

/** "Failure rate" observability metric, from the real exception queue (Stage N). */
export function summariseExceptions(exceptions: readonly ExceptionLike[]): FailureRateSummary {
  return {
    openCount: exceptions.filter((e) => e.status === "open").length,
    acknowledgedCount: exceptions.filter((e) => e.status === "acknowledged").length,
    resolvedCount: exceptions.filter((e) => e.status === "resolved").length,
    highSeverityOpenCount: exceptions.filter((e) => e.status !== "resolved" && e.severity === "high").length,
  };
}

/**
 * "Queue age": how long an unresolved item (exception or open work item)
 * has been waiting, in hours, as of `now`. Never negative — a clock skew or
 * future-dated row clamps to zero rather than reporting a nonsensical
 * negative age.
 */
export function ageInHours(createdAt: string, now: Date = new Date()): number {
  const created = new Date(createdAt).getTime();
  const elapsedMs = Math.max(0, now.getTime() - created);
  return Math.round((elapsedMs / 3_600_000) * 10) / 10;
}

export interface AgeableItem {
  created_at: string;
  status: string;
}

export interface QueueAgeSummary {
  openCount: number;
  oldestAgeHours: number | null;
  averageAgeHours: number | null;
}

/** Queue-age summary over any list of items with created_at/status, counting only unresolved ones. */
export function summariseQueueAge(items: readonly AgeableItem[], resolvedStatuses: readonly string[], now: Date = new Date()): QueueAgeSummary {
  const open = items.filter((item) => !resolvedStatuses.includes(item.status));
  if (open.length === 0) return { openCount: 0, oldestAgeHours: null, averageAgeHours: null };
  const ages = open.map((item) => ageInHours(item.created_at, now));
  return {
    openCount: open.length,
    oldestAgeHours: Math.max(...ages),
    averageAgeHours: Math.round((ages.reduce((sum, age) => sum + age, 0) / ages.length) * 10) / 10,
  };
}

export interface WorkItemLike {
  status: string;
  due_at: string | null;
  priority: string;
}

export interface ApprovalDelaySummary {
  overdueCount: number;
  dueSoonCount: number; // due within 24h, not yet overdue
}

/** "Approval delays": open/in_progress/blocked/review work items past or nearing their due date. */
export function summariseApprovalDelays(items: readonly WorkItemLike[], now: Date = new Date()): ApprovalDelaySummary {
  const active = items.filter((item) => item.status !== "done");
  let overdueCount = 0;
  let dueSoonCount = 0;
  for (const item of active) {
    if (!item.due_at) continue;
    const dueAt = new Date(item.due_at).getTime();
    const hoursUntilDue = (dueAt - now.getTime()) / 3_600_000;
    if (hoursUntilDue < 0) overdueCount += 1;
    else if (hoursUntilDue <= 24) dueSoonCount += 1;
  }
  return { overdueCount, dueSoonCount };
}

export interface SalesLeadLike {
  stage: string; // SalesLeadStage -- kept as string here so this stays a dependency-free pure function
  estimated_value_cents: number | null;
}

export interface SalesPipelineSummary {
  openCount: number;
  openValueCents: number;
  wonCount: number;
  wonValueCents: number;
}

const CLOSED_STAGES = new Set(["closed_won", "closed_lost"]);

/**
 * Cockpit v3 Step 4 — Overview's "Business Health" pipeline tile. Sums real
 * sales_leads estimated_value_cents (nulls count as 0, never dropped from
 * openCount) rather than inventing a forecast figure this schema doesn't
 * carry yet.
 */
export function summariseSalesPipeline(leads: readonly SalesLeadLike[]): SalesPipelineSummary {
  const open = leads.filter((l) => !CLOSED_STAGES.has(l.stage));
  const won = leads.filter((l) => l.stage === "closed_won");
  const sum = (items: readonly SalesLeadLike[]) => items.reduce((total, l) => total + (l.estimated_value_cents ?? 0), 0);
  return {
    openCount: open.length,
    openValueCents: sum(open),
    wonCount: won.length,
    wonValueCents: sum(won),
  };
}
