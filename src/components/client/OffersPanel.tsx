import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Panel, StatusDot, Tag } from "@/components/primitives";
import {
  driveOffersBuild,
  fetchOffersWorkspace,
  reviewOffersRelease,
} from "@/lib/offers";
import type {
  MainOffer,
  MoneyModelComponent,
  OfferApprovalDecision,
  OfferType,
  OffersWorkspace,
  RunOffersStepResponse,
  SeasonalOffer,
  SeasonalOfferCampaignPeriodOption,
  SeasonalOfferMainOfferOption,
} from "@/types/offers";

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function statusTone(status: string | null | undefined): "live" | "idle" | "warn" | "error" | "paused" {
  if (status === "approved" || status === "completed") return "live";
  if (status === "needs_review" || status === "running") return "warn";
  if (status === "failed") return "error";
  if (status === "archived" || status === "superseded" || status === "rejected") return "paused";
  return "idle";
}

function scaffoldCount(rows: Array<{ payload: Record<string, unknown> }>): number {
  return rows.filter((row) => row.payload.stage_4b_scaffold === true).length;
}

function mainWorkspace(workspace: OffersWorkspace | null) {
  return workspace?.offerType === "main" ? workspace : null;
}

function seasonalWorkspace(workspace: OffersWorkspace | null) {
  return workspace?.offerType === "seasonal" ? workspace : null;
}

function TextList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-paper-3">No approved items yet.</span>;
  return (
    <ul className="space-y-1">
      {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
    </ul>
  );
}

function MainOfferCard({ offer }: { offer: MainOffer }) {
  return (
    <div className="bg-ink-200 p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-paper">{offer.offer_name}</h3>
          <p className="mt-1 font-mono text-2xs text-paper-3">{offer.offer_key}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag kind="decision">{readable(offer.offer_role)}</Tag>
          <Tag kind="muted">{readable(offer.offer_stage)}</Tag>
          {offer.payload.human_review_required === true && <Tag kind="anomaly">Review required</Tag>}
        </div>
      </div>
      <dl className="mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-2">
        <div><dt className="text-2xs text-paper-3">Customer segment</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.customer_segment}</dd></div>
        <div><dt className="text-2xs text-paper-3">Problem</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.problem_addressed}</dd></div>
        <div><dt className="text-2xs text-paper-3">Promised outcome</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.promised_outcome}</dd></div>
        <div><dt className="text-2xs text-paper-3">Mechanism</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.mechanism}</dd></div>
      </dl>
      <div className="mt-4 border-t border-line pt-3">
        <h4 className="text-2xs uppercase tracking-wide text-paper-3">Value Equation</h4>
        <dl className="mt-3 grid gap-3 md:grid-cols-2">
          <div><dt className="text-2xs text-paper-3">Dream outcome</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.dream_outcome}</dd></div>
          <div><dt className="text-2xs text-paper-3">Perceived likelihood</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.perceived_likelihood}</dd></div>
          <div><dt className="text-2xs text-paper-3">Time delay</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.time_delay}</dd></div>
          <div><dt className="text-2xs text-paper-3">Effort / sacrifice</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.effort_sacrifice}</dd></div>
          <div className="md:col-span-2"><dt className="text-2xs text-paper-3">Price / risk / friction</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.price_risk_friction}</dd></div>
        </dl>
      </div>
      <dl className="mt-4 grid gap-3 border-t border-line pt-3 md:grid-cols-2">
        <div><dt className="text-2xs text-paper-3">Value stack</dt><dd className="mt-1 text-xs leading-5 text-paper-2"><TextList items={offer.value_stack} /></dd></div>
        <div><dt className="text-2xs text-paper-3">Bonus stack</dt><dd className="mt-1 text-xs leading-5 text-paper-2"><TextList items={offer.bonus_stack} /></dd></div>
        <div><dt className="text-2xs text-paper-3">Risk reversal</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.risk_reversal}</dd></div>
        <div><dt className="text-2xs text-paper-3">Guarantee</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.guarantee}</dd></div>
        <div><dt className="text-2xs text-paper-3">Pricing model</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.pricing_model}</dd></div>
        <div><dt className="text-2xs text-paper-3">Delivery model</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.delivery_model}</dd></div>
        <div><dt className="text-2xs text-paper-3">Offer sequence</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.offer_sequence_note}</dd></div>
        <div><dt className="text-2xs text-paper-3">Money model notes</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.money_model_notes}</dd></div>
        <div><dt className="text-2xs text-paper-3">Eligibility</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.eligibility}</dd></div>
        <div><dt className="text-2xs text-paper-3">Proof requirements</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.proof_requirements}</dd></div>
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-2xs leading-4 text-paper-3">{offer.constraints}</p>
    </div>
  );
}

