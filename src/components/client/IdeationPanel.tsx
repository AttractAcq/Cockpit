import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, EmptyState, Modal, Tag } from "@/components/primitives";
import {
  decodeIdeationInvocationFailure,
  decodeIdeationScoringInvocationFailure,
  fetchIdeationOverview,
  fetchIdeationScoringOverview,
  runIdeation,
  scoreIdeationCandidates,
} from "@/lib/api";
import {
  activeScoringRun,
  bandDescription,
  bandToneClass,
  canRescore,
  canRetryScoring,
  canStartScoring,
  orderCandidatesForDisplay,
  scoreIndicator,
  scoringProgressLabel,
  scoringRunHistory,
} from "@/lib/ideation-scoring-view";
import {
  createIdeationRequestCoordinator,
  type IdeationMutationToken,
  type IdeationRequestCoordinator,
} from "@/lib/ideation-request-coordinator";
import type {
  IdeationAuthorityInput,
  IdeationAssetType,
  IdeationCandidate,
  IdeationOverview,
  IdeationPeriodType,
  IdeationRun,
  IdeationStrategicSourceKind,
  RunIdeationResponse,
} from "@/types/ideation";
import {
  IDEATION_SCORE_DIMENSIONS,
  type IdeationCandidateScore,
  type IdeationScoringOverview,
  type IdeationScoringRun,
} from "@/types/ideation-scoring";

const FIELD_CLASS = "rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper outline-none focus:border-teal/50";
const PERIODS: Array<{ value: IdeationPeriodType; label: string; description: string }> = [
  { value: "one_day", label: "One Day", description: "Choose one specific calendar day." },
  { value: "one_week", label: "One Week", description: "Choose a start date and generate for exactly seven consecutive days." },
  { value: "date_range", label: "Date Range", description: "Choose up to 31 inclusive days; a valid range may touch three months." },
  { value: "one_month", label: "One Month", description: "Generate for a complete calendar month." },
];
const GROUPS: Array<{ assetType: IdeationAssetType; label: string }> = [
  { assetType: "reel", label: "Reels" },
  { assetType: "carousel", label: "Carousels" },
  { assetType: "static", label: "Statics" },
  { assetType: "story", label: "Stories" },
];
const STRATEGIC_SOURCE_OPTIONS: Array<{
  value: IdeationStrategicSourceKind;
  label: string;
  description: string;
}> = [
  { value: "campaign_intelligence", label: "Campaign Intelligence", description: "Use approved timing, customer context, and strategic themes." },
  { value: "main_offer", label: "Main Offers", description: "Use approved commercial architecture and offer value equation." },
  { value: "seasonal_offer", label: "Seasonal Offers", description: "Use approved campaign-specific offer packaging." },
  { value: "avatar", label: "Avatar OS", description: "Use approved voice, knowledge boundaries, formats, and creative identity." },
];

const STRATEGIC_SOURCE_LABEL: Record<IdeationStrategicSourceKind, string> = {
  campaign_intelligence: "Campaign",
  main_offer: "Main Offer",
  seasonal_offer: "Seasonal Offer",
  avatar: "Avatar OS",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && /abort/i.test(error.name);
}

