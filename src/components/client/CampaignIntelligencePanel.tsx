import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, Panel, StatusDot, Tag } from "@/components/primitives";
import { Modal } from "@/components/primitives";
import {
  driveCampaignIntelligenceBuild,
  fetchCampaignIntelligenceWorkspace,
  reviewCampaignIntelligenceRelease,
} from "@/lib/campaign-intelligence";
import type {
  CampaignIntelligenceWorkspace,
  CampaignPeriod,
  CampaignPeriodSourceLink,
  CampaignSourceDomain,
  RunCampaignIntelligenceStepResponse,
} from "@/types/campaign-intelligence";

const REQUIRED_DOMAINS: CampaignSourceDomain[] = [
  "market_os",
  "avatar_os",
  "competitor_os",
  "association_os",
  "brand_strategist",
];

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatDateOnly(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
}

function dateWindow(period: CampaignPeriod): string {
  if (period.timing_start || period.timing_end) {
    return `${formatDateOnly(period.timing_start)} - ${formatDateOnly(period.timing_end)}`;
  }
  return period.timing_label;
}

function statusTone(status: string | null | undefined): "live" | "idle" | "warn" | "error" | "paused" {
  if (status === "approved" || status === "completed") return "live";
  if (status === "needs_review" || status === "running" || status === "queued" || status === "waiting_provider") return "warn";
  if (status === "failed" || status === "cancelled") return "error";
  if (status === "archived" || status === "superseded") return "paused";
  return "idle";
}

function listText(values: string[]): string {
  return values.length > 0 ? values.map(readable).join(" · ") : "Review required";
}

function payloadFlag(period: CampaignPeriod, key: string): boolean {
  return period.payload[key] === true;
}

function periodLinks(period: CampaignPeriod | null, links: CampaignPeriodSourceLink[]): CampaignPeriodSourceLink[] {
  if (!period) return [];
  return links.filter((link) => link.campaign_period_id === period.id);
}

function sourceCount(period: CampaignPeriod, links: CampaignPeriodSourceLink[]): number {
  return periodLinks(period, links).length;
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-ink px-3 py-2">
      <dt className="text-2xs uppercase text-paper-3">{label}</dt>
      <dd className="mt-1 text-xs leading-5 text-paper-2">{value || "Review required"}</dd>
    </div>
  );
}