function MoneyModelList({ components }: { components: MoneyModelComponent[] }) {
  if (components.length === 0) return null;
  return (
    <Panel title="Money Model" meta={`${components.length} components`}>
      <div className="grid gap-px bg-line md:grid-cols-2">
        {components.map((component) => (
          <div key={component.id} className="bg-ink-200 p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-paper">{component.title}</h3>
              <Tag kind="muted">{readable(component.component_type)}</Tag>
            </div>
            <p className="text-xs leading-5 text-paper-2">{component.description}</p>
            <dl className="mt-3 space-y-2 border-t border-line pt-3">
              <div><dt className="text-2xs text-paper-3">Trigger</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{component.trigger_condition}</dd></div>
              <div><dt className="text-2xs text-paper-3">Commercial role</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{component.commercial_role}</dd></div>
              <div><dt className="text-2xs text-paper-3">Dependency</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{component.dependency_note}</dd></div>
            </dl>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SeasonalOfferCard({ offer }: { offer: SeasonalOffer }) {
  return (
    <div className="bg-ink-200 p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-paper">{offer.title}</h3>
          <p className="mt-1 font-mono text-2xs text-paper-3">{offer.campaign_period_title}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {offer.main_offer_id && <Tag kind="decision">Main offer linked</Tag>}
          {offer.payload.does_not_rewrite_main_offer === true && <Tag kind="muted">Packaging only</Tag>}
          {offer.payload.human_review_required === true && <Tag kind="anomaly">Review required</Tag>}
        </div>
      </div>
      <p className="text-xs leading-5 text-paper-2">{offer.offer_angle}</p>
      <dl className="mt-3 grid gap-3 border-t border-line pt-3 md:grid-cols-2">
        <div><dt className="text-2xs text-paper-3">Packaging</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.packaging_direction}</dd></div>
        <div><dt className="text-2xs text-paper-3">Urgency</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.urgency_driver}</dd></div>
        <div><dt className="text-2xs text-paper-3">Bonus direction</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.bonus_direction}</dd></div>
        <div><dt className="text-2xs text-paper-3">Positioning</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.positioning_direction}</dd></div>
        <div><dt className="text-2xs text-paper-3">Mechanism</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.mechanism_direction}</dd></div>
        <div><dt className="text-2xs text-paper-3">Reason to act now</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.reason_to_act_now}</dd></div>
        <div><dt className="text-2xs text-paper-3">CTA direction</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.cta_direction}</dd></div>
        <div><dt className="text-2xs text-paper-3">Offer risk</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{offer.offer_risk}</dd></div>
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-2xs leading-4 text-paper-3">{offer.constraints}</p>
    </div>
  );
}

