export const ITERATION_CANDIDATE_TYPES = ["hook","proof_angle","cta","format","story_sequence","content_angle","offer","audience","distribution","asset","calendar","other"] as const;
export const ITERATION_CONFIDENCE = ["low","medium","high"] as const;
export const ITERATION_PRIORITIES = ["low","medium","high"] as const;

export type IterationCandidateType = typeof ITERATION_CANDIDATE_TYPES[number];
export type IterationConfidence = typeof ITERATION_CONFIDENCE[number];
export type IterationPriority = typeof ITERATION_PRIORITIES[number];
export type IterationCandidateStatus = "needs_review" | "approved" | "dismissed" | "converted";

export function iterationStatusGuidance(status: IterationCandidateStatus): string {
  if (status === "needs_review") return "Review the evidence before approving or dismissing.";
  if (status === "approved") return "Approved for future planning; no strategy or content changes happen automatically.";
  if (status === "dismissed") return "Dismissed candidates remain as review history.";
  return "Converted means reviewed for a future workflow; no files were changed in this gate.";
}

export function validIterationTransition(current: IterationCandidateStatus, next: IterationCandidateStatus): boolean {
  return (current === "needs_review" && ["approved","dismissed"].includes(next))
    || (current === "approved" && ["converted","dismissed"].includes(next))
    || (current === "dismissed" && next === "dismissed");
}

export function iterationEvidenceFromScore(score: { overall_score:number; attention_score:number; engagement_score:number; trust_score:number; conversion_signal_score:number; sample_quality:string; score_status:string; score_reasons:string[] }, latestMetrics: Record<string, unknown> = {}): Record<string, unknown> {
  return { score_version:"deterministic_v1", overall_score:score.overall_score, attention_score:score.attention_score, engagement_score:score.engagement_score, trust_score:score.trust_score, conversion_signal_score:score.conversion_signal_score, sample_quality:score.sample_quality, score_status:score.score_status, score_reasons:score.score_reasons, latest_metrics:latestMetrics };
}
