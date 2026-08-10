import { useCallback, useEffect, useState } from "react";
import { Button, Card, Panel, StatusDot, Tag } from "@/components/primitives";
import {
  driveAssociationOSBuild,
  fetchIntelligenceWorkspace,
  reviewIntelligenceRelease,
} from "@/lib/intelligence";
import type {
  IntelligenceFinding,
  IntelligenceRecord,
  IntelligenceWorkspace,
  RunAssociationOSStepResponse,
} from "@/types/intelligence";

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function recordDetails(record: IntelligenceRecord): Array<{ label: string; value: string }> {
  const details = record.payload.details;
  if (!Array.isArray(details)) return [];
  return details.flatMap((detail) => {
    if (!detail || typeof detail !== "object") return [];
    const candidate = detail as { label?: unknown; value?: unknown };
    return typeof candidate.label === "string" && typeof candidate.value === "string"
      ? [{ label: candidate.label, value: candidate.value }]
      : [];
  });
}

function recordPayloadValue(record: IntelligenceRecord, key: string): string | null {
  const value = record.payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function changeTag(status: string | null): "approve" | "decision" | "muted" {
  if (status === "changed") return "decision";
  if (status === "new") return "approve";
  return "muted";
}

function polarityTag(polarity: string | null): "approve" | "anomaly" | "decision" | "muted" {
  if (polarity === "positive") return "approve";
  if (polarity === "negative") return "anomaly";
  if (polarity === "ambivalent") return "decision";
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

export function AssociationOSPanel({ clientId }: { clientId: string }) {
  const [workspace, setWorkspace] = useState<IntelligenceWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<RunAssociationOSStepResponse["progress"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspace(await fetchIntelligenceWorkspace(clientId, "association_os"));
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
      const result = await driveAssociationOSBuild(clientId, setProgress);
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
      const entered = window.prompt("What must change before this Association OS can be approved?");
      if (entered === null) return;
      note = entered;
    }
    setWorking(true);
    setError(null);
    try {
      await reviewIntelligenceRelease(release.id, decision, note);
      setMessage(decision === "approved" ? "Association OS approved and activated." : "Changes requested. The release is back in draft.");
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWorking(false);
    }
  }

  if (loading && !workspace) {
    return <div className="flex flex-1 items-center justify-center text-xs text-paper-3">Loading Association OS…</div>;
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
  const associationCount = new Set(records.map((record) => recordPayloadValue(record, "association_key")).filter(Boolean)).size;
  const positiveCount = records.filter((record) => recordPayloadValue(record, "polarity") === "positive").length;
  const negativeCount = records.filter((record) => recordPayloadValue(record, "polarity") === "negative").length;
  const changedCount = records.filter((record) => recordPayloadValue(record, "change_status") === "changed").length;
  const buildLabel = working
    ? progress ? `Building ${progress.completed + progress.failed}/${progress.total}…` : "Preparing…"
    : latest?.status === "approved" || active ? "Refresh Association OS" : run?.retryable ? "Resume Association OS" : run?.status === "failed" ? "Rebuild Association OS" : run ? "Resume Association OS" : "Build Association OS";

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
            <h2 className="text-base font-medium text-paper">Association OS</h2>
            <p className="mt-1 text-xs leading-5 text-paper-3">
              An evidence-backed map of the meanings and signals that make approved buyer roles trust, value, doubt, avoid, or reject a brand. Research preserves variation and cautions; only human approval makes the map authoritative.
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
            Association research: {progress.completed} completed, {progress.failed} failed, {progress.total} total modules.
          </div>
        )}
        {message && <div className="rounded-[10px] border border-teal/20 bg-teal/5 px-4 py-3 text-xs text-teal">{message}</div>}
        {error && <div className="rounded-[10px] border border-neg/30 bg-neg/5 px-4 py-3 text-xs leading-5 text-neg">{error}</div>}

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
            <span className="text-2xs uppercase text-paper-3">Association map</span>
            <span className="text-sm text-paper">{associationCount} associations</span>
            <span className="text-2xs text-paper-3">{positiveCount} positive · {negativeCount} negative · {changedCount} changed</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Evidence</span>
            <span className="text-sm text-paper">{workspace?.findings.length ?? 0} findings</span>
            <span className="text-2xs text-paper-3">{workspace?.sources.length ?? 0} inspectable sources</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Freshness</span>
            <span className="text-sm capitalize text-paper">{readable(workspace?.freshness ?? "not_available")}</span>
            <span className="text-2xs text-paper-3">{workspace?.nextRefreshAt ? `Next review ${formatDate(workspace.nextRefreshAt)}` : "Available after approval"}</span>
          </Card>
          <Card>
            <span className="text-2xs uppercase text-paper-3">Research usage</span>
            <span className="text-sm text-paper">{(workspace?.usage.toolCalls ?? 0).toLocaleString()} web searches</span>
            <span className="text-2xs text-paper-3">
              {workspace?.usage.amountMicrounits !== null && workspace?.usage.currency
                ? `${workspace.usage.currency} ${(workspace.usage.amountMicrounits / 1_000_000).toFixed(2)}`
                : `${((workspace?.usage.inputUnits ?? 0) + (workspace?.usage.outputUnits ?? 0)).toLocaleString()} tokens · cost pending price snapshot`}
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
                const polarity = recordPayloadValue(record, "polarity");
                const associationKind = recordPayloadValue(record, "association_kind");
                const scope = recordPayloadValue(record, "scope");
                const status = recordPayloadValue(record, "change_status");
                const observedAt = recordPayloadValue(record, "observed_at");
                return (
                <div key={record.id} className="bg-ink-200 p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-paper">{record.title}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {polarity && <Tag kind={polarityTag(polarity)}>{readable(polarity)}</Tag>}
                      {associationKind && <Tag kind="muted">{readable(associationKind)}</Tag>}
                      {status && <Tag kind={changeTag(status)}>{readable(status)}</Tag>}
                    </div>
                  </div>
                  <p className="text-xs leading-5 text-paper-3">{record.summary}</p>
                  {scope && <div className="mt-2 text-2xs text-paper-3">Scope: {scope}</div>}
                  {observedAt && <div className="mt-2 font-mono text-2xs text-paper-3">Observed {formatDate(observedAt)}</div>}
                  {recordDetails(record).length > 0 && (
                    <dl className="mt-3 space-y-2 border-t border-line pt-3">
                      {recordDetails(record).map((detail, index) => (
                        <div key={`${detail.label}-${index}`} className="grid gap-1 sm:grid-cols-[120px_1fr]">
                          <dt className="text-2xs text-paper-3">{detail.label}</dt>
                          <dd className="text-xs leading-5 text-paper-2">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
                );
              })}
            </div>
          </Panel>
          ))
        ) : (
          <div className="rounded-[10px] border border-dashed border-line bg-ink-200 p-8 text-center">
            <h3 className="text-sm font-medium text-paper">No Association OS release yet</h3>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-paper-3">
              Approve Market OS, Avatar OS, and Competitor OS first, then build Association OS to map positive and negative meanings, trust signals, credibility markers, cautions, and unknowns—without stereotypes or discriminatory profiling.
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

        {(workspace?.sources.length ?? 0) > 0 && (
          <Panel title="Inspectable sources" meta={`${workspace?.sources.length ?? 0}`}>
            <div className="divide-y divide-line">
              {workspace?.sources.map((source) => (
                <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="block px-3.5 py-3 hover:bg-ink-100">
                  <div className="text-xs text-paper">{source.title}</div>
                  <div className="mt-1 truncate font-mono text-2xs text-teal">{source.url}</div>
                </a>
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