function SeasonalBuildSelection({
  campaignPeriods,
  mainOffers,
  selectedCampaignPeriodId,
  selectedMainOfferId,
  onCampaignPeriodChange,
  onMainOfferChange,
  disabled,
}: {
  campaignPeriods: SeasonalOfferCampaignPeriodOption[];
  mainOffers: SeasonalOfferMainOfferOption[];
  selectedCampaignPeriodId: string;
  selectedMainOfferId: string;
  onCampaignPeriodChange: (value: string) => void;
  onMainOfferChange: (value: string) => void;
  disabled: boolean;
}) {
  const selectedPeriod = campaignPeriods.find((period) => period.id === selectedCampaignPeriodId);
  const selectedOffer = mainOffers.find((offer) => offer.id === selectedMainOfferId);
  return (
    <Panel title="Seasonal build selection" meta="Approved inputs only">
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wide text-paper-3">Campaign period</span>
          <select
            value={selectedCampaignPeriodId}
            disabled={disabled || campaignPeriods.length === 0}
            onChange={(event) => onCampaignPeriodChange(event.target.value)}
            className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">Choose approved period...</option>
            {campaignPeriods.map((period) => (
              <option key={period.id} value={period.id}>{period.timing_label ? `${period.timing_label} - ${period.title}` : period.title}</option>
            ))}
          </select>
          <span className="text-2xs leading-4 text-paper-3">
            {selectedPeriod ? selectedPeriod.strategic_theme : "Approve Campaign Intelligence before packaging a seasonal offer."}
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs uppercase tracking-wide text-paper-3">Main offer</span>
          <select
            value={selectedMainOfferId}
            disabled={disabled || mainOffers.length === 0}
            onChange={(event) => onMainOfferChange(event.target.value)}
            className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">Choose approved main offer...</option>
            {mainOffers.map((offer) => (
              <option key={offer.id} value={offer.id}>{offer.offer_name}</option>
            ))}
          </select>
          <span className="text-2xs leading-4 text-paper-3">
            {selectedOffer ? selectedOffer.promised_outcome : "Approve Main Offers before creating contextual seasonal packaging."}
          </span>
        </label>
      </div>
    </Panel>
  );
}

