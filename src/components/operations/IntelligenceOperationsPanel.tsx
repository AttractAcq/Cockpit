import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Tag, type TagKind } from "@/components/primitives";
import { ROUTES } from "@/lib/constants";
import {
  createIntelligenceChangeProposal,
  fetchIntelligenceChangeProposals,
  fetchIntelligenceConsumptions,
  fetchIntelligenceOperationalStatus,
  fetchIntelligenceRefreshRequests,
  requestIntelligenceRefresh,
  reviewIntelligenceChangeProposal,
} from "@/lib/intelligence-operations";
import type { IntelligenceDomain } from "@/types/intelligence";
import type {
  IntelligenceChangeProposal,
  IntelligenceConsumption,
  IntelligenceOperationalStatus,
  IntelligenceRefreshRequest,
} from "@/types/intelligence-operations";
import type { Client } from "@/types/client";

const DOMAINS: IntelligenceDomain[] = ["market_os", "avatar_os", "competitor_os", "association_os", "brand_strategist"];
const DOMAIN_SECTION: Record<IntelligenceDomain, string> = {
  market_os: "market_os",
  avatar_os: "avatar",
  competitor_os: "competitor_os",
  association_os: "association_os",
  brand_strategist: "brand_strategist",
};
const field = "rounded border border-line bg-ink px-2 py-1 text-xs text-paper outline-none focus:border-teal/50";

function readable(value: string): string { return value.replaceAll("_", " "); }
function errorText(value: unknown): string {
  return value && typeof value === "object" && "message" in value ? String(value.message) : String(value);
}
function statusTag(row: IntelligenceOperationalStatus): TagKind {
  if (row.dependency_status === "drifted" || row.freshness === "stale" || row.latest_run_status === "failed") return "anomaly";
  if (row.latest_release_status === "needs_review" || row.freshness === "due" || row.refresh_pending) return "decision";
  if (row.active_release_id) return "approve";
  return "muted";
}

