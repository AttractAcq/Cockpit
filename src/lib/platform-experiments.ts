// Programme Stage 1B-E — Facebook-vs-Instagram comparison and platform
// experiments. Pure aggregation, no network/DB dependency, mirroring
// ad-creative-comparison.ts's own discipline exactly: group, aggregate, and
// — critically — never fabricate a comparison from a group with no real
// scored samples. `client_performance_scores` rows already carry `platform`
// (Gate D, unchanged this stage), so both the general "Facebook vs Instagram
// so far" dashboard view and a specific experiment's two arms use this same
// function — an experiment is just a pre-filtered input, not a different
// code path.

import type { PlatformExperimentPlatform } from "@/types/phase";

export interface ScoreForComparison {
  platform: string;
  overall_score: number;
  attention_score: number;
  engagement_score: number;
  conversion_signal_score: number;
  sample_quality: "insufficient" | "early" | "usable" | "mature";
  score_status: "pending_metrics" | "scored" | "insufficient_data" | "stale";
}

export interface PlatformComparisonGroup {
  platform: PlatformExperimentPlatform;
  sampleSize: number;
  matureSampleSize: number;
  averageOverallScore: number;
  averageAttentionScore: number;
  averageEngagementScore: number;
  averageConversionScore: number;
}

export interface PlatformComparisonResult {
  groups: PlatformComparisonGroup[];
  /** True only when both platforms have at least one scored sample — otherwise there is nothing to compare yet. */
  comparable: boolean;
  /** Confidence in any difference shown, driven purely by sample size — never a claim of statistical significance. */
  confidence: "low" | "medium" | "high" | null;
  /** Always present when comparable; states the observation without a causal claim. */
  narrative: string | null;
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const average = (values: number[]) => (values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0);

function isPlatformExperimentPlatform(value: string): value is PlatformExperimentPlatform {
  return value === "instagram" || value === "facebook";
}

/**
 * Groups scored (score_status === "scored") performance rows by platform and
 * returns an honest comparison. Never claims a winner or a causal effect —
 * only reports the observed average signal and how much sample backs it,
 * matching the exact "Signal detected, not a conclusion" discipline already
 * established in performance-intelligence.ts's generateInsightCandidates.
 */
export function comparePlatformPerformance(scores: readonly ScoreForComparison[]): PlatformComparisonResult {
  const scored = scores.filter((s) => s.score_status === "scored" && s.sample_quality !== "insufficient");
  const byPlatform = new Map<string, ScoreForComparison[]>();
  for (const score of scored) {
    const key = score.platform.toLowerCase();
    if (!isPlatformExperimentPlatform(key)) continue;
    byPlatform.set(key, [...(byPlatform.get(key) ?? []), score]);
  }

  const groups: PlatformComparisonGroup[] = [...byPlatform.entries()].map(([platform, items]) => ({
    platform: platform as PlatformExperimentPlatform,
    sampleSize: items.length,
    matureSampleSize: items.filter((i) => i.sample_quality === "mature").length,
    averageOverallScore: round1(average(items.map((i) => i.overall_score))),
    averageAttentionScore: round1(average(items.map((i) => i.attention_score))),
    averageEngagementScore: round1(average(items.map((i) => i.engagement_score))),
    averageConversionScore: round1(average(items.map((i) => i.conversion_signal_score))),
  })).sort((a, b) => b.sampleSize - a.sampleSize);

  const comparable = groups.length >= 2 && groups.every((g) => g.sampleSize > 0);
  if (!comparable) {
    return { groups, comparable: false, confidence: null, narrative: null };
  }

  const minSample = Math.min(...groups.map((g) => g.sampleSize));
  const confidence: "low" | "medium" | "high" = minSample >= 5 ? "high" : minSample >= 3 ? "medium" : "low";
  const [a, b] = groups;
  const diff = Math.abs(a.averageOverallScore - b.averageOverallScore);
  const stronger = a.averageOverallScore >= b.averageOverallScore ? a : b;
  const weaker = stronger === a ? b : a;
  const narrative = diff < 5
    ? `${a.platform} and ${b.platform} are showing a similar average signal so far (n=${a.sampleSize}/${b.sampleSize}). Not a controlled conclusion.`
    : `${stronger.platform} is showing a stronger average signal than ${weaker.platform} so far (${stronger.averageOverallScore} vs ${weaker.averageOverallScore}, n=${stronger.sampleSize}/${weaker.sampleSize}). Signal detected, not a conclusion — confidence is ${confidence} based on sample size alone.`;

  return { groups, comparable: true, confidence, narrative };
}
