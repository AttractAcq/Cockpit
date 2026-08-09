// Programme Stage N — Automation and Fulfilment Orchestration: the
// automation-policy gate and deterministic capacity allocation. Pure
// decision functions, matching the established capability-check pattern
// (_shared/publish-capability.ts, _shared/distribution-policy.ts,
// _shared/ad-safety-policy.ts): the gate decides, it never mutates state,
// and it never calls a provider.
//
// All pure/testable — no database or network dependency.

export type AutomationLevel = "manual" | "assisted" | "automatic";
export type AutomationArea =
  | "source_processing" | "opportunity_generation" | "scoring" | "weekly_planning" | "proposal_approval"
  | "brief_generation" | "production_start" | "human_review" | "client_review" | "scheduling" | "publishing"
  | "analytics_collection" | "iteration_generation" | "paid_campaign_actions";

/** No policy row for an area means "automatic" — the same unrestricted behaviour every affected system already has today (see the migration comment). */
export const DEFAULT_AUTOMATION_LEVEL: AutomationLevel = "automatic";

export interface AutomationGateResult {
  allowed: boolean;
  code: "OK" | "MANUAL_MODE_BLOCKS_AUTOMATIC_ATTEMPT" | "ASSISTED_MODE_REQUIRES_APPROVAL";
  reason: string | null;
}

/**
 * "Automatic jobs cannot bypass approval policy": an unattended worker
 * (isAutomaticAttempt = true) may proceed only when the area's level is
 * "automatic". "manual" and "assisted" both require a human in the loop —
 * they differ only in whether Cockpit has already prepared the work
 * (assisted) or not (manual), which is a UI/UX distinction this gate does
 * not need to know about to make the correct pass/fail decision.
 */
export function checkAutomationGate(level: AutomationLevel, isAutomaticAttempt: boolean): AutomationGateResult {
  if (!isAutomaticAttempt) return { allowed: true, code: "OK", reason: null };
  if (level === "automatic") return { allowed: true, code: "OK", reason: null };
  if (level === "manual") {
    return { allowed: false, code: "MANUAL_MODE_BLOCKS_AUTOMATIC_ATTEMPT", reason: "This area is set to Manual — an operator must start this action." };
  }
  return { allowed: false, code: "ASSISTED_MODE_REQUIRES_APPROVAL", reason: "This area is set to Assisted — Cockpit may prepare the work, but an operator must approve it before it executes." };
}

/**
 * "Retry caps are enforced": a policy's retry_cap (1-20, DB-enforced) wins
 * over the fallback when present. A missing/invalid policy value falls
 * back to the caller's existing default (e.g. process-scheduled-
 * publishing's own MAX_ATTEMPTS = 5) rather than failing closed or open —
 * exactly the "no policy = current behaviour" rule the rest of this stage
 * follows.
 */
export function resolveRetryCap(policyRetryCap: number | null | undefined, fallback: number): number {
  if (typeof policyRetryCap === "number" && Number.isFinite(policyRetryCap) && policyRetryCap >= 1) return policyRetryCap;
  return fallback;
}

export type ClientPriority = "low" | "normal" | "high";
const PRIORITY_RANK: Record<ClientPriority, number> = { high: 0, normal: 1, low: 2 };

export interface CapacityCandidate {
  clientId: string;
  priority: ClientPriority;
  dueAt: string | null;
}

export interface CapacityAllocationResult {
  clientId: string;
  allocated: boolean;
}

/**
 * "Cross-client capacity allocation is deterministic": ranks candidates by
 * priority (high > normal > low), then by due date (earlier first, nulls
 * last), then by clientId (a stable final tiebreaker so two candidates that
 * are otherwise identical always sort the same way run to run) — grants a
 * slot to the first maxSimultaneousJobs, in that exact order. A negative or
 * zero cap allocates nothing; an unset cap (null/undefined) allocates
 * everything, matching "no policy = unrestricted."
 */
export function allocateCapacity(candidates: readonly CapacityCandidate[], maxSimultaneousJobs: number | null | undefined): CapacityAllocationResult[] {
  const ranked = [...candidates].sort((a, b) => {
    const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    return a.clientId.localeCompare(b.clientId);
  });
  const cap = typeof maxSimultaneousJobs === "number" && Number.isFinite(maxSimultaneousJobs) ? Math.max(0, maxSimultaneousJobs) : Infinity;
  return ranked.map((candidate, index) => ({ clientId: candidate.clientId, allocated: index < cap }));
}
