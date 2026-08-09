// Programme Stage M — deterministic paid-performance scoring and insight
// generation. Mirrors src/lib/performance-intelligence.ts's structure and
// determinism exactly, but with paid dimensions: efficiency (CPM/CTR/CPC),
// volume (impressions/clicks/landing-page views), and conversion (leads,
// appointments, cash collected, CAC, ROAS) in place of attention/engagement/
// trust, which don't apply to a paid campaign.
//
// Persisted via upsert_ad_performance_score, which stores efficiency_score
// in the attention_score column and volume_score in the engagement_score
// column of the shared client_performance_scores table (see the migration
// comment) — trust_score is always null for a paid row.

export type AdSampleQuality = "insufficient" | "early" | "usable" | "mature";
export type AdScoreStatus = "pending_metrics" | "scored" | "insufficient_data" | "stale";
export type AdInsightType = "winner" | "underperformer" | "format_signal" | "conversion_signal" | "risk" | "recommendation";

export interface AdPerformanceInput {
  adCampaignId: string;
  campaignName: string;
  launchedAt: string;
  metricSnapshotId?: string | null;
  businessSignalSnapshotId?: string | null;
  metrics?: Record<string, number | null | undefined> | null;
  businessSignals?: Record<string, number | null | undefined> | null;
  budgetDaily?: number | null;
}

export interface AdPerformanceScoreDraft {
  ad_campaign_id: string; campaign_name: string;
  latest_metric_snapshot_id: string | null; latest_business_signal_snapshot_id: string | null;
  score_version: "deterministic_ad_v1"; efficiency_score: number; volume_score: number; conversion_score: number; overall_score: number;
  sample_quality: AdSampleQuality; score_status: AdScoreStatus; score_reasons: string[];
}

export interface AdInsightCandidate {
  insight_type: AdInsightType; severity: "low" | "medium" | "high"; confidence: "low" | "medium" | "high";
  title: string; summary: string; evidence: Record<string, unknown>; recommended_action: string | null;
}

const n = (value: number | null | undefined) => Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;
const cap = (value: number, ceiling: number) => Math.min(100, Math.round((value / ceiling) * 100));
const invCap = (value: number, target: number) => value <= 0 ? 0 : Math.min(100, Math.round((target / value) * 100));
const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

/**
 * Efficiency rewards LOW cost metrics (CPM/CPC) — inverted caps, since a
 * lower cost-per-unit is better, unlike the organic caps which reward raw
 * volume. ROAS/CAC are the strongest, most direct paid efficiency signals.
 */
export function calculateAdCampaignPerformanceScore(input: AdPerformanceInput, now = new Date()): AdPerformanceScoreDraft {
  const m = input.metrics ?? {};
  const b = input.businessSignals ?? {};
  const populated = Object.values(m).filter((value) => typeof value === "number").length;
  const metricTotal = Object.values(m).reduce<number>((sum, value) => sum + n(value), 0);
  const businessTotal = [b.leads, b.qualified_leads, b.appointments, b.show_ups, b.cash_collected].reduce<number>((sum, value) => sum + n(value), 0);
  const ageHours = Math.max(0, (now.getTime() - new Date(input.launchedAt).getTime()) / 3_600_000);

  const efficiency = average([invCap(n(m.cpm), 10), invCap(n(m.cpc), 1), cap(n(m.ctr), 3), cap(n(m.hook_rate), 30)]);
  const volume = average([cap(n(m.impressions), 20000), cap(n(m.landing_page_views), 500)]);
  const conversion = average([cap(n(b.leads), 20), cap(n(b.qualified_leads), 10), cap(n(b.appointments), 8), cap(n(b.show_ups), 5), cap(n(b.cash_collected), 5000), n(b.roas) > 0 ? cap(n(b.roas), 4) : 0]);

  const quality: AdSampleQuality = !populated || metricTotal === 0 ? "insufficient" : ageHours < 24 ? "early" : ageHours >= 168 && Boolean(input.businessSignalSnapshotId) ? "mature" : "usable";
  const status: AdScoreStatus = !populated ? "pending_metrics" : quality === "insufficient" ? "insufficient_data" : "scored";
  const overall = quality === "insufficient" ? 0 : Math.round(efficiency * .35 + volume * .25 + conversion * .4);

  const reasons = !populated ? ["Launched, awaiting enough paid metrics."]
    : metricTotal === 0 ? ["Metrics are present but currently zero; this is insufficient data, not underperformance."]
    : [
      `Efficiency signal ${efficiency}/100 from CPM, CPC, CTR and hook rate.`,
      `Volume signal ${volume}/100 from impressions and landing-page views.`,
      businessTotal > 0 ? `Commercial signals contribute ${conversion}/100.` : "No business signals (leads/appointments/cash) recorded yet.",
      "Signal detected, not a conclusion.",
    ];

  return {
    ad_campaign_id: input.adCampaignId, campaign_name: input.campaignName,
    latest_metric_snapshot_id: input.metricSnapshotId ?? null, latest_business_signal_snapshot_id: input.businessSignalSnapshotId ?? null,
    score_version: "deterministic_ad_v1", efficiency_score: efficiency, volume_score: volume, conversion_score: conversion, overall_score: overall,
    sample_quality: quality, score_status: status, score_reasons: reasons,
  };
}

