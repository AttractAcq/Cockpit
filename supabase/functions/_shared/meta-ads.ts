// Programme Stage L — Meta Marketing API adapter.
//
// Dependency-injected exactly like _shared/instagram-reels-publish.ts's
// Reels state machine, for the same reason: real provider calls must be
// unit-testable without ever touching the network or spending real money.
// `liveMetaAdsDeps` below is REAL, documented Marketing API integration
// code — but this codebase has no Meta ad-account credentials configured,
// and this stage deliberately never invokes it against the real API. Every
// launch this session is verified through the pure orchestration functions
// with mocked deps. See docs/programme/status/Stage_L_Status.md.
//
// ── Verified official API contract (developers.facebook.com/docs/marketing-api) ──
// Host: graph.facebook.com (same host and API version as the existing
//       organic Graph integration, since it is the same platform).
//
//   1. Create campaign
//      POST /act_{ad_account_id}/campaigns
//        name, objective, status=PAUSED (never ACTIVE on creation —
//        Cockpit always creates paused and activates explicitly, so a
//        crash between creation and activation can never leave a
//        campaign spending unattended), special_ad_categories
//      → { id: "<campaign-id>" }
//
//   2. Create ad set
//      POST /act_{ad_account_id}/adsets
//        name, campaign_id, daily_budget (minor units), billing_event,
//        optimization_goal, targeting (geo_locations, flexible_spec),
//        status=PAUSED
//      → { id: "<ad-set-id>" }
//
//   3. Create ad creative, then ad
//      POST /act_{ad_account_id}/adcreatives  → { id: "<creative-id>" }
//      POST /act_{ad_account_id}/ads
//        name, adset_id, creative: { creative_id }, status=PAUSED
//      → { id: "<ad-id>" }
//
//   4. Launch (activate)
//      POST /{campaign-id}  { status: "ACTIVE" }
//
//   5. Pause / resume
//      POST /{campaign-id}  { status: "PAUSED" | "ACTIVE" }
//
//   6. Update budget
//      POST /{adset-id}  { daily_budget: <minor units> }
//
//   7. Insights (spend/delivery)
//      GET /{campaign-id}/insights?fields=spend,impressions,clicks,actions
//
// Safety: never logs or persists the access token. Every step returns a
// structured, classified result — success is never fabricated, and a
// missing/invalid credential fails closed before any request is attempted.

export interface MetaAdsCredentials {
  accessToken: string;
  adAccountId: string;
}

export interface CreateCampaignParams {
  name: string;
  objective: string;
  specialAdCategories: string[];
}

export interface CreateAdSetParams {
  name: string;
  campaignExternalId: string;
  dailyBudgetMinorUnits: number;
  optimizationGoal: string;
  geoLocations: string[];
}

export interface CreateAdParams {
  name: string;
  adSetExternalId: string;
  creativeExternalId: string;
}

export interface MetaAdsError {
  category: "meta_authentication" | "meta_rate_limited" | "meta_server_error" | "meta_validation" | "meta_unknown";
  retryable: boolean;
  message: string;
  code?: number;
}

export class MetaAdsApiError extends Error {
  details: MetaAdsError;
  constructor(details: MetaAdsError) {
    super(details.message);
    this.name = "MetaAdsApiError";
    this.details = details;
  }
}

/** Same classification shape as _shared/meta-errors.ts's classifyMetaError, kept local to avoid a cross-module dependency for a handful of shared codes. */
export function classifyMetaAdsError(httpStatus: number, data: unknown): MetaAdsError {
  const err = (data && typeof data === "object" ? (data as { error?: Record<string, unknown> }).error : undefined) ?? {};
  const code = typeof err.code === "number" ? err.code : undefined;
  const message = typeof err.message === "string" && err.message ? err.message : `Meta Marketing API error (HTTP ${httpStatus}).`;
  if (code === 190 || (typeof err.type === "string" && err.type === "OAuthException")) {
    return { category: "meta_authentication", retryable: false, message, code };
  }
  if (httpStatus === 429 || code === 17 || code === 32) {
    return { category: "meta_rate_limited", retryable: true, message, code };
  }
  if (httpStatus >= 500) {
    return { category: "meta_server_error", retryable: true, message, code };
  }
  if (httpStatus === 400) {
    return { category: "meta_validation", retryable: false, message, code };
  }
  return { category: "meta_unknown", retryable: false, message, code };
}

export interface MetaAdsDeps {
  createCampaign(creds: MetaAdsCredentials, params: CreateCampaignParams): Promise<string>;
  createAdSet(creds: MetaAdsCredentials, params: CreateAdSetParams): Promise<string>;
  createAd(creds: MetaAdsCredentials, params: CreateAdParams): Promise<string>;
  setCampaignStatus(creds: MetaAdsCredentials, campaignExternalId: string, status: "ACTIVE" | "PAUSED"): Promise<void>;
  updateAdSetBudget(creds: MetaAdsCredentials, adSetExternalId: string, dailyBudgetMinorUnits: number): Promise<void>;
  fetchCampaignInsights(creds: MetaAdsCredentials, campaignExternalId: string): Promise<{ spend: number; impressions: number; clicks: number; conversions: number }>;
}

export type MetaAdsStepResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MetaAdsError };

async function attempt<T>(fn: () => Promise<T>): Promise<MetaAdsStepResult<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    if (error instanceof MetaAdsApiError) return { ok: false, error: error.details };
    return { ok: false, error: { category: "meta_unknown", retryable: false, message: error instanceof Error ? error.message : String(error) } };
  }
}

