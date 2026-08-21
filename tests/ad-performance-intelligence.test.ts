// Programme Stage M — deterministic unit coverage for paid performance
// scoring and insight generation. All pure functions — no network, no
// database.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateAdCampaignPerformanceScore, generateAdInsightCandidates, adIterationEvidenceFromScore,
  type AdPerformanceInput, type AdPerformanceScoreDraft,
} from "../src/lib/ad-performance-intelligence.ts";

function baseInput(overrides: Partial<AdPerformanceInput> = {}): AdPerformanceInput {
  return {
    adCampaignId: "campaign-1", campaignName: "Test Campaign", launchedAt: new Date(Date.now() - 200 * 3_600_000).toISOString(),
    metricSnapshotId: "metric-1", businessSignalSnapshotId: "signal-1",
    metrics: { spend: 500, impressions: 20000, cpm: 5, hook_rate: 20, ctr: 2, cpc: 0.5, landing_page_views: 300 },
    businessSignals: { leads: 10, qualified_leads: 5, appointments: 3, show_ups: 2, cash_collected: 1000, roas: 2 },
    ...overrides,
  };
}

test("no populated metrics is pending, not a zero score", () => {
  const score = calculateAdCampaignPerformanceScore(baseInput({ metrics: {}, businessSignals: {} }));
  assert.equal(score.score_status, "pending_metrics");
  assert.equal(score.sample_quality, "insufficient");
  assert.equal(score.overall_score, 0);
  assert.match(score.score_reasons[0], /awaiting enough paid metrics/);
});

test("metrics present but all zero is insufficient data, not underperformance", () => {
  const score = calculateAdCampaignPerformanceScore(baseInput({ metrics: { spend: 0, impressions: 0 }, businessSignals: {} }));
  assert.equal(score.score_status, "insufficient_data");
  assert.equal(score.overall_score, 0);
  assert.match(score.score_reasons[0], /insufficient data, not underperformance/);
});

test("a fresh launch with real metrics is early, not mature, even with good numbers", () => {
  const score = calculateAdCampaignPerformanceScore(baseInput({ launchedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() }));
  assert.equal(score.sample_quality, "early");
  assert.equal(score.score_status, "scored");
});

test("mature requires both age >= 7 days and a business signal snapshot", () => {
  const oldNoSignal = calculateAdCampaignPerformanceScore(baseInput({ launchedAt: new Date(Date.now() - 200 * 3_600_000).toISOString(), businessSignalSnapshotId: null }));
  assert.equal(oldNoSignal.sample_quality, "usable");
  const oldWithSignal = calculateAdCampaignPerformanceScore(baseInput({ launchedAt: new Date(Date.now() - 200 * 3_600_000).toISOString(), businessSignalSnapshotId: "signal-1" }));
  assert.equal(oldWithSignal.sample_quality, "mature");
});

test("efficiency rewards LOW cpm/cpc, not high — inverted from organic's raw-volume caps", () => {
  const cheap = calculateAdCampaignPerformanceScore(baseInput({ metrics: { spend: 100, impressions: 20000, cpm: 2, cpc: 0.2, ctr: 3, hook_rate: 30 } }));
  const expensive = calculateAdCampaignPerformanceScore(baseInput({ metrics: { spend: 100, impressions: 20000, cpm: 40, cpc: 5, ctr: 3, hook_rate: 30 } }));
  assert.ok(cheap.efficiency_score > expensive.efficiency_score, "lower CPM/CPC must score higher efficiency, not lower");
});

test("overall score is a fixed weighted blend: efficiency .35 + volume .25 + conversion .4", () => {
  const score = calculateAdCampaignPerformanceScore(baseInput());
  const expected = Math.round(score.efficiency_score * 0.35 + score.volume_score * 0.25 + score.conversion_score * 0.4);
  assert.equal(score.overall_score, expected);
});

