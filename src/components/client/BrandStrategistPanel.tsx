import { useCallback, useEffect, useState } from "react";
import { Button, Card, Panel, StatusDot, Tag } from "@/components/primitives";
import {
  driveBrandStrategistBuild,
  fetchIntelligenceWorkspace,
  reviewIntelligenceRelease,
} from "@/lib/intelligence";
import type {
  IntelligenceFinding,
  IntelligenceRecord,
  IntelligenceWorkspace,
  RunBrandStrategistStepResponse,
} from "@/types/intelligence";

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function recordPayloadValue(record: IntelligenceRecord, key: string): string | null {
  const value = record.payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function recordPayloadList(record: IntelligenceRecord, key: string): string[] {
  const value = record.payload[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function changeTag(status: string | null): "approve" | "decision" | "muted" {
  if (status === "changed") return "decision";
  if (status === "new") return "approve";
  return "muted";
}

function priorityTag(priority: string | null): "approve" | "decision" | "task" | "muted" {
  if (priority === "now") return "approve";
  if (priority === "next") return "decision";
  if (priority === "later") return "task";
  return "muted";
}

function freshnessTone(freshness: IntelligenceWorkspace["freshness"]): "live" | "idle" | "warn" | "error" | "paused" {
  if (freshness === "fresh") return "live";
  if (freshness === "due") return "warn";
  if (freshness === "stale") return "error";
  return "idle";
}

function findingTag(finding: IntelligenceFinding): "approve" | "decision" | "muted" {
  if (finding.disposition !== "asserted") return "muted";
  return finding.confidence_level === "verified" || finding.confidence_level === "strongly_inferred"
    ? "approve"
    : "decision";
}

export function BrandStrategistPanel({ clientId }: { clientId: string }) {
  const [workspace, setWorkspace] = useState<IntelligenceWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<RunBrandStrategistStepResponse["progress"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspace(await fetchIntelligenceWorkspace(clientId, "brand_strategist"));
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
      const result = await driveBrandStrategistBuild(clientId, setProgress);
      setMessage(result.message);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      await reload();
    } finally {
      setWorking(false);
    }
  }

  async function review(decision: "approved" | "changes_requested") {
    const release = workspace?.latestRelease;
    if (!release) return;
    let note: string | undefined;
    if (decision === "approved") {
      if (!window.confirm(`Approve and activate ${release.title}?\n\nThe approved release becomes immutable and downstream authority.`)) return;
    } else {
      const entered = window.prompt("What must change before this Brand Strategist can be approved?");
      if (entered === null) return;
      note = entered;
    }
    setWorking(true);
    setError(null);
    try {
      await reviewIntelligenceRelease(release.id, decision, note);
      setMessage(decision === "approved" ? "Brand Strategist approved and activated." : "Changes requested. The release is back in draft.");
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
    }
  }

  if (loading && !workspace) {
    return <div className="flex flex-1 items-center justify-center text-xs text-paper-3">Loading Brand Strategist…</div>;
  }

  const latest = workspace?.latestRelease ?? null;
  const active = workspace?.activeRelease ?? null;
  const run = workspace?.latestRun ?? null;
  const waitingForReview = latest?.status === "needs_review";
  const records = workspace?.records ?? [];
  const recordGroups = [...records.reduce<Map<string, IntelligenceRecord[]>>((groups, record) => {
    const group = groups.get(record.record_type) ?? [];
    group.push(record);
    groups.set(record.record_type, group);
    return groups;
  }, new Map()).entries()];
  const recommendationCount = records.filter((record) => recordPayloadValue(record, "record_kind") === "recommendation").length;
  const implicationCount = records.length - recommendationCount;
  const changedCount = records.filter((record) => recordPayloadValue(record, "change_status") === "changed").length;
  const readinessCandidate = latest?.authority_snapshot?.readiness;
  const readiness = readinessCandidate && typeof readinessCandidate === "object"
    ? readinessCandidate as { status?: string; warnings?: unknown }
    : null;
  const readinessWarnings = Array.isArray(readiness?.warnings)
    ? readiness.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const buildLabel = working
    ? progress ? `Building ${progress.completed + progress.failed}/${progress.total}…` : "Preparing…"
    : latest?.status === "approved" || active ? "Refresh recommendations" : run?.retryable ? "Resume synthesis" : run?.status === "failed" ? "Rebuild recommendations" : run ? "Resume synthesis" : "Generate strategic recommendations";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[10px] border border-line bg-ink-200 p-4">
          <div className="max-w-2xl">
            <div className="mb-2 flex items-center gap-2">
              <StatusDot status={active ? freshnessTone(workspace?.freshness ?? "not_available") : run?.status === "failed" ? "error" : "idle"} />
              <span className="font-mono text-[9.5px] uppercase tracking-cap text-paper-3">
                {active ? `${readable(workspace?.freshness ?? "not_available")} authority` : latest ? readable(latest.status) : "Not started"}
              </span>
            </div>
            <h2 className="text-base font-medium text-paper">Brand Strategist</h2>
            <p className="mt-1 text-xs leading-5 text-paper-3">
              Evidence-backed strategic recommendations synthesized from approved Market, Avatar, Competitor, and Association authority. Every card exposes its reasoning, trade-offs, dependencies, risks, evidence chain, and proposed owner.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {waitingForReview ? (
              <>
                <Button disabled={working} onClick={() => void review("changes_requested")}>Request changes</Button>
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
            Strategic synthesis: {progress.completed} completed, {progress.failed} failed, {progress.total} total modules.
          </div>
        )}
        {message && <div className="rounded-[10px] border border-teal/20 bg-teal/5 px-4 py-3 text-xs text-teal">{message}</div>}
        {error && <div className="rounded-[10px] border border-neg/30 bg-neg/5 px-4 py-3 text-xs leading-5 text-neg">{error}</div>}
        {readinessWarnings.length > 0 && (
          <div className="rounded-[10px] border border-warn/30 bg-warn/5 px-4 py-3 text-xs leading-5 text-warn">
            Degraded authority readiness: {readinessWarnings.join(" ")}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Card>
            <span className="text-2xs uppercase text-paper-3">Authority</span>
            <span className="text-sm text-paper">{active ? `Active v${active.version}` : "No active release"}</span>
            <span className="text-2xs text-paper-3">{active ? formatDate(active.approved_at) : "Human approval required"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Latest draft</span>
            <span className="text-sm capitalize text-paper">{latest ? `v${latest.version} · ${readable(latest.status)}` : "Not built"}</span>
            <span className="text-2xs text-paper-3">{latest ? formatDate(latest.generated_at ?? latest.created_at) : "—"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Portfolio</span>
            <span className="text-sm text-paper">{recommendationCount} recommendations</span>
            <span className="text-2xs text-paper-3">{implicationCount} implications/risks · {changedCount} changed</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Traceability</span>
            <span className="text-sm text-paper">{workspace?.findings.length ?? 0} findings</span>
            <span className="text-2xs text-paper-3">Approved upstream records only</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Readiness</span>
            <span className="text-sm capitalize text-paper">{readiness?.status ?? "not available"}</span>
            <span className="text-2xs text-paper-3">{readinessWarnings.length > 0 ? `${readinessWarnings.length} disclosed warning(s)` : "All upstream authority ready"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Synthesis usage</span>
            <span className="text-sm text-paper">{((workspace?.usage.inputUnits ?? 0) + (workspace?.usage.outputUnits ?? 0)).toLocaleString()} tokens</span>
            <span className="text-2xs text-paper-3">
              {workspace?.usage.amountMicrounits !== null && workspace?.usage.currency
                ? `${workspace.usage.currency} ${(workspace.usage.amountMicrounits / 1_000_000).toFixed(2)}`
                : "Cost pending price snapshot"}
            </span>
          </Card>
        </div>

        {(workspace?.steps.length ?? 0) > 0 && (
          <Panel title="Research workflow" meta={run ? readable(run.status) : undefined}>
            <div className="divide-y divide-line">
              {workspace?.steps.map((step) => (
                <div key={step.id} className="flex items-center gap-3 px-3.5 py-3">
                  <StatusDot status={step.status === "completed" ? "live" : step.status === "failed" ? "error" : step.status === "running" ? "warn" : "idle"} />
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

        {recordGroups.length > 0 ? (
          recordGroups.map(([recordType, group]) => (
          <Panel key={recordType} title={readable(recordType)} meta={`${group.length} records`}>
            <div className="grid gap-px bg-line md:grid-cols-2">
              {group.map((record) => {
                const kind = recordPayloadValue(record, "record_kind");
                const recommendationType = recordPayloadValue(record, "recommendation_type");
                const priority = recordPayloadValue(record, "priority");
                const status = recordPayloadValue(record, "change_status");
                const rationale = recordPayloadValue(record, "rationale");
                const expectedImpact = recordPayloadValue(record, "expected_impact");
                const owner = recordPayloadValue(record, "downstream_owner");
                const nextAction = recordPayloadValue(record, "proposed_next_action");
                const validation = recordPayloadValue(record, "validation_needed");
                const dependencies = recordPayloadList(record, "dependencies");
                const risks = recordPayloadList(record, "risks");
                const tradeOffs = recordPayloadList(record, "trade_offs");
                const contradictions = recordPayloadList(record, "contradictions");
                const supportedDomains = recordPayloadList(record, "supporting_os_domains");
                return (
                <div key={record.id} className="bg-ink-200 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-paper">{record.title}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {priority && <Tag kind={priorityTag(priority)}>{readable(priority)}</Tag>}
                      {kind && <Tag kind={kind === "risk" || kind === "tension" ? "anomaly" : "muted"}>{readable(kind)}</Tag>}
                      {recommendationType && recommendationType !== "synthesis" && <Tag kind="task">{readable(recommendationType)}</Tag>}
                      {status && <Tag kind={changeTag(status)}>{readable(status)}</Tag>}
                    </div>
                  </div>
                  <p className="text-xs leading-5 text-paper-3">{record.summary}</p>
                  <dl className="mt-3 space-y-2 border-t border-line pt-3">
                    {rationale && <div><dt className="text-2xs text-paper-3">Why</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{rationale}</dd></div>}
                    {expectedImpact && <div><dt className="text-2xs text-paper-3">Expected impact</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{expectedImpact}</dd></div>}
                    {dependencies.length > 0 && <div><dt className="text-2xs text-paper-3">Dependencies</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{dependencies.join(" · ")}</dd></div>}
                    {risks.length > 0 && <div><dt className="text-2xs text-paper-3">Risks</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{risks.join(" · ")}</dd></div>}
                    {tradeOffs.length > 0 && <div><dt className="text-2xs text-paper-3">Trade-offs</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{tradeOffs.join(" · ")}</dd></div>}
                    {contradictions.length > 0 && <div><dt className="text-2xs text-warn">Contradictions</dt><dd className="mt-1 text-xs leading-5 text-warn">{contradictions.join(" · ")}</dd></div>}
                    {nextAction && <div><dt className="text-2xs text-paper-3">Proposed next action</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{nextAction}</dd></div>}
                    {validation && <div><dt className="text-2xs text-paper-3">Validation needed</dt><dd className="mt-1 text-xs leading-5 text-paper-2">{validation}</dd></div>}
                  </dl>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                    {owner && <Tag kind="decision">Owner: {readable(owner)}</Tag>}
                    {supportedDomains.map((domain) => <Tag key={domain} kind="muted">{readable(domain)}</Tag>)}
                  </div>
                </div>
                );
              })}
            </div>
          </Panel>
          ))
        ) : (
          <div className="rounded-[10px] border border-dashed border-line bg-ink-200 p-8 text-center">
            <h3 className="text-sm font-medium text-paper">No Brand Strategist release yet</h3>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-paper-3">
              Approve Market OS, Avatar OS, Competitor OS, and Association OS first. Brand Strategist then turns that authority into traceable recommendation cards without changing any upstream or downstream record.
            </p>
          </div>
        )}

        {(workspace?.findings.length ?? 0) > 0 && (
          <Panel title="Atomic findings" meta={`${workspace?.findings.length ?? 0}`}>
            <div className="divide-y divide-line">
              {workspace?.findings.map((finding) => (
                <div key={finding.id} className="px-3.5 py-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Tag kind={findingTag(finding)}>{finding.disposition}</Tag>
                    {finding.confidence_level && <span className="font-mono text-2xs text-paper-3">{readable(finding.confidence_level)}</span>}
                  </div>
                  <p className="text-xs leading-5 text-paper-2">{finding.claim}</p>
                  {finding.rationale && <p className="mt-1 text-2xs leading-4 text-paper-3">{finding.rationale}</p>}
                </div>
              ))}
            </div>
          </Panel>
        )}

      </div>
    </div>
  );
}