function ReviewHistory({ decisions }: { decisions: OfferApprovalDecision[] }) {
  if (decisions.length === 0) return null;
  return (
    <Panel title="Review history" meta={`${decisions.length} decision(s)`}>
      <div className="divide-y divide-line">
        {decisions.map((decision) => (
          <div key={decision.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <StatusDot status={statusTone(decision.resulting_status)} />
                <span className="text-xs capitalize text-paper">{readable(decision.decision)}</span>
              </div>
              {decision.note && <p className="mt-1 text-xs leading-5 text-paper-3">{decision.note}</p>}
            </div>
            <span className="font-mono text-2xs text-paper-3">{formatDate(decision.decided_at)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function OffersPanel({ clientId, offerType }: { clientId: string; offerType: OfferType }) {
  const [workspace, setWorkspace] = useState<OffersWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<RunOffersStepResponse["progress"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedCampaignPeriodId, setSelectedCampaignPeriodId] = useState("");
  const [selectedMainOfferId, setSelectedMainOfferId] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspace(await fetchOffersWorkspace(clientId, offerType));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [clientId, offerType]);

  useEffect(() => { void reload(); }, [reload]);

  const latest = workspace?.latestRelease ?? null;
  const active = workspace?.activeRelease ?? null;
  const run = workspace?.latestRun ?? null;
  const waitingForReview = latest?.status === "needs_review";
  const main = mainWorkspace(workspace);
  const seasonal = seasonalWorkspace(workspace);
  const offerRows = useMemo(() => offerType === "main" ? main?.offers ?? [] : seasonal?.offers ?? [], [main?.offers, offerType, seasonal?.offers]);
  const missingSeasonalSelection = offerType === "seasonal" && (!selectedCampaignPeriodId || !selectedMainOfferId);
  const buildLabel = working
    ? progress ? `Building ${progress.completed + progress.failed}/${progress.total}...` : "Preparing..."
    : active ? `Refresh ${offerType === "main" ? "Main Offers" : "Seasonal Offers"}`
      : run?.status === "failed" ? "Rebuild offers"
        : run ? "Resume offers" : `Generate ${offerType === "main" ? "Main Offers" : "Seasonal Offers"}`;
  const title = offerType === "main" ? "Main Offers" : "Seasonal Offers";
  const subtitle = offerType === "main"
    ? "Designs the foundational commercial engine: what is sold, how value is packaged, how the customer ascends, and what claim/proof boundaries must hold."
    : "Adapts one approved Main Offer around one approved Campaign Intelligence period. This is contextual packaging, not a replacement for Main Offers or Ideation.";

  useEffect(() => {
    if (!seasonal) return;
    if (!selectedCampaignPeriodId && seasonal.campaignPeriodOptions[0]) {
      setSelectedCampaignPeriodId(seasonal.campaignPeriodOptions[0].id);
    }
    if (!selectedMainOfferId && seasonal.mainOfferOptions[0]) {
      setSelectedMainOfferId(seasonal.mainOfferOptions[0].id);
    }
  }, [seasonal, selectedCampaignPeriodId, selectedMainOfferId]);

  async function build() {
    if (offerType === "seasonal" && missingSeasonalSelection) {
      setError("Choose one approved Campaign Intelligence period and one approved Main Offer before generating Seasonal Offers.");
      return;
    }
    setWorking(true);
    setError(null);
    setMessage(null);
    setProgress(null);
    try {
      const result = await driveOffersBuild(
        clientId,
        offerType,
        setProgress,
        offerType === "seasonal" ? { campaign_period_id: selectedCampaignPeriodId, main_offer_id: selectedMainOfferId } : undefined,
      );
      setMessage(result.message);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await reload();
    } finally {
      setWorking(false);
    }
  }

  async function review(decision: "approved" | "changes_requested" | "rejected") {
    const release = workspace?.latestRelease;
    if (!release) return;
    let note: string | undefined;
    if (decision === "approved") {
      const label = offerType === "main" ? "Main Offers" : "Seasonal Offers";
      if (!window.confirm(`Approve and activate ${release.title}?\n\nApproved ${label} become downstream commercial authority.`)) return;
    } else {
      const promptLabel = decision === "changes_requested" ? "What must change before approval?" : "Why archive this release?";
      const entered = window.prompt(promptLabel);
      if (entered === null) return;
      note = entered;
    }
    setWorking(true);
    setError(null);
    try {
      await reviewOffersRelease(release.id, offerType, decision, note);
      setMessage(decision === "approved" ? "Offers release approved and activated." : decision === "changes_requested" ? "Changes requested. The release is back in draft." : "Offers release archived.");
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
    }
  }

  if (loading && !workspace) {
    return <div className="flex flex-1 items-center justify-center text-xs text-paper-3">Loading {title}...</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[10px] border border-line bg-ink-200 p-4">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2">
              <StatusDot status={active ? statusTone("approved") : statusTone(latest?.status ?? run?.status)} />
              <span className="font-mono text-[9.5px] uppercase tracking-cap text-paper-3">
                {active ? "Approved offer authority" : latest ? readable(latest.status) : "Not started"}
              </span>
            </div>
            <h2 className="text-base font-medium text-paper">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-paper-3">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {waitingForReview ? (
              <>
                <Button disabled={working} onClick={() => void review("changes_requested")}>Request changes</Button>
                <Button variant="danger" disabled={working} onClick={() => void review("rejected")}>Archive</Button>
                <Button variant="primary" disabled={working} onClick={() => void review("approved")}>Approve &amp; activate</Button>
              </>
            ) : (
              <Button variant="primary" disabled={working || missingSeasonalSelection} onClick={() => void build()}>{buildLabel}</Button>
            )}
          </div>
        </div>

        {progress && working && (
          <div className="rounded-[10px] border border-teal/20 bg-teal/5 px-4 py-3 text-xs text-paper">
            Offers workflow: {progress.completed} completed, {progress.failed} failed, {progress.total} total steps.
          </div>
        )}
        {message && <div className="rounded-[10px] border border-teal/20 bg-teal/5 px-4 py-3 text-xs text-teal">{message}</div>}
        {error && <div className="rounded-[10px] border border-neg/30 bg-neg/5 px-4 py-3 text-xs leading-5 text-neg">{error}</div>}

        {seasonal && (
          <SeasonalBuildSelection
            campaignPeriods={seasonal.campaignPeriodOptions}
            mainOffers={seasonal.mainOfferOptions}
            selectedCampaignPeriodId={selectedCampaignPeriodId}
            selectedMainOfferId={selectedMainOfferId}
            onCampaignPeriodChange={setSelectedCampaignPeriodId}
            onMainOfferChange={setSelectedMainOfferId}
            disabled={working || waitingForReview}
          />
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <span className="text-2xs uppercase text-paper-3">Authority</span>
            <span className="text-sm text-paper">{active ? `Active v${active.version}` : "No active release"}</span>
            <span className="text-2xs text-paper-3">{active ? formatDate(active.approved_at) : "Human approval required"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Latest draft</span>
            <span className="text-sm capitalize text-paper">{latest ? `v${latest.version} - ${readable(latest.status)}` : "Not built"}</span>
            <span className="text-2xs text-paper-3">{latest ? formatDate(latest.generated_at ?? latest.created_at) : "-"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Offer rows</span>
            <span className="text-sm text-paper">{offerRows.length} {offerType === "main" ? "main offer(s)" : "seasonal package(s)"}</span>
            <span className="text-2xs text-paper-3">{scaffoldCount(offerRows)} review-gated scaffold row(s)</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">{offerType === "main" ? "Money Model" : "Available inputs"}</span>
            <span className="text-sm text-paper">{offerType === "main" ? `${main?.moneyModelComponents.length ?? 0} components` : `${seasonal?.campaignPeriodOptions.length ?? 0} periods / ${seasonal?.mainOfferOptions.length ?? 0} offers`}</span>
            <span className="text-2xs text-paper-3">{offerType === "main" ? "Commercial mechanics" : "Approved authority only"}</span>
          </Card>
        </div>

        {(workspace?.steps.length ?? 0) > 0 && (
          <Panel title="Research workflow" meta={run ? readable(run.status) : undefined}>
            <div className="divide-y divide-line">
              {workspace?.steps.map((step) => (
                <div key={step.id} className="flex items-center gap-3 px-3.5 py-3">
                  <StatusDot status={statusTone(step.status)} />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-paper">{step.title}</div>
                    {step.failure_message && <div className="mt-1 truncate text-2xs text-neg">{step.failure_message}</div>}
                  </div>
                  <span className="font-mono text-2xs capitalize text-paper-3">{readable(step.status)}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {offerType === "main" ? (
          <>
            {(main?.offers.length ?? 0) > 0 ? (
              <Panel title="Main Offers" meta={`${main?.offers.length ?? 0} offers`}>
                <div className="grid gap-px bg-line">
                  {main?.offers.map((offer) => <MainOfferCard key={offer.id} offer={offer} />)}
                </div>
              </Panel>
            ) : (
              <div className="rounded-[10px] border border-dashed border-line bg-ink-200 p-8 text-center">
                <h3 className="text-sm font-medium text-paper">No Main Offers release yet</h3>
                <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-paper-3">
                  Save offer details in Context first. Stage 4B then creates a reviewable commercial architecture without inventing pricing, guarantees, proof, or revenue mechanics.
                </p>
              </div>
            )}
            <MoneyModelList components={main?.moneyModelComponents ?? []} />
          </>
        ) : (
          (seasonal?.offers.length ?? 0) > 0 ? (
            <Panel title="Seasonal Offers" meta={`${seasonal?.offers.length ?? 0} packages`}>
              <div className="grid gap-px bg-line">
                {seasonal?.offers.map((offer) => <SeasonalOfferCard key={offer.id} offer={offer} />)}
              </div>
            </Panel>
          ) : (
            <div className="rounded-[10px] border border-dashed border-line bg-ink-200 p-8 text-center">
              <h3 className="text-sm font-medium text-paper">No Seasonal Offers release yet</h3>
              <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-paper-3">
                Approve Campaign Intelligence and Main Offers first. Seasonal Offers then packages one selected main offer around one selected campaign moment.
              </p>
            </div>
          )
        )}
        <ReviewHistory decisions={workspace?.approvalDecisions ?? []} />
      </div>
    </div>
  );
}