function TimelineButton({
  period,
  selected,
  sourceLinks,
  onSelect,
}: {
  period: CampaignPeriod;
  selected: boolean;
  sourceLinks: CampaignPeriodSourceLink[];
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-[8px] border px-3 py-3 text-left transition-colors ${
        selected ? "border-teal/60 bg-teal/5" : "border-line bg-ink hover:border-teal/30"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-1 h-3 w-3 shrink-0 rounded-full border ${selected ? "border-teal bg-teal" : "border-line bg-ink-200"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xs text-paper-3">P{period.display_order}</span>
            <span className="truncate text-xs font-medium text-paper">{period.title}</span>
          </div>
          <div className="mt-1 truncate font-mono text-2xs text-paper-3">{dateWindow(period)}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Tag kind="decision">{readable(period.customer_journey_stage)}</Tag>
            <Tag kind="muted">{sourceCount(period, sourceLinks)} sources</Tag>
          </div>
        </div>
      </div>
    </button>
  );
}

function EvidenceDrawer({
  period,
  links,
  authoritySnapshot,
  onClose,
}: {
  period: CampaignPeriod;
  links: CampaignPeriodSourceLink[];
  authoritySnapshot: Record<string, unknown>;
  onClose: () => void;
}) {
  const domainCounts = REQUIRED_DOMAINS.map((domain) => ({
    domain,
    count: links.filter((link) => link.source_domain === domain).length,
  }));
  return (
    <Modal
      title="Evidence and Authority"
      description={period.title}
      onClose={onClose}
      widthClass="max-w-4xl"
    >
      <div className="space-y-4">
        <section className="rounded border border-line bg-ink p-4">
          <h3 className="text-2xs font-medium uppercase tracking-wide text-paper-3">Evidence Summary</h3>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-paper">
            {period.evidence_summary || "No evidence summary was recorded."}
          </p>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-2xs font-medium uppercase tracking-wide text-paper-3">Source Coverage</h3>
            <span className="font-mono text-2xs text-paper-3">{links.length} links</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-5">
            {domainCounts.map(({ domain, count }) => (
              <div key={domain} className="rounded border border-line bg-ink px-3 py-2">
                <div className="font-mono text-[9.5px] uppercase tracking-cap text-paper-3">{readable(domain)}</div>
                <div className="mt-1 text-sm text-paper">{count}</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-2 text-2xs font-medium uppercase tracking-wide text-paper-3">Source Links</h3>
          {links.length ? (
            <div className="space-y-2">
              {links.map((link) => (
                <div key={link.id} className="rounded border border-line bg-ink p-3 text-2xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag kind="task">{readable(link.source_domain)}</Tag>
                    <Tag kind="muted">{readable(link.relationship)}</Tag>
                    <span className="ml-auto font-mono text-paper-3">{formatDateTime(link.created_at)}</span>
                  </div>
                  {link.note && <p className="mt-2 text-xs leading-5 text-paper-2">{link.note}</p>}
                  <div className="mt-2 grid gap-1 font-mono text-[10px] text-paper-3 sm:grid-cols-3">
                    <div className="break-all">release {link.source_release_id ?? "-"}</div>
                    <div className="break-all">record {link.source_record_id ?? "-"}</div>
                    <div className="break-all">finding {link.source_finding_id ?? "-"}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded border border-dashed border-line px-3 py-4 text-xs text-paper-3">
              No source links are attached to this period.
            </p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-2xs font-medium uppercase tracking-wide text-paper-3">Release Authority Snapshot</h3>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded border border-line bg-ink p-3 text-[10px] leading-5 text-paper-3">
            {JSON.stringify(authoritySnapshot, null, 2)}
          </pre>
        </section>
      </div>
    </Modal>
  );
}

function ReviewHistory({ workspace }: { workspace: CampaignIntelligenceWorkspace }) {
  if (workspace.approvalDecisions.length === 0) {
    return <p className="px-3.5 py-3 text-xs text-paper-3">No review decisions recorded for this release.</p>;
  }
  return (
    <div className="divide-y divide-line">
      {workspace.approvalDecisions.map((decision) => (
        <div key={decision.id} className="px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Tag kind={decision.decision === "approved" ? "approve" : decision.decision === "rejected" ? "anomaly" : "decision"}>
              {readable(decision.decision)}
            </Tag>
            <span className="font-mono text-2xs text-paper-3">
              {readable(decision.previous_status)} {"->"} {readable(decision.resulting_status)}
            </span>
            <span className="ml-auto font-mono text-2xs text-paper-3">{formatDateTime(decision.decided_at)}</span>
          </div>
          {decision.note && <p className="mt-2 text-xs leading-5 text-paper-2">{decision.note}</p>}
        </div>
      ))}
    </div>
  );
}

export function CampaignIntelligencePanel({ clientId }: { clientId: string }) {
  const [workspace, setWorkspace] = useState<CampaignIntelligenceWorkspace | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<RunCampaignIntelligenceStepResponse["progress"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchCampaignIntelligenceWorkspace(clientId);
      setWorkspace(next);
      setSelectedPeriodId((current) =>
        current && next.periods.some((period) => period.id === current)
          ? current
          : next.periods[0]?.id ?? null
      );
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { void reload(); }, [reload]);

  async function build() {
    setWorking(true);
    setError(null);
    setMessage(null);
    setProgress(null);
    try {
      const result = await driveCampaignIntelligenceBuild(clientId, setProgress);
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
      if (!window.confirm(`Approve and activate ${release.title}?\n\nOnly approved Campaign Intelligence becomes downstream authority.`)) return;
    } else {
      const prompt = decision === "rejected"
        ? "Why is this Campaign Intelligence release being archived?"
        : "What must change before this Campaign Intelligence calendar can be approved?";
      const entered = window.prompt(prompt);
      if (entered === null) return;
      note = entered;
    }
    setWorking(true);
    setError(null);
    try {
      await reviewCampaignIntelligenceRelease(release.id, decision, note);
      setMessage(decision === "approved"
        ? "Campaign Intelligence approved and activated."
        : decision === "rejected"
          ? "Campaign Intelligence archived."
          : "Changes requested. The release is back in draft.");
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
    }
  }

  const latest = workspace?.latestRelease ?? null;
  const active = workspace?.activeRelease ?? null;
  const run = workspace?.latestRun ?? null;
  const periods = workspace?.periods ?? [];
  const sourceLinks = workspace?.sourceLinks ?? [];
  const selectedPeriod = periods.find((period) => period.id === selectedPeriodId) ?? periods[0] ?? null;
  const selectedLinks = useMemo(() => periodLinks(selectedPeriod, sourceLinks), [selectedPeriod, sourceLinks]);
  const sourceDomains = useMemo(() => [...new Set(sourceLinks.map((link) => link.source_domain))], [sourceLinks]);
  const scaffoldCount = periods.filter((period) => payloadFlag(period, "stage_4a_scaffold")).length;
  const waitingForReview = latest?.status === "needs_review";
  const activeIsLatest = Boolean(active && latest && active.id === latest.id);
  const buildLabel = working
    ? progress ? `Building ${progress.completed + progress.failed}/${progress.total}...` : "Preparing..."
    : latest?.status === "approved" || active ? "Refresh calendar" : run?.status === "failed" ? "Rebuild calendar" : run ? "Resume calendar" : "Generate campaign calendar";

  if (loading && !workspace) {
    return <div className="flex flex-1 items-center justify-center text-xs text-paper-3">Loading Campaign Intelligence...</div>;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[10px] border border-line bg-ink-200 p-4">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2">
              <StatusDot status={active ? statusTone("approved") : statusTone(latest?.status ?? run?.status)} />
              <span className="font-mono text-[9.5px] uppercase tracking-cap text-paper-3">
                {active ? "Approved campaign authority" : latest ? readable(latest.status) : "Not started"}
              </span>
            </div>
            <h2 className="text-base font-medium text-paper">Campaign Intelligence</h2>
            <p className="mt-1 text-xs leading-5 text-paper-3">
              Maps what matters when, and why, from approved Intelligence. Offers and content ideas remain downstream modules.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {waitingForReview ? (
              <>
                <Button disabled={working} onClick={() => void review("changes_requested")}>Request changes</Button>
                <Button disabled={working} onClick={() => void review("rejected")}>Archive</Button>
                <Button variant="primary" disabled={working} onClick={() => void review("approved")}>Approve &amp; activate</Button>
              </>
            ) : (
              <Button variant="primary" disabled={working} onClick={() => void build()}>
                {buildLabel}
              </Button>
            )}
          </div>
        </div>

        {progress && working && (
          <div className="rounded-[10px] border border-teal/20 bg-teal/5 px-4 py-3 text-xs text-paper">
            Campaign calendar: {progress.completed} completed, {progress.failed} failed, {progress.total} total steps.
          </div>
        )}
        {message && <div className="rounded-[10px] border border-teal/20 bg-teal/5 px-4 py-3 text-xs text-teal">{message}</div>}
        {error && <div className="rounded-[10px] border border-neg/30 bg-neg/5 px-4 py-3 text-xs leading-5 text-neg">{error}</div>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
            <span className="text-2xs uppercase text-paper-3">Active authority</span>
            <span className="text-sm text-paper">{active ? `v${active.version}` : "None"}</span>
            <span className="text-2xs text-paper-3">{active ? formatDateTime(active.approved_at) : "Approval required"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Latest release</span>
            <span className="text-sm capitalize text-paper">{latest ? `v${latest.version} · ${readable(latest.status)}` : "Not built"}</span>
            <span className="text-2xs text-paper-3">{latest && active ? (activeIsLatest ? "Active" : "Not active") : "-"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Periods</span>
            <span className="text-sm text-paper">{periods.length} windows</span>
            <span className="text-2xs text-paper-3">{scaffoldCount} review-gated scaffold row(s)</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Traceability</span>
            <span className="text-sm text-paper">{sourceLinks.length} links</span>
            <span className="text-2xs text-paper-3">{sourceDomains.length > 0 ? sourceDomains.map(readable).join(", ") : "Approved upstream only"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Usage</span>
            <span className="text-sm text-paper">{((workspace?.usage.inputUnits ?? 0) + (workspace?.usage.outputUnits ?? 0)).toLocaleString()} tokens</span>
            <span className="text-2xs text-paper-3">Deterministic scaffold</span>
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

        {periods.length > 0 && selectedPeriod ? (
          <div className="grid min-h-[620px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
            <Panel title="Timeline" meta={`${periods.length} periods`}>
              <div className="space-y-2 p-3">
                {periods.map((period) => (
                  <TimelineButton
                    key={period.id}
                    period={period}
                    selected={period.id === selectedPeriod.id}
                    sourceLinks={sourceLinks}
                    onSelect={() => {
                      setSelectedPeriodId(period.id);
                      setEvidenceOpen(false);
                    }}
                  />
                ))}
              </div>
            </Panel>

            <div className="min-w-0 space-y-4">
              <Panel
                title="Period detail"
                meta={`${dateWindow(selectedPeriod)} · ${sourceCount(selectedPeriod, sourceLinks)} source links`}
              >
                <div className="p-4">
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-medium text-paper">{selectedPeriod.title}</h3>
                      <p className="mt-1 text-xs leading-5 text-paper-2">{selectedPeriod.strategic_theme}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Tag kind="decision">{readable(selectedPeriod.customer_journey_stage)}</Tag>
                      <Tag kind={payloadFlag(selectedPeriod, "human_review_required") ? "anomaly" : "approve"}>
                        {payloadFlag(selectedPeriod, "human_review_required") ? "Review required" : "Reviewed"}
                      </Tag>
                      <Tag kind="muted">P{selectedPeriod.display_order}</Tag>
                    </div>
                  </div>

                  <div className="mb-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEvidenceOpen(true)}>
                      Evidence drawer
                    </Button>
                  </div>

                  <dl className="grid gap-3 md:grid-cols-2">
                    <DetailField label="ICP context" value={selectedPeriod.icp_context} />
                    <DetailField label="Emotional state" value={listText(selectedPeriod.emotional_states)} />
                    <DetailField label="Pain-point salience" value={listText(selectedPeriod.pain_point_salience)} />
                    <DetailField label="Desired outcome" value={selectedPeriod.desired_outcome} />
                    <DetailField label="Awareness shift" value={selectedPeriod.awareness_shift} />
                    <DetailField label="Strategic messaging" value={selectedPeriod.strategic_messaging_direction} />
                    <DetailField label="Positioning direction" value={selectedPeriod.positioning_direction} />
                    <DetailField label="Campaign objective" value={selectedPeriod.campaign_objective} />
                  </dl>

                  <div className="mt-3 rounded border border-line bg-ink px-3 py-2">
                    <div className="text-2xs uppercase text-paper-3">What changed from previous period</div>
                    <p className="mt-1 text-xs leading-5 text-paper-2">
                      {selectedPeriod.previous_period_relationship || "No previous-period relationship recorded."}
                    </p>
                  </div>
                </div>
              </Panel>

              <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="Evidence coverage" meta={`${selectedLinks.length} links`}>
                  <div className="divide-y divide-line">
                    {REQUIRED_DOMAINS.map((domain) => {
                      const count = selectedLinks.filter((link) => link.source_domain === domain).length;
                      return (
                        <div key={domain} className="flex items-center gap-3 px-3.5 py-3">
                          <StatusDot status={count > 0 ? "live" : "idle"} />
                          <span className="min-w-0 flex-1 text-xs text-paper">{readable(domain)}</span>
                          <span className="font-mono text-2xs text-paper-3">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </Panel>

                <Panel title="Review history" meta={`${workspace?.approvalDecisions.length ?? 0} decisions`}>
                  {workspace && <ReviewHistory workspace={workspace} />}
                </Panel>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[10px] border border-dashed border-line bg-ink-200 p-8 text-center">
            <h3 className="text-sm font-medium text-paper">No Campaign Intelligence release yet</h3>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-paper-3">
              Approve Market OS, Avatar OS, Competitor OS, Association OS, and Brand Strategist first. Stage 4A then creates a reviewable campaign calendar.
            </p>
          </div>
        )}
      </div>

      {evidenceOpen && selectedPeriod && (
        <EvidenceDrawer
          period={selectedPeriod}
          links={selectedLinks}
          authoritySnapshot={latest?.authority_snapshot ?? active?.authority_snapshot ?? {}}
          onClose={() => setEvidenceOpen(false)}
        />
      )}
    </div>
  );
}