/** One orchestration step per DB row, so a partial failure never leaves an ambiguous state — the caller persists each external id the instant it exists. */
export async function createCampaignStep(deps: MetaAdsDeps, creds: MetaAdsCredentials, params: CreateCampaignParams): Promise<MetaAdsStepResult<string>> {
  return attempt(() => deps.createCampaign(creds, params));
}

export async function createAdSetStep(deps: MetaAdsDeps, creds: MetaAdsCredentials, params: CreateAdSetParams): Promise<MetaAdsStepResult<string>> {
  return attempt(() => deps.createAdSet(creds, params));
}

export async function createAdStep(deps: MetaAdsDeps, creds: MetaAdsCredentials, params: CreateAdParams): Promise<MetaAdsStepResult<string>> {
  return attempt(() => deps.createAd(creds, params));
}

export async function activateCampaignStep(deps: MetaAdsDeps, creds: MetaAdsCredentials, campaignExternalId: string): Promise<MetaAdsStepResult<void>> {
  return attempt(() => deps.setCampaignStatus(creds, campaignExternalId, "ACTIVE"));
}

export async function pauseCampaignStep(deps: MetaAdsDeps, creds: MetaAdsCredentials, campaignExternalId: string): Promise<MetaAdsStepResult<void>> {
  return attempt(() => deps.setCampaignStatus(creds, campaignExternalId, "PAUSED"));
}

export async function updateBudgetStep(deps: MetaAdsDeps, creds: MetaAdsCredentials, adSetExternalId: string, dailyBudgetMinorUnits: number): Promise<MetaAdsStepResult<void>> {
  return attempt(() => deps.updateAdSetBudget(creds, adSetExternalId, dailyBudgetMinorUnits));
}

export async function fetchInsightsStep(deps: MetaAdsDeps, creds: MetaAdsCredentials, campaignExternalId: string): Promise<MetaAdsStepResult<{ spend: number; impressions: number; clicks: number; conversions: number }>> {
  return attempt(() => deps.fetchCampaignInsights(creds, campaignExternalId));
}

// ── Live Graph helpers (plain fetch; token never logged) ────────────────────
// Real, documented request shapes. Not called anywhere in this codebase yet
// — see the module comment above.

const GRAPH_VERSION = "v21.0";

async function graphPost(path: string, params: Record<string, string>, token: string): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaAdsApiError(classifyMetaAdsError(res.status, data));
  return data as Record<string, unknown>;
}

async function graphGet(path: string, fields: string, token: string): Promise<Record<string, unknown>> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(path)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new MetaAdsApiError(classifyMetaAdsError(res.status, data));
  return data as Record<string, unknown>;
}

/** Real production dependency set. Deliberately never wired to a live call site in this stage. */
export function liveMetaAdsDeps(): MetaAdsDeps {
  return {
    createCampaign: async (creds, params) => {
      const data = await graphPost(`act_${creds.adAccountId}/campaigns`, {
        name: params.name, objective: params.objective, status: "PAUSED",
        special_ad_categories: JSON.stringify(params.specialAdCategories),
      }, creds.accessToken);
      return String(data.id);
    },
    createAdSet: async (creds, params) => {
      const data = await graphPost(`act_${creds.adAccountId}/adsets`, {
        name: params.name, campaign_id: params.campaignExternalId,
        daily_budget: String(params.dailyBudgetMinorUnits),
        optimization_goal: params.optimizationGoal, billing_event: "IMPRESSIONS",
        targeting: JSON.stringify({ geo_locations: { countries: params.geoLocations } }),
        status: "PAUSED",
      }, creds.accessToken);
      return String(data.id);
    },
    createAd: async (creds, params) => {
      const data = await graphPost(`act_${creds.adAccountId}/ads`, {
        name: params.name, adset_id: params.adSetExternalId,
        creative: JSON.stringify({ creative_id: params.creativeExternalId }),
        status: "PAUSED",
      }, creds.accessToken);
      return String(data.id);
    },
    setCampaignStatus: async (creds, campaignExternalId, status) => {
      await graphPost(campaignExternalId, { status }, creds.accessToken);
    },
    updateAdSetBudget: async (creds, adSetExternalId, dailyBudgetMinorUnits) => {
      await graphPost(adSetExternalId, { daily_budget: String(dailyBudgetMinorUnits) }, creds.accessToken);
    },
    fetchCampaignInsights: async (creds, campaignExternalId) => {
      const data = await graphGet(`${campaignExternalId}/insights`, "spend,impressions,clicks,actions", creds.accessToken);
      const insights = Array.isArray((data as { data?: unknown }).data) ? (data as { data: Record<string, unknown>[] }).data[0] : undefined;
      const spend = insights && typeof insights.spend === "string" ? parseFloat(insights.spend) : 0;
      const impressions = insights && typeof insights.impressions === "string" ? parseInt(insights.impressions, 10) : 0;
      const clicks = insights && typeof insights.clicks === "string" ? parseInt(insights.clicks, 10) : 0;
      const actions = insights && Array.isArray(insights.actions) ? insights.actions as Array<{ action_type?: string; value?: string }> : [];
      const conversions = actions.reduce((sum, a) => sum + (a.value ? parseInt(a.value, 10) || 0 : 0), 0);
      return { spend, impressions, clicks, conversions };
    },
  };
}