export function IntelligenceOperationsPanel({ clients }: { clients: Client[] }) {
  const [statuses, setStatuses] = useState<IntelligenceOperationalStatus[]>([]);
  const [refreshes, setRefreshes] = useState<IntelligenceRefreshRequest[]>([]);
  const [proposals, setProposals] = useState<IntelligenceChangeProposal[]>([]);
  const [consumptions, setConsumptions] = useState<IntelligenceConsumption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState("all");
  const [form, setForm] = useState({
    clientId: "",
    target: "market_os" as "context" | IntelligenceDomain,
    proposalType: "investigate" as IntelligenceChangeProposal["proposal_type"],
    title: "",
    summary: "",
    rationale: "",
    priority: "normal" as IntelligenceChangeProposal["priority"],
  });

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextStatuses, nextRefreshes, nextProposals, nextConsumptions] = await Promise.all([
        fetchIntelligenceOperationalStatus(),
        fetchIntelligenceRefreshRequests(),
        fetchIntelligenceChangeProposals(),
        fetchIntelligenceConsumptions(),
      ]);
      setStatuses(nextStatuses); setRefreshes(nextRefreshes); setProposals(nextProposals); setConsumptions(nextConsumptions);
    } catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const visibleStatuses = clientFilter === "all" ? statuses : statuses.filter((row) => row.client_id === clientFilter);
  const summary = useMemo(() => ({
    ready: statuses.filter((row) => row.active_release_id && row.freshness === "fresh" && row.dependency_status === "current").length,
    missing: statuses.filter((row) => !row.active_release_id).length,
    due: statuses.filter((row) => row.freshness === "due").length,
    staleOrDrifted: statuses.filter((row) => row.freshness === "stale" || row.dependency_status === "drifted").length,
    awaitingReview: statuses.filter((row) => row.latest_release_status === "needs_review").length,
  }), [statuses]);

  async function request(row: IntelligenceOperationalStatus) {
    const reason = window.prompt(`Why should ${readable(row.intelligence_domain)} be refreshed?`, row.dependency_status === "drifted" ? "Upstream authority changed." : "Manual operational refresh.");
    if (!reason?.trim()) return;
    setBusy(`${row.client_id}:${row.intelligence_domain}`); setError(null); setNotice(null);
    try {
      await requestIntelligenceRefresh(row.client_id, row.intelligence_domain, reason.trim());
      setNotice("Refresh request queued. It does not approve or start research automatically.");
      await load();
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(null); }
  }

  async function createProposal() {
    if (!form.clientId || !form.title.trim() || !form.summary.trim() || !form.rationale.trim()) return;
    setBusy("proposal:create"); setError(null); setNotice(null);
    try {
      await createIntelligenceChangeProposal({
        clientId: form.clientId,
        targetKind: form.target === "context" ? "context" : "intelligence",
        targetDomain: form.target === "context" ? null : form.target,
        proposalType: form.proposalType,
        title: form.title.trim(),
        summary: form.summary.trim(),
        rationale: form.rationale.trim(),
        priority: form.priority,
      });
      setForm((current) => ({ ...current, title: "", summary: "", rationale: "" }));
      setNotice("Change proposal created for human review. No authority was mutated.");
      await load();
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(null); }
  }

  async function review(proposal: IntelligenceChangeProposal, decision: "approved" | "dismissed" | "converted_to_draft") {
    const note = window.prompt(`Reviewer note for ${readable(decision)}:`, proposal.reviewer_note ?? "");
    if (note === null) return;
    setBusy(proposal.id); setError(null); setNotice(null);
    try {
      await reviewIntelligenceChangeProposal(proposal.id, decision, note);
      setNotice(decision === "approved"
        ? "Proposal approved in principle. Existing authority remains unchanged."
        : decision === "converted_to_draft"
          ? "Proposal marked for a new draft workflow. Existing authority remains unchanged."
          : "Proposal dismissed.");
      await load();
    } catch (value) { setError(errorText(value)); }
    finally { setBusy(null); }
  }

  if (loading) return <p className="text-2xs text-paper-3">Loading intelligence operations…</p>;
  return <div className="space-y-4">
    <div>
      <h3 className="text-sm font-medium text-paper">Intelligence Operations</h3>
      <p className="mt-1 text-2xs leading-5 text-paper-3">Operational status is calculated from active approved releases, domain-specific policies, dependency drift, run state, refresh requests, and feedback proposals. Drafts never become downstream authority.</p>
    </div>
    {error && <p role="alert" className="rounded border border-neg/20 bg-neg/5 p-2 text-2xs text-neg">{error}</p>}
    {notice && <p className="rounded border border-teal/20 bg-teal/5 p-2 text-2xs text-teal">{notice}</p>}
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
      {[["Ready domains", summary.ready], ["Missing", summary.missing], ["Due", summary.due], ["Stale / drifted", summary.staleOrDrifted], ["Awaiting review", summary.awaitingReview]].map(([label, value]) =>
        <div key={label} className="rounded border border-line bg-ink-200 p-3"><div className="font-mono text-lg text-paper">{value}</div><div className="text-2xs text-paper-3">{label}</div></div>)}
    </div>

    <div className="rounded border border-line bg-ink-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line p-3">
        <div><h4 className="text-xs font-medium text-paper">Client/domain readiness</h4><p className="mt-1 text-2xs text-paper-3">Manual refresh creates a recoverable request; the OS build remains a deliberate user action.</p></div>
        <select className={field} value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="all">All accessible clients</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
      </div>
      <div className="overflow-x-auto"><table className="min-w-[980px] w-full text-2xs">
        <thead><tr className="border-b border-line">{["Client", "Domain", "Authority", "Freshness", "Dependency", "Latest work", "Operations"].map((label) => <th key={label} className="px-3 py-2 text-left font-medium uppercase tracking-cap text-paper-3">{label}</th>)}</tr></thead>
        <tbody>{visibleStatuses.map((row) => <tr key={`${row.client_id}:${row.intelligence_domain}`} className="border-b border-line last:border-0">
          <td className="px-3 py-2 text-paper">{row.client_name}</td>
          <td className="px-3 py-2"><Link className="text-teal hover:underline" to={ROUTES.clientSection(row.client_id, DOMAIN_SECTION[row.intelligence_domain])}>{readable(row.intelligence_domain)}</Link></td>
          <td className="px-3 py-2"><Tag kind={statusTag(row)}>{row.active_version ? `active v${row.active_version}` : "missing"}</Tag></td>
          <td className="px-3 py-2 text-paper-2">{readable(row.freshness)}{row.refresh_interval_days ? ` · ${row.refresh_interval_days}d policy` : " · no policy"}</td>
          <td className={`px-3 py-2 ${row.dependency_status === "drifted" ? "text-neg" : "text-paper-2"}`}>{row.dependency_status}</td>
          <td className="px-3 py-2 text-paper-2">{row.latest_release_status ? readable(row.latest_release_status) : "not started"}{row.latest_run_status ? ` · ${readable(row.latest_run_status)}` : ""}{row.failure_code ? ` · ${row.failure_code}` : ""}</td>
          <td className="px-3 py-2"><Button size="sm" variant="ghost" disabled={row.refresh_pending || busy === `${row.client_id}:${row.intelligence_domain}`} onClick={() => void request(row)}>{row.refresh_pending ? "Refresh queued" : "Request refresh"}</Button></td>
        </tr>)}</tbody>
      </table></div>
    </div>

    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded border border-line bg-ink-200 p-3">
        <h4 className="text-xs font-medium text-paper">Create feedback proposal</h4>
        <p className="mt-1 text-2xs text-paper-3">A proposal can target Context or one OS. Approval is agreement in principle only; it never edits an approved release.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <select className={field} value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}><option value="">Select client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select>
          <select className={field} value={form.target} onChange={(event) => setForm({ ...form, target: event.target.value as typeof form.target })}><option value="context">Context</option>{DOMAINS.map((domain) => <option key={domain} value={domain}>{readable(domain)}</option>)}</select>
          <select className={field} value={form.proposalType} onChange={(event) => setForm({ ...form, proposalType: event.target.value as typeof form.proposalType })}>{["correct", "add", "retire", "investigate", "refresh"].map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select className={field} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value as typeof form.priority })}>{["low", "normal", "high", "urgent"].map((value) => <option key={value} value={value}>{value} priority</option>)}</select>
        </div>
        <input className={`${field} mt-2 w-full`} placeholder="Proposal title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        <textarea className={`${field} mt-2 w-full`} rows={2} placeholder="What should change?" value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
        <textarea className={`${field} mt-2 w-full`} rows={2} placeholder="Why does the evidence justify review?" value={form.rationale} onChange={(event) => setForm({ ...form, rationale: event.target.value })} />
        <Button className="mt-2" size="sm" variant="primary" disabled={busy === "proposal:create" || !form.clientId || !form.title.trim() || !form.summary.trim() || !form.rationale.trim()} onClick={() => void createProposal()}>Create proposal</Button>
      </div>
      <div className="rounded border border-line bg-ink-200 p-3">
        <h4 className="text-xs font-medium text-paper">Refresh queue</h4>
        <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">{refreshes.length === 0 ? <p className="text-2xs text-paper-3">No refresh requests.</p> : refreshes.map((requestRow) => <article key={requestRow.id} className="rounded border border-line bg-ink p-2 text-2xs"><div className="flex flex-wrap gap-2"><Tag kind={requestRow.status === "failed" ? "anomaly" : requestRow.status === "completed" ? "approve" : "decision"}>{requestRow.status}</Tag><span className="text-paper">{readable(requestRow.intelligence_domain)}</span><span className="text-paper-3">{requestRow.request_type} · {clients.find((client) => client.id === requestRow.client_id)?.name ?? requestRow.client_id}</span></div><p className="mt-1 text-paper-2">{requestRow.reason}</p>{requestRow.failure_message && <p className="mt-1 text-neg">{requestRow.failure_message}</p>}</article>)}</div>
      </div>
    </div>

    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded border border-line bg-ink-200 p-3"><h4 className="text-xs font-medium text-paper">Change proposal review</h4><div className="mt-2 max-h-96 space-y-2 overflow-y-auto">{proposals.length === 0 ? <p className="text-2xs text-paper-3">No feedback proposals.</p> : proposals.map((proposal) => <article key={proposal.id} className="rounded border border-line bg-ink p-3 text-2xs"><div className="flex flex-wrap items-center gap-2"><Tag kind={proposal.status === "needs_review" ? "decision" : proposal.status === "approved" ? "approve" : "muted"}>{readable(proposal.status)}</Tag><span className="font-medium text-paper">{proposal.title}</span><span className="text-paper-3">{proposal.target_domain ? readable(proposal.target_domain) : "context"} · {proposal.priority}</span></div><p className="mt-2 text-paper-2">{proposal.summary}</p><p className="mt-1 text-paper-3">{proposal.rationale}</p>{proposal.status === "needs_review" && <div className="mt-2 flex gap-1"><Button size="sm" variant="primary" disabled={busy === proposal.id} onClick={() => void review(proposal, "approved")}>Approve in principle</Button><Button size="sm" variant="ghost" disabled={busy === proposal.id} onClick={() => void review(proposal, "dismissed")}>Dismiss</Button></div>}{proposal.status === "approved" && <Button className="mt-2" size="sm" variant="ghost" disabled={busy === proposal.id} onClick={() => void review(proposal, "converted_to_draft")}>Mark for new draft</Button>}</article>)}</div></div>
      <div className="rounded border border-line bg-ink-200 p-3"><h4 className="text-xs font-medium text-paper">Downstream authority ledger</h4><p className="mt-1 text-2xs text-paper-3">Every entry binds a downstream object to exact releases. Supersession invalidates the entry without rewriting history.</p><div className="mt-2 max-h-96 space-y-2 overflow-y-auto">{consumptions.length === 0 ? <p className="text-2xs text-paper-3">No downstream intelligence consumption recorded yet.</p> : consumptions.map((consumption) => <article key={consumption.id} className="rounded border border-line bg-ink p-2 text-2xs"><div className="flex flex-wrap gap-2"><Tag kind={consumption.invalidated_at ? "anomaly" : "approve"}>{consumption.invalidated_at ? "invalidated" : "current"}</Tag><span className="text-paper">{readable(consumption.consumer_type)} · {consumption.purpose}</span><span className="font-mono text-paper-3">{consumption.consumer_key}</span></div>{consumption.invalidation_reason && <p className="mt-1 text-neg">{consumption.invalidation_reason}</p>}<details className="mt-1 text-paper-3"><summary>Consumed releases</summary><pre className="mt-1 overflow-auto whitespace-pre-wrap">{JSON.stringify(consumption.authority_snapshot, null, 2)}</pre></details></article>)}</div></div>
    </div>
  </div>;
}
