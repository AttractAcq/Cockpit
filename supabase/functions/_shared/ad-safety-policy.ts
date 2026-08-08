// Programme Stage L — the safety policy every campaign launch, budget
// change, or resume is gated by. Every check here is a pure decision
// function separate from the action it gates, matching the established
// capability-check pattern (_shared/publish-capability.ts,
// _shared/distribution-policy.ts): the gate decides, it never mutates
// state, and it never calls Meta.
//
// All pure/testable — no database or network dependency.

export interface AdBudgetPolicy {
  adAccountId: string | null;
  adAccountOwnerVerified: boolean;
  paymentMethodVerified: boolean;
  spendLimitDaily: number | null;
  spendLimitTotal: number | null;
  requiresClientApproval: boolean;
  allowedGeographies: string[];
  restrictedAudienceFlags: string[];
  regulatedCategories: string[];
}

export const NO_POLICY: AdBudgetPolicy = {
  adAccountId: null,
  adAccountOwnerVerified: false,
  paymentMethodVerified: false,
  spendLimitDaily: null,
  spendLimitTotal: null,
  requiresClientApproval: true,
  allowedGeographies: [],
  restrictedAudienceFlags: [],
  regulatedCategories: [],
};

export interface PolicyGateResult {
  allowed: boolean;
  code: string | null;
  reason: string | null;
}

const OK: PolicyGateResult = { allowed: true, code: null, reason: null };
function blocked(code: string, reason: string): PolicyGateResult {
  return { allowed: false, code, reason };
}

/** "Account ownership is validated": a launch can never proceed on an unverified or unset ad account. */
export function checkAccountOwnershipPolicy(policy: AdBudgetPolicy): PolicyGateResult {
  if (!policy.adAccountId) return blocked("NO_AD_ACCOUNT", "No Meta ad account is configured for this client.");
  if (!policy.adAccountOwnerVerified) return blocked("ACCOUNT_OWNERSHIP_UNVERIFIED", "The configured ad account's ownership has not been verified.");
  return OK;
}

export function checkPaymentMethodPolicy(policy: AdBudgetPolicy): PolicyGateResult {
  if (!policy.paymentMethodVerified) return blocked("PAYMENT_METHOD_UNVERIFIED", "No verified payment method is on file for this client's ad account.");
  return OK;
}

/** "Budget cannot exceed configured limit": both daily and total requested spend are checked against the policy. */
export function checkSpendLimitPolicy(policy: AdBudgetPolicy, requestedBudgetDaily: number | null, requestedBudgetTotal: number | null): PolicyGateResult {
  if (policy.spendLimitDaily === null && policy.spendLimitTotal === null) {
    return blocked("NO_SPEND_LIMIT_CONFIGURED", "No spend limit is configured for this client. A policy must set an explicit limit before any campaign can launch.");
  }
  if (requestedBudgetDaily !== null && policy.spendLimitDaily !== null && requestedBudgetDaily > policy.spendLimitDaily) {
    return blocked("DAILY_BUDGET_EXCEEDS_LIMIT", `Requested daily budget ${requestedBudgetDaily} exceeds the configured limit of ${policy.spendLimitDaily}.`);
  }
  if (requestedBudgetTotal !== null && policy.spendLimitTotal !== null && requestedBudgetTotal > policy.spendLimitTotal) {
    return blocked("TOTAL_BUDGET_EXCEEDS_LIMIT", `Requested total budget ${requestedBudgetTotal} exceeds the configured limit of ${policy.spendLimitTotal}.`);
  }
  return OK;
}

/**
 * Fails closed if no geographies are configured — spending with no explicit
 * geographic scope is exactly the kind of unconfigured launch this gate
 * exists to prevent.
 */
export function checkGeographyPolicy(policy: AdBudgetPolicy, requestedGeographies: string[]): PolicyGateResult {
  if (policy.allowedGeographies.length === 0) {
    return blocked("NO_GEOGRAPHY_CONFIGURED", "No allowed geographies are configured for this client.");
  }
  const disallowed = requestedGeographies.filter((g) => !policy.allowedGeographies.includes(g));
  if (disallowed.length > 0) {
    return blocked("GEOGRAPHY_NOT_ALLOWED", `Geograph${disallowed.length === 1 ? "y" : "ies"} not allowed for this client: ${disallowed.join(", ")}.`);
  }
  return OK;
}

export function checkAudienceRestrictionPolicy(policy: AdBudgetPolicy, requestedAudienceFlags: string[]): PolicyGateResult {
  const violated = requestedAudienceFlags.filter((f) => policy.restrictedAudienceFlags.includes(f));
  if (violated.length > 0) {
    return blocked("RESTRICTED_AUDIENCE", `This client's policy restricts the following audience flag(s): ${violated.join(", ")}.`);
  }
  return OK;
}

/** "No live spend without explicit approved policy": client approval, when required, must be recorded on the campaign itself — never inferred. */
export function checkClientApprovalPolicy(policy: AdBudgetPolicy, campaign: { clientApprovedAt: string | null }): PolicyGateResult {
  if (!policy.requiresClientApproval) return OK;
  if (campaign.clientApprovedAt) return OK;
  return blocked("CLIENT_APPROVAL_REQUIRED", "This client's policy requires explicit client approval before a campaign can launch. No approval is recorded.");
}

/** A regulated category (e.g. financial services, health) requires an explicit, separately-recorded acknowledgement — never assumed from general approval. */
export function checkRegulatedCategoryPolicy(policy: AdBudgetPolicy, category: string | null, acknowledged: boolean): PolicyGateResult {
  if (!category) return OK;
  if (!policy.regulatedCategories.includes(category)) return OK;
  if (!acknowledged) {
    return blocked("REGULATED_CATEGORY_UNACKNOWLEDGED", `"${category}" is a regulated category for this client and requires explicit acknowledgement before launch.`);
  }
  return OK;
}

export interface LaunchPolicyInput {
  policy: AdBudgetPolicy;
  campaign: { clientApprovedAt: string | null; budgetDaily: number | null; budgetTotal: number | null };
  requestedGeographies: string[];
  requestedAudienceFlags: string[];
  regulatedCategory: string | null;
  regulatedCategoryAcknowledged: boolean;
}

/**
 * The single combined gate `launch-ad-campaign` calls. Runs every safety
 * check in a fixed order and returns the FIRST failure — a launch attempt
 * is blocked by the first thing wrong with it, never partially evaluated.
 */
export function checkLaunchPolicy(input: LaunchPolicyInput): PolicyGateResult {
  const checks: PolicyGateResult[] = [
    checkAccountOwnershipPolicy(input.policy),
    checkPaymentMethodPolicy(input.policy),
    checkSpendLimitPolicy(input.policy, input.campaign.budgetDaily, input.campaign.budgetTotal),
    checkGeographyPolicy(input.policy, input.requestedGeographies),
    checkAudienceRestrictionPolicy(input.policy, input.requestedAudienceFlags),
    checkClientApprovalPolicy(input.policy, input.campaign),
    checkRegulatedCategoryPolicy(input.policy, input.regulatedCategory, input.regulatedCategoryAcknowledged),
  ];
  for (const result of checks) {
    if (!result.allowed) return result;
  }
  return OK;
}