test("scores are always clamped 0-100 regardless of extreme input", () => {
  const score = calculateAdCampaignPerformanceScore(baseInput({ metrics: { spend: 1, impressions: 10_000_000, cpm: 0.01, cpc: 0.001, ctr: 500, hook_rate: 500 }, businessSignals: { leads: 100000, roas: 999 } }));
  for (const value of [score.efficiency_score, score.volume_score, score.conversion_score, score.overall_score]) {
    assert.ok(value >= 0 && value <= 100, `score ${value} out of 0-100 range`);
  }
});

function scoredDraft(overrides: Partial<AdPerformanceScoreDraft> = {}): AdPerformanceScoreDraft {
  return {
    ad_campaign_id: "c1", campaign_name: "Campaign", latest_metric_snapshot_id: "m1", latest_business_signal_snapshot_id: "s1",
    score_version: "deterministic_ad_v1", efficiency_score: 60, volume_score: 60, conversion_score: 60, overall_score: 60,
    sample_quality: "usable", score_status: "scored", score_reasons: ["reason"],
    ...overrides,
  };
}

test("insufficient sample quality never produces insights, even with a strong score", () => {
  const insights = generateAdInsightCandidates(scoredDraft({ sample_quality: "insufficient", overall_score: 90 }), baseInput(), []);
  assert.deepEqual(insights, []);
});

test("a score 15+ above the same-objective baseline produces a winner insight", () => {
  const insights = generateAdInsightCandidates(scoredDraft({ overall_score: 80 }), baseInput(), [50, 55, 60]);
  assert.ok(insights.some((i) => i.insight_type === "winner"));
});

test("underperformer only fires when mature AND well below baseline AND low efficiency", () => {
  const notMature = generateAdInsightCandidates(scoredDraft({ overall_score: 20, efficiency_score: 10, sample_quality: "usable" }), baseInput(), [60, 65, 70]);
  assert.ok(!notMature.some((i) => i.insight_type === "underperformer"), "usable (not mature) samples should not trigger underperformer");
  const mature = generateAdInsightCandidates(scoredDraft({ overall_score: 20, efficiency_score: 10, sample_quality: "mature" }), baseInput(), [60, 65, 70]);
  assert.ok(mature.some((i) => i.insight_type === "underperformer"));
});

test("reach without leads produces a conversion_signal insight distinct from the leads-present case", () => {
  const noLeads = generateAdInsightCandidates(scoredDraft({ conversion_score: 10 }), baseInput({ metrics: { impressions: 8000 }, businessSignals: { leads: 0 } }), []);
  assert.ok(noLeads.some((i) => i.insight_type === "conversion_signal" && /Reach without lead/.test(i.title)));
  const withLeads = generateAdInsightCandidates(scoredDraft({ conversion_score: 10 }), baseInput({ metrics: { impressions: 8000 }, businessSignals: { leads: 3 } }), []);
  assert.ok(!withLeads.some((i) => /Reach without lead/.test(i.title)));
});

test("a strong conversion score produces a commercial-signal insight", () => {
  const insights = generateAdInsightCandidates(scoredDraft({ conversion_score: 55 }), baseInput(), []);
  assert.ok(insights.some((i) => i.title === "Paid commercial signal detected"));
});

test("insight generation never returns more than 2 candidates", () => {
  const insights = generateAdInsightCandidates(
    scoredDraft({ overall_score: 90, conversion_score: 60, efficiency_score: 5 }),
    baseInput({ metrics: { impressions: 9000 }, businessSignals: { leads: 0 } }),
    [10, 15, 20],
  );
  assert.ok(insights.length <= 2);
});

test("adIterationEvidenceFromScore preserves every score dimension for the reviewed candidate", () => {
  const evidence = adIterationEvidenceFromScore(scoredDraft(), { spend: 500 });
  assert.equal(evidence.overall_score, 60);
  assert.equal(evidence.score_version, "deterministic_ad_v1");
  assert.deepEqual(evidence.latest_metrics, { spend: 500 });
});
