export type SampleQuality = "insufficient" | "early" | "usable" | "mature";
export type ScoreStatus = "pending_metrics" | "scored" | "insufficient_data" | "stale";
export type InsightType = "winner" | "underperformer" | "format_signal" | "hook_signal" | "proof_signal" | "cta_signal" | "audience_signal" | "conversion_signal" | "risk" | "recommendation";

export interface PerformanceInput {
  distributionRecordId: string;
  sourceRef: string;
  contentFormat: string;
  platform: string;
  publishedAt: string;
  metricSnapshotId?: string | null;
  businessSignalSnapshotId?: string | null;
  metrics?: Record<string, number | null | undefined> | null;
  businessSignals?: Record<string, number | null | undefined> | null;
}

export interface PerformanceScoreDraft {
  distribution_record_id: string; source_ref: string; content_format: string; platform: string;
  latest_metric_snapshot_id: string | null; latest_business_signal_snapshot_id: string | null;
  score_version: "deterministic_v1"; attention_score: number; engagement_score: number;
  trust_score: number; conversion_signal_score: number; overall_score: number;
  sample_quality: SampleQuality; score_status: ScoreStatus; score_reasons: string[];
}

export interface InsightCandidate {
  insight_type: InsightType; severity: "low" | "medium" | "high"; confidence: "low" | "medium" | "high";
  title: string; summary: string; evidence: Record<string, unknown>; recommended_action: string | null;
}

const n = (value: number | null | undefined) => Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;
const cap = (value: number, ceiling: number) => Math.min(100, Math.round((value / ceiling) * 100));
const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

export function calculatePerformanceScore(input: PerformanceInput, now = new Date()): PerformanceScoreDraft {
  const m = input.metrics ?? {};
  const b = input.businessSignals ?? {};
  const populated = Object.values(m).filter((value) => typeof value === "number").length;
  const metricTotal = Object.values(m).reduce<number>((sum, value) => sum + n(value), 0);
  const businessTotal = [b.inbound_dms,b.qualified_dms,b.conversations,b.qualified_conversations,b.appointments,b.qualified_appointments,b.show_ups,b.cash_collected].reduce<number>((sum,value) => sum+n(value),0);
  const ageHours = Math.max(0, (now.getTime() - new Date(input.publishedAt).getTime()) / 3_600_000);
  const story = input.contentFormat.toLowerCase().includes("story");
  const attention = average([cap(n(m.reach), 1000), cap(n(m.impressions ?? m.views), 1500), cap(n(m.profile_visits), 100), cap(n(m.follows), 25)]);
  const engagement = average(story
    ? [cap(n(m.replies), 20), cap(n(m.shares), 30), cap(n(m.taps_back), 50)]
    : [cap(n(m.likes), 150), cap(n(m.comments), 30), cap(n(m.shares), 50), cap(n(m.saves), 75)]);
  const trust = average([cap(n(m.saves), 75), cap(n(m.shares), 50), cap(n(m.replies), 20), cap(n(m.comments), 30), cap(n(m.profile_visits), 100)]);
  const conversion = average([cap(n(b.inbound_dms), 20),cap(n(b.qualified_dms),10),cap(n(b.conversations),15),cap(n(b.appointments),8),cap(n(b.show_ups),5),cap(n(b.cash_collected),5000)]);
  const quality: SampleQuality = !populated || metricTotal === 0 ? "insufficient" : ageHours < 24 ? "early" : ageHours >= 168 && Boolean(input.businessSignalSnapshotId) ? "mature" : "usable";
  const status: ScoreStatus = !populated ? "pending_metrics" : quality === "insufficient" ? "insufficient_data" : "scored";
  const overall = quality === "insufficient" ? 0 : Math.round(attention * .3 + engagement * .3 + trust * .2 + conversion * .2);
  const reasons = !populated ? ["Published, awaiting enough metrics."]
    : metricTotal === 0 ? ["Metrics are present but currently zero; this is insufficient data, not underperformance."]
    : [
      `Attention signal ${attention}/100 from reach, visibility, profile visits and follows.`,
      `Engagement signal ${engagement}/100 using ${story ? "Story replies, shares and taps back" : "likes, comments, shares and saves"}.`,
      businessTotal > 0 ? `Commercial signals contribute ${conversion}/100.` : "No business signals recorded yet.",
      "Signal detected, not a conclusion.",
    ];
  return { distribution_record_id:input.distributionRecordId,source_ref:input.sourceRef,content_format:input.contentFormat,platform:input.platform,latest_metric_snapshot_id:input.metricSnapshotId??null,latest_business_signal_snapshot_id:input.businessSignalSnapshotId??null,score_version:"deterministic_v1",attention_score:attention,engagement_score:engagement,trust_score:trust,conversion_signal_score:conversion,overall_score:overall,sample_quality:quality,score_status:status,score_reasons:reasons };
}

export function generateInsightCandidates(score: PerformanceScoreDraft, input: PerformanceInput, sameFormatScores: readonly number[]): InsightCandidate[] {
  if (score.sample_quality === "insufficient" || score.score_status !== "scored") return [];
  const confidence = sameFormatScores.length >= 5 && score.sample_quality === "mature" ? "high" : sameFormatScores.length >= 3 ? "medium" : "low";
  const baseline = sameFormatScores.length ? sameFormatScores.reduce((sum,value)=>sum+value,0)/sameFormatScores.length : null;
  const insights: InsightCandidate[] = [];
  if (baseline != null && score.overall_score >= baseline + 15) insights.push({ insight_type:"winner",severity:"medium",confidence,title:"Above-baseline performance signal",summary:`${score.source_ref} is showing a stronger signal than the current same-format baseline.`,evidence:{overall_score:score.overall_score,same_format_baseline:Math.round(baseline),sample_size:sameFormatScores.length},recommended_action:`Create another ${score.content_format.replaceAll("_"," ")} using a similar structure; validate the signal with more samples.` });
  if (baseline != null && score.sample_quality === "mature" && score.overall_score <= baseline - 15 && score.attention_score < 35 && score.engagement_score < 35) insights.push({ insight_type:"underperformer",severity:"medium",confidence,title:"Below-baseline mature signal",summary:"A mature sample is below the current same-format attention and engagement baseline.",evidence:{overall_score:score.overall_score,same_format_baseline:Math.round(baseline)},recommended_action:"Test a different hook and content structure before repeating this pattern." });
  const visits=n(input.metrics?.profile_visits); const dms=n(input.businessSignals?.inbound_dms);
  if (visits >= 10 && dms === 0) insights.push({ insight_type:"cta_signal",severity:"medium",confidence:score.sample_quality==="mature"?"medium":"low",title:"Interest without conversion signal",summary:"Profile visits show interest, but no inbound DMs are recorded yet.",evidence:{profile_visits:visits,inbound_dms:dms},recommended_action:"Test a clearer, lower-friction CTA and continue recording business signals." });
  if (score.trust_score >= 50) insights.push({ insight_type:"proof_signal",severity:"low",confidence,title:"Trust and proof signal",summary:"Saves, shares, replies, comments or profile visits indicate possible proof resonance.",evidence:{trust_score:score.trust_score},recommended_action:"Create more content around this proof angle and validate across additional posts." });
  if (score.conversion_signal_score >= 40) insights.push({ insight_type:"conversion_signal",severity:"high",confidence,title:"Commercial signal detected",summary:"Recorded business outcomes indicate potential conversion value.",evidence:{conversion_signal_score:score.conversion_signal_score},recommended_action:"Preserve this pattern as an iteration candidate for later review." });
  return insights.slice(0, 2);
}