export function generateAdInsightCandidates(score: AdPerformanceScoreDraft, input: AdPerformanceInput, sameObjectiveScores: readonly number[]): AdInsightCandidate[] {
  if (score.sample_quality === "insufficient" || score.score_status !== "scored") return [];
  const confidence = sameObjectiveScores.length >= 5 && score.sample_quality === "mature" ? "high" : sameObjectiveScores.length >= 3 ? "medium" : "low";
  const baseline = sameObjectiveScores.length ? sameObjectiveScores.reduce((sum, value) => sum + value, 0) / sameObjectiveScores.length : null;
  const insights: AdInsightCandidate[] = [];

  if (baseline != null && score.overall_score >= baseline + 15) {
    insights.push({ insight_type: "winner", severity: "medium", confidence, title: "Above-baseline paid performance signal",
      summary: `${score.campaign_name} is showing a stronger signal than the current same-objective baseline.`,
      evidence: { overall_score: score.overall_score, same_objective_baseline: Math.round(baseline), sample_size: sameObjectiveScores.length },
      recommended_action: "Consider raising budget within policy limits, or use this creative as a template for a new variant." });
  }
  if (baseline != null && score.sample_quality === "mature" && score.overall_score <= baseline - 15 && score.efficiency_score < 35) {
    insights.push({ insight_type: "underperformer", severity: "medium", confidence, title: "Below-baseline mature paid signal",
      summary: "A mature paid sample is below the current same-objective efficiency baseline.",
      evidence: { overall_score: score.overall_score, same_objective_baseline: Math.round(baseline) },
      recommended_action: "Pause or refresh creative before continuing spend on this campaign." });
  }
  const impressions = n(input.metrics?.impressions); const leads = n(input.businessSignals?.leads);
  if (impressions >= 5000 && leads === 0) {
    insights.push({ insight_type: "conversion_signal", severity: "medium", confidence: score.sample_quality === "mature" ? "medium" : "low",
      title: "Reach without lead signal", summary: "Meaningful impressions are recorded, but no leads are recorded yet.",
      evidence: { impressions, leads }, recommended_action: "Review landing page and CTA before increasing spend further." });
  }
  if (score.conversion_score >= 40) {
    insights.push({ insight_type: "conversion_signal", severity: "high", confidence, title: "Paid commercial signal detected",
      summary: "Recorded leads/appointments/cash collected indicate potential paid conversion value.",
      evidence: { conversion_score: score.conversion_score }, recommended_action: "Preserve this pattern as an iteration candidate for later review." });
  }
  return insights.slice(0, 2);
}

export function adIterationEvidenceFromScore(score: AdPerformanceScoreDraft, latestMetrics: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    score_version: score.score_version, overall_score: score.overall_score, efficiency_score: score.efficiency_score,
    volume_score: score.volume_score, conversion_score: score.conversion_score, sample_quality: score.sample_quality,
    score_status: score.score_status, score_reasons: score.score_reasons, latest_metrics: latestMetrics,
  };
}
