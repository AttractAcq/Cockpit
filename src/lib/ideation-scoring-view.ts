import type { IdeationCandidate } from "../types/ideation";
import type {
  IdeationCandidateScore,
  IdeationPriorityBand,
  IdeationScoringRun,
} from "../types/ideation-scoring";

export interface ScoredCandidate {
  candidate: IdeationCandidate;
  score: IdeationCandidateScore | null;
}

/** The scoring run a cycle currently presents: newest by created_at. */
export function activeScoringRun(
  runs: IdeationScoringRun[],
  cycleId: string | null,
): IdeationScoringRun | null {
  if (!cycleId) return null;
  const forCycle = runs
    .filter((run) => run.ideation_cycle_id === cycleId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
  return forCycle[0] ?? null;
}

/** Every historical run for a cycle, newest first. History is never discarded. */
export function scoringRunHistory(
  runs: IdeationScoringRun[],
  cycleId: string | null,
): IdeationScoringRun[] {
  if (!cycleId) return [];
  return runs
    .filter((run) => run.ideation_cycle_id === cycleId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at));
}

/**
 * Presentation ordering.
 *
 * With a completed scoring run the list defaults to persisted rank order. The
 * rank was assigned server-side, so this only reads it — it never re-derives a
 * ranking on the client. Unscored candidates always sort after scored ones.
 * Without a completed run, the original generation order is preserved.
 */
export function orderCandidatesForDisplay(
  candidates: IdeationCandidate[],
  scores: IdeationCandidateScore[],
  scoringRun: IdeationScoringRun | null,
  mode: "ranked" | "original",
): ScoredCandidate[] {
  const scoreByCandidate = new Map<string, IdeationCandidateScore>();
  if (scoringRun) {
    for (const score of scores) {
      if (score.scoring_run_id === scoringRun.id) scoreByCandidate.set(score.candidate_id, score);
    }
  }
  const rows: ScoredCandidate[] = candidates.map((candidate) => ({
    candidate,
    score: scoreByCandidate.get(candidate.id) ?? null,
  }));
  if (mode === "original" || !scoringRun || scoringRun.status !== "completed") return rows;
  return [...rows].sort((left, right) => {
    const leftRank = left.score?.rank ?? null;
    const rightRank = right.score?.rank ?? null;
    if (leftRank !== null && rightRank !== null) return leftRank - rightRank;
    if (leftRank !== null) return -1;
    if (rightRank !== null) return 1;
    return left.candidate.id.localeCompare(right.candidate.id);
  });
}

const BAND_TEXT: Record<IdeationPriorityBand, string> = {
  top: "Top priority",
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};

/**
 * Band description used as accessible text. The band is always conveyed as
 * words, never by colour alone.
 */
export function bandDescription(band: IdeationPriorityBand, overallScore: number): string {
  return `${BAND_TEXT[band]}, score ${overallScore} out of 100`;
}

export function bandToneClass(band: IdeationPriorityBand): string {
  return {
    top: "border-pos/40 text-pos",
    high: "border-teal/40 text-teal",
    medium: "border-warn/40 text-warn",
    low: "border-line text-paper-3",
  }[band];
}

/** Compact card indicator: strongest strength, or the first risk if present. */
export function scoreIndicator(score: IdeationCandidateScore | null): string {
  if (!score) return "Not scored";
  if (score.risks.length > 0) return `Risk: ${score.risks[0]}`;
  return score.strengths[0] ?? "Scored";
}

export function scoringProgressLabel(run: IdeationScoringRun): string {
  return `${run.scored_candidate_count} of ${run.expected_candidate_count} candidates scored`
    + ` · attempt ${run.attempt_count} of ${run.maximum_attempts}`;
}

/** True only when a fresh scoring run may be started for this cycle. */
export function canStartScoring(
  runStatus: string | undefined,
  scoringRun: IdeationScoringRun | null,
): boolean {
  return runStatus === "completed" && scoringRun === null;
}

/** True only when the operator may retry a partially scored run. */
export function canRetryScoring(scoringRun: IdeationScoringRun | null): boolean {
  return Boolean(
    scoringRun
      && scoringRun.status === "retryable"
      && scoringRun.retryable
      && scoringRun.attempt_count < scoringRun.maximum_attempts,
  );
}

/** True only when a completed run exists and may be deliberately superseded. */
export function canRescore(scoringRun: IdeationScoringRun | null): boolean {
  return scoringRun?.status === "completed";
}