function todayIso(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function plusDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function inclusiveDays(start: string, end: string): number {
  const startTime = new Date(`${start}T00:00:00.000Z`).getTime();
  const endTime = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.floor((endTime - startTime) / 86_400_000) + 1;
}

function generatedLabel(run: IdeationRun): string {
  const created = new Date(run.created_at);
  return created.toDateString() === new Date().toDateString()
    ? "Generated Today"
    : `Generated ${created.toLocaleDateString()}`;
}

function periodLabel(run: IdeationRun): string {
  return run.period_start === run.period_end
    ? run.period_start
    : `${run.period_start} → ${run.period_end}`;
}

function strategicKindsForCandidate(candidate: IdeationCandidate): IdeationStrategicSourceKind[] {
  const kinds = new Set<IdeationStrategicSourceKind>();
  for (const reference of candidate.evidence_references) {
    if (reference.source_url.includes("/campaign-intelligence/")) kinds.add("campaign_intelligence");
    if (reference.source_url.includes("/main-offers/")) kinds.add("main_offer");
    if (reference.source_url.includes("/seasonal-offers/")) kinds.add("seasonal_offer");
    if (reference.source_url.includes("/avatars/")) kinds.add("avatar");
  }
  return [...kinds];
}

function selectedSourceKinds(run: IdeationRun | null): IdeationStrategicSourceKind[] {
  const authority = run?.configuration_snapshot?.authority;
  if (!authority || typeof authority !== "object" || Array.isArray(authority)) return STRATEGIC_SOURCE_OPTIONS.map((source) => source.value);
  const inputs = (authority as Record<string, unknown>).ideation_hub_inputs;
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return STRATEGIC_SOURCE_OPTIONS.map((source) => source.value);
  const selected = (inputs as Record<string, unknown>).selected_source_kinds;
  if (!Array.isArray(selected)) return STRATEGIC_SOURCE_OPTIONS.map((source) => source.value);
  return selected.filter((value): value is IdeationStrategicSourceKind =>
    value === "campaign_intelligence" || value === "main_offer" || value === "seasonal_offer" || value === "avatar",
  );
}

function CandidateDetail({
  candidate,
  run,
  score,
  scoringRun,
  onClose,
}: {
  candidate: IdeationCandidate;
  run: IdeationRun | null;
  score: IdeationCandidateScore | null;
  scoringRun: IdeationScoringRun | null;
  onClose: () => void;
}) {
  const research = candidate.research_result;
  const externalUrl = research?.source_url.startsWith("http") ?? false;
  return (
    <Modal title={candidate.working_title} description="Read-only Ideation candidate" onClose={onClose} widthClass="max-w-3xl">
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Tag kind="task">{candidate.asset_type}</Tag>
          <Tag kind="muted">{candidate.technique?.name ?? "Technique"}</Tag>
          <Tag kind="decision">{candidate.status.replaceAll("_", " ")}</Tag>
          {score && <Tag kind="muted">{`Rank ${score.rank ?? "—"} · ${score.overall_score}/100`}</Tag>}
        </div>
        {score && <CandidateScoreDetail score={score} scoringRun={scoringRun} />}
        {[
          ["Hook", candidate.hook],
          ["Core Message", candidate.core_message],
          ["Psychological Angle", candidate.psychological_angle ?? "Not provided"],
          ["CTA", candidate.cta],
        ].map(([label, value]) => (
          <section key={label}>
            <h3 className="text-2xs font-medium uppercase tracking-wide text-paper-3">{label}</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-paper">{value}</p>
          </section>
        ))}
        <section>
          <h3 className="text-2xs font-medium uppercase tracking-wide text-paper-3">Evidence References</h3>
          <div className="mt-2 space-y-2">
            {candidate.evidence_references.map((reference, index) => (
              <div key={`${reference.source_ref ?? "source"}-${index}`} className="rounded border border-line bg-ink p-3 text-xs">
                <div className="font-mono text-2xs text-teal">{reference.source_ref}</div>
                <div className="mt-1 uppercase text-paper-3">{reference.evidence_type.replaceAll("_", " ")}</div>
                <div className="mt-1 text-paper">{reference.claim}</div>
                {reference.quoted_text && <blockquote className="mt-1 border-l border-line pl-2 text-paper">“{reference.quoted_text}”</blockquote>}
                {reference.support_span && <blockquote className="mt-1 border-l border-line pl-2 text-paper-2">{reference.support_span}</blockquote>}
                {reference.support_note && <div className="mt-1 text-paper-3">{reference.support_note}</div>}
                {reference.reasoning_note && <div className="mt-1 text-paper-3">{reference.reasoning_note}</div>}
              </div>
            ))}
          </div>
        </section>
        <section className="rounded border border-line bg-ink p-4">
          <h3 className="text-2xs font-medium uppercase tracking-wide text-paper-3">Source</h3>
          <div className="mt-2 text-sm text-paper">{research?.source_title ?? "Approved client authority"}</div>
          {externalUrl ? (
            <a className="mt-1 block break-all text-xs text-teal hover:underline" href={research?.source_url} target="_blank" rel="noreferrer">
              {research?.source_url}
            </a>
          ) : (
            <div className="mt-1 break-all font-mono text-2xs text-paper-3">{research?.source_url ?? "No source URL"}</div>
          )}
          <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-ink-200 p-3 text-2xs leading-5 text-paper-3">
            {research?.source_excerpt ?? "No bounded excerpt is available."}
          </pre>
        </section>
        <section className="grid gap-2 text-2xs text-paper-3 sm:grid-cols-2">
          <div><span className="text-paper-2">Technique:</span> {candidate.technique?.name ?? candidate.technique_run?.technique_slug ?? "Unknown"}</div>
          <div><span className="text-paper-2">Run:</span> {run?.id ?? candidate.ideation_cycle_id}</div>
          <div><span className="text-paper-2">Model:</span> {candidate.model_provider} / {candidate.model_name}</div>
          <div><span className="text-paper-2">Prompt:</span> {candidate.prompt_version}</div>
          <div><span className="text-paper-2">Source provider:</span> {research?.source_provider ?? "Unavailable"}</div>
          <div><span className="text-paper-2">Analysis:</span> {research?.analysis_provider ? `${research.analysis_provider} / ${research.analysis_model}` : "No model analysis"}</div>
        </section>
      </div>
    </Modal>
  );
}


function CandidateCard({
  candidate,
  score,
  showRank,
  onOpen,
}: {
  candidate: IdeationCandidate;
  score: IdeationCandidateScore | null;
  showRank: boolean;
  onOpen: () => void;
}) {
  const scoreSummary = score
    ? `, ${bandDescription(score.priority_band, score.overall_score)}${score.rank !== null ? `, rank ${score.rank}` : ""}`
    : "";
  const strategicKinds = strategicKindsForCandidate(candidate);
  return (
    <button
      type="button"
      aria-label={`Open ${candidate.working_title}${scoreSummary}`}
      className="flex min-h-[160px] w-full flex-col gap-3 rounded-[10px] border border-line bg-ink-200 p-4 text-left transition-colors hover:border-teal/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal/60"
      onClick={onOpen}
    >
      <div className="flex items-start gap-2">
        {showRank && score?.rank !== null && score !== null && (
          <span className="rounded border border-line bg-ink px-1.5 py-0.5 font-mono text-2xs text-paper">
            #{score.rank}
          </span>
        )}
        <h3 className="min-w-0 flex-1 text-sm font-medium text-paper">{candidate.working_title}</h3>
        {score ? (
          <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-2xs ${bandToneClass(score.priority_band)}`}>
            {score.overall_score}/100 {score.priority_band}
          </span>
        ) : (
          <Tag kind="decision">{candidate.status.replaceAll("_", " ")}</Tag>
        )}
      </div>
      <p className="line-clamp-3 text-xs leading-5 text-paper-3">{candidate.hook}</p>
      <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2 text-2xs text-paper-3">
        <span>{candidate.technique?.name ?? "Technique"}</span>
        <span>·</span>
        <span>{candidate.asset_type}</span>
        {strategicKinds.map((kind) => (
          <Tag key={kind} kind="muted">{STRATEGIC_SOURCE_LABEL[kind]}</Tag>
        ))}
        <span>·</span>
        <span className="min-w-0 truncate">{scoreIndicator(score)}</span>
        <span className="ml-auto">{new Date(candidate.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
    </button>
  );
}

function StrategicInputsCard({
  inputs,
  selectedKinds,
}: {
  inputs: IdeationAuthorityInput[];
  selectedKinds: IdeationStrategicSourceKind[];
}) {
  const counts: Record<IdeationStrategicSourceKind, number> = {
    campaign_intelligence: 0,
    main_offer: 0,
    seasonal_offer: 0,
    avatar: 0,
  };
  for (const input of inputs) counts[input.source_kind] += 1;
  const preview = inputs.slice(0, 5);
  return (
    <div className="mt-4 rounded border border-line bg-ink p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xs font-medium uppercase tracking-wide text-paper-2">Strategic Inputs</h2>
          <p className="mt-1 text-2xs text-paper-3">
            Optional Campaign, Offer, and Avatar authority available to this Ideation cycle.
          </p>
          <p className="mt-1 font-mono text-2xs text-paper-3">
            Source policy: {selectedKinds.length
              ? selectedKinds.map((kind) => STRATEGIC_SOURCE_LABEL[kind]).join(", ")
              : "No Campaign, Offer, or Avatar authority"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tag kind={counts.campaign_intelligence ? "decision" : "muted"}>
            Campaign {counts.campaign_intelligence}
          </Tag>
          <Tag kind={counts.main_offer ? "task" : "muted"}>
            Main Offers {counts.main_offer}
          </Tag>
          <Tag kind={counts.seasonal_offer ? "task" : "muted"}>
            Seasonal {counts.seasonal_offer}
          </Tag>
          <Tag kind={counts.avatar ? "decision" : "muted"}>
            Avatar {counts.avatar}
          </Tag>
        </div>
      </div>
      {preview.length > 0 ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {preview.map((input) => (
            <div key={input.id} className="rounded border border-line bg-ink-200 px-3 py-2 text-2xs">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded border border-line bg-ink px-1.5 py-0.5 font-mono text-paper-3">
                  {input.source_kind.replaceAll("_", " ")}
                </span>
                <span className="min-w-0 truncate text-paper">{input.title}</span>
              </div>
              {input.summary && <p className="mt-1 line-clamp-2 text-paper-3">{input.summary}</p>}
            </div>
          ))}
          {inputs.length > preview.length && (
            <div className="rounded border border-dashed border-line px-3 py-2 text-2xs text-paper-3">
              {inputs.length - preview.length} more approved inputs are included in the run snapshot.
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 rounded border border-dashed border-line px-3 py-3 text-2xs text-paper-3">
          No approved Campaign Intelligence, Offer, or Avatar inputs were active when this run was created.
        </p>
      )}
    </div>
  );
}

function ScoreDimensions({ score }: { score: IdeationCandidateScore }) {
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
      {IDEATION_SCORE_DIMENSIONS.map((dimension) => (
        <div key={dimension.key} className="flex items-baseline gap-2 text-xs">
          <dt className="min-w-0 flex-1 truncate text-paper-3">
            {dimension.label} <span className="text-paper-3">(w{dimension.weight})</span>
          </dt>
          <dd className="font-mono text-paper">{score[dimension.key]}/10</dd>
        </div>
      ))}
    </dl>
  );
}

function CandidateScoreDetail({
  score,
  scoringRun,
}: {
  score: IdeationCandidateScore;
  scoringRun: IdeationScoringRun | null;
}) {
  return (
    <section className="rounded border border-line bg-ink p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-2xs font-medium uppercase tracking-wide text-paper-3">Score</h3>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-2xs ${bandToneClass(score.priority_band)}`}>
          {bandDescription(score.priority_band, score.overall_score)}
        </span>
        {score.rank !== null && (
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-2xs text-paper">
            Rank {score.rank}
          </span>
        )}
      </div>
      <ScoreDimensions score={score} />
      <div className="mt-3">
        <h4 className="text-2xs font-medium uppercase tracking-wide text-paper-3">Rationale</h4>
        <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-paper">{score.rationale}</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="text-2xs font-medium uppercase tracking-wide text-paper-3">Strengths</h4>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-paper">
            {score.strengths.map((entry) => <li key={entry}>{entry}</li>)}
          </ul>
        </div>
        <div>
          <h4 className="text-2xs font-medium uppercase tracking-wide text-paper-3">Risks</h4>
          {score.risks.length ? (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-warn">
              {score.risks.map((entry) => <li key={entry}>{entry}</li>)}
            </ul>
          ) : <p className="mt-1 text-xs text-paper-3">No risks were recorded.</p>}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="text-2xs font-medium uppercase tracking-wide text-paper-3">Scoring authority references</h4>
          {score.authority_references.length ? (
            <ul className="mt-1 space-y-0.5 font-mono text-2xs text-teal">
              {score.authority_references.map((entry) => <li key={entry} className="break-all">{entry}</li>)}
            </ul>
          ) : <p className="mt-1 text-2xs text-paper-3">None cited.</p>}
        </div>
        <div>
          <h4 className="text-2xs font-medium uppercase tracking-wide text-paper-3">Candidate evidence references</h4>
          {score.evidence_references.length ? (
            <ul className="mt-1 space-y-0.5 font-mono text-2xs text-teal">
              {score.evidence_references.map((entry) => <li key={entry} className="break-all">{entry}</li>)}
            </ul>
          ) : <p className="mt-1 text-2xs text-paper-3">None cited.</p>}
        </div>
      </div>
      <div className="mt-3 grid gap-2 border-t border-line pt-3 text-2xs text-paper-3 sm:grid-cols-2">
        <div><span className="text-paper-2">Rubric:</span> {score.rubric_version}</div>
        <div><span className="text-paper-2">Scoring run:</span> {score.scoring_run_id}</div>
        <div><span className="text-paper-2">Model:</span> {score.provider} / {score.model}</div>
        <div><span className="text-paper-2">Prompt:</span> {score.prompt_version}</div>
        <div><span className="text-paper-2">Output schema:</span> {score.output_schema_version}</div>
        <div><span className="text-paper-2">Scoring attempt:</span> {scoringRun?.attempt_count ?? "unknown"}</div>
      </div>
    </section>
  );
}

function RescoreConfirmModal({
  expectedCandidates,
  previousRunId,
  busy,
  onCancel,
  onConfirm,
}: {
  expectedCandidates: number;
  previousRunId: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      title="Re-score content"
      description="This starts a new scoring run. The previous run and its scores are preserved."
      onClose={onCancel}
      closeDisabled={busy}
      widthClass="max-w-lg"
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={onConfirm}>
            {busy ? "Re-scoring…" : "Re-score content"}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-xs text-paper">
        <p>All {expectedCandidates} candidates will be scored again against the same approved authority.</p>
        <p className="text-paper-3">
          The current scoring run stays in history and remains readable. The new run records it as the run it supersedes.
        </p>
        <p className="font-mono text-2xs text-paper-3">Superseding {previousRunId}</p>
      </div>
    </Modal>
  );
}

function GenerationModal({
  clientId,
  executionMonth,
  coordinator,
  onClose,
  onGenerated,
  onFailed,
}: {
  clientId: string;
  executionMonth: string;
  coordinator: IdeationRequestCoordinator;
  onClose: () => void;
  onGenerated: (result: RunIdeationResponse, token: IdeationMutationToken) => Promise<void>;
  onFailed: (error: unknown, token: IdeationMutationToken) => Promise<boolean>;
}) {
  const [periodType, setPeriodType] = useState<IdeationPeriodType>("one_week");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(plusDays(todayIso(), 6));
  const [month, setMonth] = useState(executionMonth);
  const [strategicSourceKinds, setStrategicSourceKinds] = useState<IdeationStrategicSourceKind[]>(
    STRATEGIC_SOURCE_OPTIONS.map((source) => source.value),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const initialFocusRef = useRef<HTMLInputElement>(null);

  const updatePeriod = (value: IdeationPeriodType) => {
    setPeriodType(value);
    setError(null);
    idempotencyKey.current = null;
  };
  const updateMaterialField = (setter: (value: string) => void, value: string) => {
    setter(value);
    setError(null);
    idempotencyKey.current = null;
  };
  const toggleStrategicSource = (source: IdeationStrategicSourceKind) => {
    setStrategicSourceKinds((current) => current.includes(source)
      ? current.filter((item) => item !== source)
      : [...current, source]);
    setError(null);
    idempotencyKey.current = null;
  };

  async function generate() {
    if (busy) return;
    if (periodType === "date_range" && (!startDate || !endDate || endDate < startDate)) {
      setError("Choose a valid start and end date.");
      return;
    }
    if (periodType === "date_range" && inclusiveDays(startDate, endDate) > 31) {
      setError("Date Range may contain at most 31 inclusive days.");
      return;
    }
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    const token = coordinator.begin("generate", clientId);
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runIdeation({
        client_id: clientId,
        period_type: periodType,
        start_date: periodType === "date_range" || periodType === "one_day" || periodType === "one_week" ? startDate : undefined,
        end_date: periodType === "date_range" ? endDate : undefined,
        month: periodType === "one_month" ? month : undefined,
        idempotency_key: idempotencyKey.current,
        strategic_input_sources: strategicSourceKinds,
      });
      if (coordinator.isCurrent(token)) await onGenerated(result, token);
    } catch (value) {
      // Retain the key after a transport/provider failure. An operator retry
      // therefore cannot create duplicate runs or candidates.
      if (coordinator.isCurrent(token)) {
        const handled = await onFailed(value, token);
        if (!handled && coordinator.isCurrent(token)) {
          setError(decodeIdeationInvocationFailure(value)?.message ?? errorText(value));
        }
      }
    } finally {
      if (coordinator.isCurrent(token)) setBusy(false);
      coordinator.finish(token);
    }
  }

  return (
    <Modal
      title="Generation Period"
      description="Techniques are selected and orchestrated internally from approved client authority."
      onClose={onClose}
      closeDisabled={busy}
      initialFocusRef={initialFocusRef}
      footer={(
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button variant="primary" className="ml-auto" disabled={busy} onClick={() => void generate()}>
            {busy ? "Generating…" : "Generate"}
          </Button>
        </>
      )}
    >
      <fieldset className="space-y-2">
        <legend className="mb-2 text-2xs font-medium uppercase tracking-wide text-paper-3">Choose a period</legend>
        {PERIODS.map((period) => (
          <label key={period.value} className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${periodType === period.value ? "border-teal/50 bg-teal/5" : "border-line bg-ink"}`}>
            <input
              ref={period.value === "one_week" ? initialFocusRef : undefined}
              type="radio"
              name="ideation-period"
              value={period.value}
              checked={periodType === period.value}
              onChange={() => updatePeriod(period.value)}
              className="mt-0.5 accent-teal"
            />
            <span>
              <span className="block text-sm text-paper">{period.label}</span>
              <span className="mt-0.5 block text-2xs text-paper-3">{period.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {(periodType === "one_day" || periodType === "one_week") && (
        <label className="mt-4 flex max-w-xs flex-col gap-1">
          <span className="text-2xs uppercase text-paper-3">
            {periodType === "one_day" ? "Date" : "Week Start"}
          </span>
          <input
            type="date"
            className={FIELD_CLASS}
            value={startDate}
            onChange={(event) => updateMaterialField(setStartDate, event.target.value)}
          />
          {periodType === "one_week" && startDate && (
            <span className="text-2xs text-paper-3">Ends {plusDays(startDate, 6)} (inclusive).</span>
          )}
        </label>
      )}
      {periodType === "date_range" && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-2xs uppercase text-paper-3">Start Date</span>
            <input type="date" className={FIELD_CLASS} value={startDate} onChange={(event) => updateMaterialField(setStartDate, event.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-2xs uppercase text-paper-3">End Date</span>
            <input type="date" className={FIELD_CLASS} min={startDate} value={endDate} onChange={(event) => updateMaterialField(setEndDate, event.target.value)} />
          </label>
        </div>
      )}
      {periodType === "one_month" && (
        <label className="mt-4 flex max-w-xs flex-col gap-1">
          <span className="text-2xs uppercase text-paper-3">Month</span>
          <input type="month" className={FIELD_CLASS} value={month} onChange={(event) => updateMaterialField(setMonth, event.target.value)} />
        </label>
      )}
      <fieldset className="mt-4 space-y-2">
        <legend className="mb-2 text-2xs font-medium uppercase tracking-wide text-paper-3">Strategic source mix</legend>
        <div className="grid gap-2">
          {STRATEGIC_SOURCE_OPTIONS.map((source) => (
            <label key={source.value} className={`flex cursor-pointer items-start gap-3 rounded border p-3 ${strategicSourceKinds.includes(source.value) ? "border-teal/50 bg-teal/5" : "border-line bg-ink"}`}>
              <input
                type="checkbox"
                checked={strategicSourceKinds.includes(source.value)}
                onChange={() => toggleStrategicSource(source.value)}
                className="mt-0.5 accent-teal"
              />
              <span>
                <span className="block text-sm text-paper">{source.label}</span>
                <span className="mt-0.5 block text-2xs text-paper-3">{source.description}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-2xs text-paper-3">
          These inputs are optional context. Proof, manual ideas, and the seven research techniques remain independent Ideation sources; avatar-led ideas are never mandatory.
        </p>
      </fieldset>
      {error && <div role="alert" className="mt-4 rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
      {busy && <p className="mt-4 text-2xs text-paper-3">The generation request continues safely if this route changes. This modal remains locked until it finishes.</p>}
    </Modal>
  );
}

/**
 * Run → Candidates → Score. This is the AI intake method inside Content
 * Supply's Ideation subtab, alongside Add Idea and Add Proof. Scoring is
 * the last AI-side stage: on completion, every scored candidate lands in
 * Sources (content_sources, kind ideation_candidate) automatically, for the
 * same approve/disapprove gate a manual idea or proof item goes through.
 * There is no calendar pre-assignment here — scheduling happens once,
 * uniformly, at Content Items.
 */
export function IdeationPanel({
  clientId,
  executionMonth,
}: {
  clientId: string;
  executionMonth: string;
}) {
  const [overview, setOverview] = useState<IdeationOverview>({ runs: [], technique_runs: [], research_results: [], candidates: [], authority_inputs: [] });
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [openCandidate, setOpenCandidate] = useState<IdeationCandidate | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generationWarnings, setGenerationWarnings] = useState<RunIdeationResponse["warnings"]>([]);
  const [scoring, setScoring] = useState<IdeationScoringOverview>({ scoring_runs: [], scores: [] });
  const [scoringBusy, setScoringBusy] = useState(false);
  const [rescoreOpen, setRescoreOpen] = useState(false);
  const [orderMode, setOrderMode] = useState<"ranked" | "original">("ranked");
  const requestSequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const clientIdRef = useRef(clientId);
  const coordinatorRef = useRef<IdeationRequestCoordinator | null>(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createIdeationRequestCoordinator(clientId);
  }
  clientIdRef.current = clientId;
  coordinatorRef.current.synchronizeClient(clientId);
  const coordinator = coordinatorRef.current;

  const load = useCallback(async (
    preferredRunId?: string,
    mutationToken?: IdeationMutationToken,
  ) => {
    const originatingClientId = clientId;
    if (mutationToken && !coordinator.isCurrent(mutationToken)) return;
    if (clientIdRef.current !== originatingClientId) return;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchIdeationOverview(clientId, controller.signal);
      const cycleIds = next.runs.map((run) => run.id);
      const nextScoring = await fetchIdeationScoringOverview(clientId, cycleIds, controller.signal);
      if (
        requestId !== requestSequence.current
        || controller.signal.aborted
        || clientIdRef.current !== originatingClientId
        || (mutationToken && !coordinator.isCurrent(mutationToken))
      ) return;
      setOverview(next);
      setScoring(nextScoring);
      setSelectedRunId((current) => preferredRunId ?? current ?? next.runs[0]?.id ?? null);
    } catch (value) {
      if (
        requestId !== requestSequence.current
        || controller.signal.aborted
        || isAbortError(value)
        || clientIdRef.current !== originatingClientId
        || (mutationToken && !coordinator.isCurrent(mutationToken))
      ) return;
      setError(errorText(value));
    } finally {
      if (
        requestId === requestSequence.current
        && !controller.signal.aborted
        && clientIdRef.current === originatingClientId
        && (!mutationToken || coordinator.isCurrent(mutationToken))
      ) setLoading(false);
    }
  }, [clientId, coordinator]);

  useEffect(() => {
    coordinator.synchronizeClient(clientId);
    requestController.current?.abort();
    requestSequence.current += 1;
    setOverview({ runs: [], technique_runs: [], research_results: [], candidates: [], authority_inputs: [] });
    setScoring({ scoring_runs: [], scores: [] });
    setScoringBusy(false);
    setRescoreOpen(false);
    setOrderMode("ranked");
    setSelectedRunId(null);
    setOpenCandidate(null);
    setGenerationWarnings([]);
    setError(null);
    setNotice(null);
    setGenerateOpen(false);
    setRetrying(false);
    setLoading(true);
    void load();
    return () => {
      requestController.current?.abort();
      requestSequence.current += 1;
    };
  }, [clientId, coordinator, load]);

  useEffect(() => () => {
    requestController.current?.abort();
    coordinator.dispose();
  }, [coordinator]);
  const selectedRun = overview.runs.find((run) => run.id === selectedRunId) ?? overview.runs[0] ?? null;
  const candidates = useMemo(
    () => selectedRun ? overview.candidates.filter((candidate) => candidate.ideation_cycle_id === selectedRun.id) : [],
    [overview.candidates, selectedRun],
  );
  const selectedTechniqueRuns = selectedRun
    ? overview.technique_runs
      .filter((run) => run.ideation_cycle_id === selectedRun.id)
      .sort((left, right) => left.technique_order - right.technique_order)
    : [];
  const selectedAuthorityInputs = useMemo(
    () => selectedRun ? overview.authority_inputs.filter((input) => input.ideation_cycle_id === selectedRun.id) : [],
    [overview.authority_inputs, selectedRun],
  );
  const selectedStrategicSourceKinds = useMemo(
    () => selectedSourceKinds(selectedRun),
    [selectedRun],
  );

  const selectedScoringRun = useMemo(
    () => activeScoringRun(scoring.scoring_runs, selectedRun?.id ?? null),
    [scoring.scoring_runs, selectedRun],
  );
  const selectedScoringHistory = useMemo(
    () => scoringRunHistory(scoring.scoring_runs, selectedRun?.id ?? null),
    [scoring.scoring_runs, selectedRun],
  );
  const displayCandidates = useMemo(
    () => orderCandidatesForDisplay(candidates, scoring.scores, selectedScoringRun, orderMode),
    [candidates, scoring.scores, selectedScoringRun, orderMode],
  );
  const showRankedList = orderMode === "ranked" && selectedScoringRun?.status === "completed";
  const scoreByCandidateId = useMemo(() => {
    const map = new Map<string, IdeationCandidateScore>();
    if (selectedScoringRun) {
      for (const score of scoring.scores) {
        if (score.scoring_run_id === selectedScoringRun.id) map.set(score.candidate_id, score);
      }
    }
    return map;
  }, [scoring.scores, selectedScoringRun]);

  // One entry point for all three scoring mutations. Each captures the
  // originating client and a coordinator token, so a client change, an unmount,
  // or a duplicate click can never apply a stale result.
  async function runScoring(kind: "score" | "retry-score" | "rescore", rescoreOf?: string) {
    if (!selectedRun || scoringBusy) return;
    const originatingClientId = clientId;
    const originatingRunId = selectedRun.id;
    const token = coordinator.begin(kind, originatingClientId);
    if (!token) return;
    setScoringBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await scoreIdeationCandidates({
        client_id: originatingClientId,
        ideation_cycle_id: originatingRunId,
        rescore_of_scoring_run_id: rescoreOf,
      });
      if (!coordinator.isCurrent(token) || clientIdRef.current !== originatingClientId) return;
      setRescoreOpen(false);
      setOrderMode("ranked");
      setNotice(result.idempotent_replay
        ? "Existing scoring result returned; no duplicate scoring run was created."
        : result.scoring_run.status === "completed"
          ? "Candidates scored and ranked. They now appear in Sources for approval."
          : `Scoring retained ${result.scoring_run.scored_candidate_count} scores; some candidates remain unscored.`);
      await load(originatingRunId, token);
    } catch (value) {
      if (!coordinator.isCurrent(token) || clientIdRef.current !== originatingClientId) return;
      const failure = decodeIdeationScoringInvocationFailure(value);
      setRescoreOpen(false);
      if (failure) {
        setError(
          `${failure.message}${
            failure.shortfall !== null && failure.shortfall > 0
              ? ` (${failure.shortfall} candidates unscored)`
              : ""
          }`,
        );
        await load(originatingRunId, token);
      } else {
        setError(errorText(value));
      }
    } finally {
      if (coordinator.isCurrent(token) && clientIdRef.current === originatingClientId) {
        setScoringBusy(false);
      }
      coordinator.finish(token);
    }
  }

  async function retrySelectedRun() {
    if (!selectedRun || selectedRun.status !== "retryable" || retrying) return;
    const originatingClientId = clientId;
    const token = coordinator.begin("retry", originatingClientId);
    if (!token) return;
    setRetrying(true);
    setError(null);
    setNotice(null);
    try {
      const result = await runIdeation({
        client_id: clientId,
        period_type: selectedRun.period_type,
        start_date: selectedRun.period_type === "one_month" ? undefined : selectedRun.period_start,
        end_date: selectedRun.period_type === "date_range" ? selectedRun.period_end : undefined,
        month: selectedRun.period_type === "one_month" ? selectedRun.period_start.slice(0, 7) : undefined,
        idempotency_key: selectedRun.idempotency_key,
        strategic_input_sources: selectedSourceKinds(selectedRun),
      });
      if (!coordinator.isCurrent(token) || clientIdRef.current !== originatingClientId) return;
      setGenerationWarnings(result.warnings);
      setNotice(result.run.status === "completed"
        ? "Missing ideas generated; the run now satisfies its required quantity."
        : `Retry retained successful ideas; ${result.run.shortfall_count} ideas remain missing.`);
      await load(result.run.id, token);
    } catch (value) {
      if (!coordinator.isCurrent(token) || clientIdRef.current !== originatingClientId) return;
      const failure = decodeIdeationInvocationFailure(value);
      if (failure) {
        setGenerationWarnings(failure.warnings);
        setError(
          `${failure.message}${failure.shortfall !== null ? ` (${failure.shortfall} ideas missing)` : ""}`,
        );
        if (failure.cycle_id) await load(failure.cycle_id, token);
      } else {
        setError(errorText(value));
      }
    } finally {
      if (coordinator.isCurrent(token) && clientIdRef.current === originatingClientId) {
        setRetrying(false);
      }
      coordinator.finish(token);
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <header className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-ink-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-medium text-paper">Generate Content</h1>
          <p className="mt-1 text-2xs text-paper-3">Generate upstream ideas from approved Context and Execution Files. Scored candidates enter Sources automatically.</p>
        </div>
        <Button variant="primary" onClick={() => { setNotice(null); setGenerationWarnings([]); setGenerateOpen(true); }}>Generate Content</Button>
      </header>

      {error && <div role="alert" className="mt-3 rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
      {notice && <div className="mt-3 rounded border border-teal/20 bg-teal/5 px-3 py-2 text-xs text-teal">{notice}</div>}

      {loading ? (
        <div className="mt-4"><EmptyState icon="clock" title="Loading Ideation" body="Loading runs and generated candidates." /></div>
      ) : !selectedRun ? (
        <div className="mt-4"><EmptyState icon="circle" title="No Ideas Yet" body="Generate content to create the first upstream Ideation run." /></div>
      ) : (
        <div className="mt-4 space-y-5">
          <section className="rounded-[10px] border border-line bg-ink-200 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-2xs font-medium uppercase tracking-wide text-paper-3">Run</div>
                <div className="mt-1 text-sm text-paper">{generatedLabel(selectedRun)}</div>
                <div className="mt-1 font-mono text-2xs text-paper-3">
                  {periodLabel(selectedRun)} · {selectedRun.status.replaceAll("_", " ")} · attempt {selectedRun.attempt_count}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xl text-paper">{candidates.length} / {selectedRun.expected_candidate_count} Ideas</div>
                {selectedRun.shortfall_count > 0 && <div className="mt-1 text-2xs text-warn">{selectedRun.shortfall_count} missing</div>}
              </div>
              {overview.runs.length > 1 && (
                <select
                  className={FIELD_CLASS}
                  value={selectedRun.id}
                  onChange={(event) => {
                    setSelectedRunId(event.target.value);
                    setGenerationWarnings([]);
                    setOpenCandidate(null);
                    setRescoreOpen(false);
                    setOrderMode("ranked");
                    setNotice(null);
                  }}
                >
                  {overview.runs.map((run) => <option key={run.id} value={run.id}>{new Date(run.created_at).toLocaleString()} · {run.candidate_count} ideas</option>)}
                </select>
              )}
            </div>
            {selectedRun.status === "retryable" && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-warn/20 bg-warn/5 p-3">
                <p className="min-w-0 flex-1 text-2xs text-warn">Successful candidates are retained. Retry only the missing technique slots.</p>
                <Button variant="secondary" disabled={retrying} onClick={() => void retrySelectedRun()}>
                  {retrying ? "Retrying…" : "Retry missing ideas"}
                </Button>
              </div>
            )}
            {selectedRun.status === "failed" && (
              <p className="mt-3 text-2xs text-neg">
                {selectedRun.error_message ?? "Generation failed."}
                {selectedRun.error_code ? ` (${selectedRun.error_code})` : ""}
              </p>
            )}
            <StrategicInputsCard inputs={selectedAuthorityInputs} selectedKinds={selectedStrategicSourceKinds} />
            <div className="mt-4 rounded border border-line bg-ink p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xs font-medium uppercase tracking-wide text-paper-2">Score and Sort</h2>
                  <p className="mt-1 text-2xs text-paper-3" id="ideation-scoring-status" role="status">
                    {selectedScoringRun
                      ? `${selectedScoringRun.status.replaceAll("_", " ")} · ${scoringProgressLabel(selectedScoringRun)}`
                      : selectedRun.status === "completed"
                        ? "This run is eligible for scoring."
                        : "Only a completed run with every candidate generated can be scored."}
                  </p>
                </div>
                {canStartScoring(selectedRun.status, selectedScoringRun) && (
                  <Button
                    variant="primary"
                    disabled={scoringBusy}
                    aria-busy={scoringBusy}
                    aria-describedby="ideation-scoring-status"
                    onClick={() => void runScoring("score")}
                  >
                    {scoringBusy ? "Scoring…" : "Score and Sort Content"}
                  </Button>
                )}
                {canRetryScoring(selectedScoringRun) && (
                  <Button
                    variant="secondary"
                    disabled={scoringBusy}
                    aria-busy={scoringBusy}
                    aria-describedby="ideation-scoring-status"
                    onClick={() => void runScoring("retry-score")}
                  >
                    {scoringBusy ? "Retrying…" : "Retry Scoring"}
                  </Button>
                )}
                {canRescore(selectedScoringRun) && (
                  <Button
                    variant="secondary"
                    disabled={scoringBusy}
                    aria-busy={scoringBusy}
                    aria-describedby="ideation-scoring-status"
                    onClick={() => setRescoreOpen(true)}
                  >
                    Re-score Content
                  </Button>
                )}
              </div>
              {selectedScoringRun?.status === "running" && (
                <p className="mt-2 text-2xs text-teal">
                  Scoring is in progress. Attempt {selectedScoringRun.attempt_count} of {selectedScoringRun.maximum_attempts}.
                </p>
              )}
              {selectedScoringRun && selectedScoringRun.status !== "running" && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-paper-3">
                  <span>expected {selectedScoringRun.expected_candidate_count}</span>
                  <span>scored {selectedScoringRun.scored_candidate_count}</span>
                  <span>failed {selectedScoringRun.failed_candidate_count}</span>
                  <span>rubric {selectedScoringRun.rubric_version}</span>
                  <span className="break-all">active run {selectedScoringRun.id}</span>
                  {selectedScoringRun.supersedes_scoring_run_id && (
                    <span className="break-all">supersedes {selectedScoringRun.supersedes_scoring_run_id}</span>
                  )}
                  {selectedScoringHistory.length > 1 && (
                    <span>{selectedScoringHistory.length} scoring runs in history</span>
                  )}
                </div>
              )}
              {selectedScoringRun?.error_message && (
                <p className="mt-2 text-2xs text-warn">
                  {selectedScoringRun.error_message}
                  {selectedScoringRun.error_code ? ` (${selectedScoringRun.error_code})` : ""}
                </p>
              )}
              {selectedScoringRun?.status === "completed" && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-2xs text-paper-3">Order</span>
                  <Button
                    variant={orderMode === "ranked" ? "primary" : "secondary"}
                    size="sm"
                    aria-pressed={orderMode === "ranked"}
                    onClick={() => setOrderMode("ranked")}
                  >
                    Ranked
                  </Button>
                  <Button
                    variant={orderMode === "original" ? "primary" : "secondary"}
                    size="sm"
                    aria-pressed={orderMode === "original"}
                    onClick={() => setOrderMode("original")}
                  >
                    Original order (audit)
                  </Button>
                  <span className="ml-auto text-2xs text-teal">Scored candidates are in Sources for review.</span>
                </div>
              )}
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <h2 className="text-2xs font-medium uppercase tracking-wide text-paper-2">Technique Runs</h2>
                <span className="font-mono text-2xs text-paper-3">{selectedTechniqueRuns.length} / 7</span>
              </div>
              {selectedTechniqueRuns.length > 0 ? (
                <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {selectedTechniqueRuns.map((run) => (
                  <div key={run.id} className="rounded border border-warn/20 bg-ink px-3 py-2 text-2xs">
                    <div className="flex items-center gap-2 text-paper-2">
                      <span className="font-mono text-paper-3">{run.technique_order}</span>
                      <span>{run.technique_slug.replaceAll("-", " ")}</span>
                      <span className="ml-auto text-paper-3">{run.status.replaceAll("_", " ")}</span>
                    </div>
                    <div className="mt-1 text-paper-3">
                      {run.generated_slots}/{run.requested_slots.length} slots · {run.retryable ? "retryable" : "not retryable"}
                      {run.error_code ? ` · ${run.error_code}` : ""}
                    </div>
                    {run.error_message && <div className="mt-1 text-warn">{run.error_message}</div>}
                  </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 rounded border border-dashed border-line px-3 py-3 text-2xs text-paper-3">
                  Technique-run state is not yet available.
                </p>
              )}
            </div>
            {generationWarnings.length > 0 && (
              <div className="mt-3 space-y-1">
                {generationWarnings.map((warning) => (
                  <p key={`${warning.technique}:${warning.code}`} className="text-2xs text-warn">
                    {warning.technique}: {warning.message} ({warning.generated_slots}/{warning.requested_slots})
                  </p>
                ))}
              </div>
            )}
          </section>

          {showRankedList ? (
            <section>
              <div className="mb-2 flex items-center gap-2 border-b border-line pb-2">
                <h2 className="text-2xs font-medium uppercase tracking-wide text-paper-2">Ranked Content</h2>
                <span className="rounded-full border border-line bg-ink-100 px-2 py-0.5 font-mono text-2xs text-paper">
                  {displayCandidates.length}
                </span>
                <span className="text-2xs text-paper-3">Highest ranked first</span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {displayCandidates.map(({ candidate, score }) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    score={score}
                    showRank
                    onOpen={() => setOpenCandidate(candidate)}
                  />
                ))}
              </div>
            </section>
          ) : (
            GROUPS.map(({ assetType, label }) => {
              const group = displayCandidates.filter((entry) => entry.candidate.asset_type === assetType);
              return (
                <section key={assetType}>
                  <div className="mb-2 flex items-center gap-2 border-b border-line pb-2">
                    <h2 className="text-2xs font-medium uppercase tracking-wide text-paper-2">{label}</h2>
                    <span className="rounded-full border border-line bg-ink-100 px-2 py-0.5 font-mono text-2xs text-paper">{group.length}</span>
                  </div>
                  {group.length ? (
                    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                      {group.map(({ candidate, score }) => (
                        <CandidateCard
                          key={candidate.id}
                          candidate={candidate}
                          score={score}
                          showRank={false}
                          onOpen={() => setOpenCandidate(candidate)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded border border-dashed border-line px-3 py-4 text-xs text-paper-3">No {label.toLowerCase()} were required for this period.</p>
                  )}
                </section>
              );
            })
          )}
        </div>
      )}

      {generateOpen && (
        <GenerationModal
          clientId={clientId}
          executionMonth={executionMonth}
          coordinator={coordinator}
          onClose={() => setGenerateOpen(false)}
          onGenerated={async (result, token) => {
            if (!coordinator.isCurrent(token) || clientIdRef.current !== token.clientId) return;
            setGenerateOpen(false);
            setGenerationWarnings(result.warnings);
            setNotice(result.idempotent_replay
              ? "Existing result returned; no duplicate candidates were created."
              : result.run.status === "retryable"
                ? `Successful ideas retained; ${result.run.shortfall_count} missing ideas can be retried.`
                : "Ideas generated and ready to review.");
            await load(result.run.id, token);
          }}
          onFailed={async (value, token) => {
            if (!coordinator.isCurrent(token) || clientIdRef.current !== token.clientId) return true;
            const failure = decodeIdeationInvocationFailure(value);
            if (!failure) return false;
            if (!failure.cycle_id) return false;
            setGenerationWarnings(failure.warnings);
            setError(
              `${failure.message}${failure.shortfall !== null ? ` (${failure.shortfall} ideas missing)` : ""}`,
            );
            setGenerateOpen(false);
            await load(failure.cycle_id, token);
            return true;
          }}
        />
      )}
      {rescoreOpen && selectedScoringRun && (
        <RescoreConfirmModal
          expectedCandidates={selectedScoringRun.expected_candidate_count}
          previousRunId={selectedScoringRun.id}
          busy={scoringBusy}
          onCancel={() => setRescoreOpen(false)}
          onConfirm={() => void runScoring("rescore", selectedScoringRun.id)}
        />
      )}
      {openCandidate && (
        <CandidateDetail
          candidate={openCandidate}
          run={selectedRun}
          score={scoreByCandidateId.get(openCandidate.id) ?? null}
          scoringRun={selectedScoringRun}
          onClose={() => setOpenCandidate(null)}
        />
      )}
    </div>
  );
}
