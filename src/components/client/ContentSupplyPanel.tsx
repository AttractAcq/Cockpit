// Ideation nav consolidation, Phase 6 — Content Supply is now the single
// entry surface for the whole Ideation group: Add Idea, Add Proof, and
// Ideation (the AI run/score cycle) are three intake methods that all
// converge on Sources, the one approve/disapprove gate before content
// becomes a real, unscheduled Content Items row. Conflicts and Provenance
// are no longer separate tabs — their checks still run, surfaced as compact
// banners here instead.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/primitives";
import {
  PROOF_KINDS,
  SOURCE_KIND_LABEL,
  approveContentSource,
  fetchContextFileProvenance,
  fetchInputConflicts,
  fetchProofItems,
  fetchSupplySources,
  ingestManualIdea,
  ingestProof,
  provenanceOf,
  rejectContentSource,
  reviewConflict,
  runConflictDetection,
  unresolvedBlocking,
  untraceableFiles,
  type ContextFileProvenance,
  type InputConflictRow,
  type SourceAssetType,
  type SupplyProofRow,
  type SupplySourceRow,
} from "@/lib/supply";
import type { ContentSourceKind } from "@/types/content-spine";
import { IdeationPanel } from "./IdeationPanel";

type Tab = "idea" | "proof" | "ideation" | "sources";
type Notice = { kind: "success" | "error" | "info"; text: string } | null;

function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const v = error as { message?: string; code?: string; details?: string };
    return [v.message, v.code && `Code: ${v.code}`, v.details].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

const ALL_KINDS: ContentSourceKind[] = [
  "manual_idea",
  "proof_item",
  "ideation_candidate",
  "research_candidate",
  "performance_insight",
];

const ASSET_TYPES: Array<{ value: SourceAssetType; label: string }> = [
  { value: "reel", label: "Reel" },
  { value: "carousel", label: "Carousel" },
  { value: "static", label: "Static" },
  { value: "story", label: "Story" },
];

interface Props {
  clientId: string;
  executionMonth: string;
  initialTab?: Tab;
}

export function ContentSupplyPanel({ clientId, executionMonth, initialTab = "sources" }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const [sources, setSources] = useState<SupplySourceRow[]>([]);
  const [proofs, setProofs] = useState<SupplyProofRow[]>([]);
  const [conflicts, setConflicts] = useState<InputConflictRow[]>([]);
  const [provenance, setProvenance] = useState<ContextFileProvenance[]>([]);
  const [conflictNote, setConflictNote] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [provenanceOpen, setProvenanceOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<ContentSourceKind[]>([]);
  const [showReviewed, setShowReviewed] = useState(false);

  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaBody, setIdeaBody] = useState("");
  const [ideaNotes, setIdeaNotes] = useState("");
  const [ideaUrl, setIdeaUrl] = useState("");

  const [proofClaim, setProofClaim] = useState("");
  const [proofKind, setProofKind] = useState<string>("testimonial");
  const [proofDetail, setProofDetail] = useState("");
  const [proofUrl, setProofUrl] = useState("");

  const [expanded, setExpanded] = useState<string | null>(null);
  const [assetTypeChoice, setAssetTypeChoice] = useState<Record<string, SourceAssetType>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, c, prov] = await Promise.all([
        fetchSupplySources(clientId, {
          search,
          kinds: kindFilter,
          processing: showReviewed ? undefined : ["pending", "processing", "failed"],
        }),
        fetchProofItems(clientId),
        fetchInputConflicts(clientId),
        fetchContextFileProvenance(clientId),
      ]);
      setSources(s);
      setProofs(p);
      setConflicts(c);
      setProvenance(prov);
    } catch (e) {
      setNotice({ kind: "error", text: `Could not load supply: ${errorMessage(e)}` });
    } finally {
      setLoading(false);
    }
  }, [clientId, search, kindFilter, showReviewed]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitIdea = async () => {
    if (ideaTitle.trim().length === 0 || ideaBody.trim().length === 0) {
      setNotice({ kind: "error", text: "A title and the idea itself are both required." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await ingestManualIdea({
        clientId,
        title: ideaTitle.trim(),
        body: ideaBody,
        notes: ideaNotes,
        sourceUrl: ideaUrl,
      });
      setNotice(
        result.duplicate
          ? { kind: "info", text: "An identical idea already exists for this client — no duplicate was created." }
          : { kind: "success", text: "Idea saved. It's waiting for approval in Sources." },
      );
      if (!result.duplicate) {
        setIdeaTitle("");
        setIdeaBody("");
        setIdeaNotes("");
        setIdeaUrl("");
      }
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: `Could not save idea: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const submitProof = async () => {
    if (proofClaim.trim().length === 0 || proofDetail.trim().length === 0) {
      setNotice({ kind: "error", text: "A claim and supporting detail are both required." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await ingestProof({
        clientId,
        claim: proofClaim.trim(),
        proofKind,
        detail: proofDetail,
        sourceUrl: proofUrl,
      });
      setNotice(
        result.duplicate
          ? { kind: "info", text: "Identical proof already exists — no duplicate was created." }
          : {
              kind: "success",
              text: "Proof saved. It enters unverified with no consent recorded and cannot be approved until both are set.",
            },
      );
      if (!result.duplicate) {
        setProofClaim("");
        setProofDetail("");
        setProofUrl("");
      }
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: `Could not save proof: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const proofBySource = useMemo(() => {
    const map: Record<string, SupplyProofRow> = {};
    for (const p of proofs) map[p.content_source_id] = p;
    return map;
  }, [proofs]);

  const blockingCount = useMemo(() => unresolvedBlocking(conflicts).length, [conflicts]);
  const untraceableCount = useMemo(() => untraceableFiles(provenance).length, [provenance]);

  const scanConflicts = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await runConflictDetection(clientId);
      setNotice({
        kind: r.found > 0 ? "info" : "success",
        text: r.found === 0
          ? `Scanned ${r.scanned_fields} input fields — no conflicts found.`
          : `Scanned ${r.scanned_fields} fields: ${r.found} conflict(s), ${r.inserted} new, ${r.already_open} already open.`,
      });
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: `Detection failed: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const decide = async (
    conflict: InputConflictRow,
    status: "acknowledged" | "resolved" | "dismissed",
  ) => {
    const note = (conflictNote[conflict.id] ?? "").trim();
    if ((status === "resolved" || status === "dismissed") && note.length === 0) {
      setNotice({ kind: "error", text: "Resolving or dismissing a conflict requires a written reason." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await reviewConflict({ conflictId: conflict.id, status, note });
      setNotice({ kind: "success", text: `Conflict marked ${status}.` });
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: `Could not update conflict: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const approve = async (source: SupplySourceRow) => {
    const needsAssetType = source.source_kind !== "ideation_candidate";
    const assetType = assetTypeChoice[source.id];
    if (needsAssetType && !assetType) {
      setNotice({ kind: "error", text: "Choose a format before approving." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await approveContentSource({ clientId, sourceId: source.id, assetType });
      setNotice({ kind: "success", text: `Approved into Content Items as ${result.ref}. It is unscheduled.` });
      setExpanded(null);
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: `Could not approve: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const disapprove = async (source: SupplySourceRow) => {
    setBusy(true);
    setNotice(null);
    try {
      await rejectContentSource({ clientId, sourceId: source.id, reason: rejectReason[source.id] });
      setNotice({ kind: "info", text: "Source disapproved. It will not enter Content Items." });
      setExpanded(null);
      await load();
    } catch (e) {
      setNotice({ kind: "error", text: `Could not disapprove: ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const toggleKind = (kind: ContentSourceKind) => {
    setKindFilter((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  };

  const field =
    "w-full rounded border border-line bg-transparent px-2.5 py-1.5 text-xs text-paper placeholder:text-paper-3 focus:border-teal focus:outline-none";
  const label = "mb-1 block text-2xs uppercase tracking-wide text-paper-3";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-2">
        {(["idea", "proof", "ideation", "sources"] as Tab[]).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tab === t ? "secondary" : "ghost"}
            onClick={() => setTab(t)}
          >
            {t === "idea"
              ? "Add Idea"
              : t === "proof"
                ? "Add Proof"
                : t === "ideation"
                  ? "Ideation"
                  : `Sources (${sources.length})`}
          </Button>
        ))}
        <span className="ml-auto text-2xs text-paper-3">
          Approving a Source lands it, unscheduled, in Content Items.
        </span>
      </div>

      {notice && (
        <div
          className={`shrink-0 border-b border-line px-5 py-2 text-xs ${
            notice.kind === "error" ? "text-neg" : notice.kind === "success" ? "text-teal" : "text-paper-3"
          }`}
        >
          {notice.text}
        </div>
      )}

      {tab === "ideation" ? (
        <IdeationPanel clientId={clientId} executionMonth={executionMonth} />
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === "idea" && (
          <div className="max-w-2xl space-y-3">
            <div>
              <label className={label} htmlFor="idea-title">Title</label>
              <input id="idea-title" className={field} value={ideaTitle} maxLength={400}
                onChange={(e) => setIdeaTitle(e.target.value)} placeholder="Short name for this idea" />
            </div>
            <div>
              <label className={label} htmlFor="idea-body">Raw idea</label>
              <textarea id="idea-body" className={`${field} min-h-32`} value={ideaBody}
                onChange={(e) => setIdeaBody(e.target.value)}
                placeholder="Captured exactly as written — this is stored immutably." />
            </div>
            <div>
              <label className={label} htmlFor="idea-notes">Notes (optional)</label>
              <input id="idea-notes" className={field} value={ideaNotes}
                onChange={(e) => setIdeaNotes(e.target.value)} />
            </div>
            <div>
              <label className={label} htmlFor="idea-url">Source URL (optional)</label>
              <input id="idea-url" className={field} value={ideaUrl}
                onChange={(e) => setIdeaUrl(e.target.value)} placeholder="https://" />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={busy} onClick={() => void submitIdea()}>
                {busy ? "Saving…" : "Save idea"}
              </Button>
              <span className="text-2xs text-paper-3">Saved to Sources; nothing is generated yet.</span>
            </div>
          </div>
        )}

        {tab === "proof" && (
          <div className="max-w-2xl space-y-3">
            <div>
              <label className={label} htmlFor="proof-claim">Claim</label>
              <input id="proof-claim" className={field} value={proofClaim} maxLength={4000}
                onChange={(e) => setProofClaim(e.target.value)}
                placeholder="What this proof demonstrates" />
            </div>
            <div>
              <label className={label} htmlFor="proof-kind">Proof type</label>
              <select id="proof-kind" className={field} value={proofKind}
                onChange={(e) => setProofKind(e.target.value)}>
                {PROOF_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
              </select>
            </div>
            <div>
              <label className={label} htmlFor="proof-detail">Evidence detail</label>
              <textarea id="proof-detail" className={`${field} min-h-32`} value={proofDetail}
                onChange={(e) => setProofDetail(e.target.value)}
                placeholder="What happened, who for, what changed" />
            </div>
            <div>
              <label className={label} htmlFor="proof-url">Evidence URL (optional)</label>
              <input id="proof-url" className={field} value={proofUrl}
                onChange={(e) => setProofUrl(e.target.value)} placeholder="https://" />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={busy} onClick={() => void submitProof()}>
                {busy ? "Saving…" : "Save proof"}
              </Button>
              <span className="text-2xs text-paper-3">
                Enters unverified, consent not obtained. Both are required before it can be approved.
              </span>
            </div>

            {proofs.length > 0 && (
              <div className="mt-6 border-t border-line pt-4">
                <h3 className="mb-2 text-2xs uppercase tracking-wide text-paper-3">Proof Vault ({proofs.length})</h3>
                {proofs.map((p) => (
                  <div key={p.id} className="border-b border-line py-2 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">{p.proof_kind}</span>
                      <span className={`text-2xs ${p.verification_status === "verified" ? "text-teal" : "text-warn"}`}>
                        {p.verification_status}
                      </span>
                      <span className={`text-2xs ${p.consent_status === "granted" || p.consent_status === "not_required" ? "text-teal" : "text-warn"}`}>
                        consent: {p.consent_status.replace(/_/g, " ")}
                      </span>
                      <span className="text-2xs text-paper-3">{p.usage_state.replace(/_/g, " ")}</span>
                    </div>
                    <p className="mt-1 break-words text-xs leading-5 text-paper">{p.claim}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "sources" && (
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-ink-200 px-3 py-2">
              <button type="button" className="text-2xs text-paper-2" onClick={() => setConflictsOpen((v) => !v)}>
                {blockingCount > 0 ? (
                  <span className="text-neg">{blockingCount} unresolved blocking conflict{blockingCount === 1 ? "" : "s"}</span>
                ) : (
                  <span className="text-paper-3">No blocking conflicts</span>
                )}
                {" "}· {conflictsOpen ? "hide" : "show"}
              </button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void scanConflicts()}>
                {busy ? "Scanning…" : "Scan inputs for conflicts"}
              </Button>
              <button type="button" className="text-2xs text-paper-2" onClick={() => setProvenanceOpen((v) => !v)}>
                {untraceableCount > 0 ? (
                  <span className="text-warn">{untraceableCount} context file{untraceableCount === 1 ? "" : "s"} without citations</span>
                ) : (
                  <span className="text-paper-3">All context files traceable</span>
                )}
                {" "}· {provenanceOpen ? "hide" : "show"}
              </button>
            </div>

            {conflictsOpen && (
              <div className="mb-4 rounded border border-line p-3">
                {conflicts.length === 0 && <p className="text-xs text-paper-3">No conflicts recorded.</p>}
                {conflicts.map((c) => {
                  const decided = c.status === "resolved" || c.status === "dismissed";
                  return (
                    <div key={c.id} className="border-b border-line py-3 last:border-b-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-2xs ${
                            c.severity === "blocking"
                              ? "border-neg/20 text-neg"
                              : c.severity === "warning"
                                ? "border-warn/20 text-warn"
                                : "border-line text-paper-3"
                          }`}
                        >
                          {c.severity}
                        </span>
                        <span className="text-2xs font-mono text-paper-3">{c.conflict_type}</span>
                        <span className="text-2xs text-paper-3">{c.status}</span>
                        <span className="text-2xs font-mono text-paper-3">{c.left_source_ref}</span>
                      </div>
                      <h3 className="mt-1.5 break-words text-xs font-medium leading-5 text-paper">{c.title}</h3>
                      <p className="mt-0.5 break-words text-2xs leading-5 text-paper-3">{c.detail}</p>
                      {decided ? (
                        <p className="mt-1 text-2xs text-paper-3">{c.status} — {c.resolution_note}</p>
                      ) : (
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                          <input
                            aria-label={`Reason for ${c.title}`}
                            className={field}
                            value={conflictNote[c.id] ?? ""}
                            onChange={(e) => setConflictNote((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            placeholder="Reason (required to resolve or dismiss)"
                          />
                          {c.status === "open" && (
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide(c, "acknowledged")}>
                              Acknowledge
                            </Button>
                          )}
                          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide(c, "resolved")}>
                            Resolve
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void decide(c, "dismissed")}>
                            Dismiss
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {provenanceOpen && (
              <div className="mb-4 rounded border border-line p-3">
                {provenance.length === 0 && <p className="text-xs text-paper-3">No context files generated yet.</p>}
                {provenance.map((f) => (
                  <div key={f.id} className="border-b border-line py-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-2xs font-mono text-teal">{String(f.file_number).padStart(2, "0")}</span>
                      <span className="text-xs text-paper">{f.file_name}</span>
                      <span className="text-2xs text-paper-3">{f.status}</span>
                      <span className="text-2xs text-paper-3">v{f.version}</span>
                      <span className={`text-2xs ${f.citations.length === 0 ? "text-warn" : "text-paper-3"}`}>
                        {f.citations.length} citation{f.citations.length === 1 ? "" : "s"}
                      </span>
                      <span className={`text-2xs ${f.playbooks.length === 0 ? "text-warn" : "text-paper-3"}`}>
                        {f.playbooks.length === 0 ? "no playbook authority" : `${f.playbooks.length} playbook version(s)`}
                      </span>
                    </div>
                    {f.citations.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {f.citations.slice(0, 8).map((c) => (
                          <div key={c.id} className="flex flex-wrap items-baseline gap-2">
                            <span className="text-2xs font-mono text-paper-3">
                              {c.source_type === "client_input" ? c.client_input_field : c.source_type}
                            </span>
                            <span className="min-w-0 flex-1 break-words text-2xs text-paper-3">{c.claim_excerpt}</span>
                          </div>
                        ))}
                        {f.citations.length > 8 && <p className="text-2xs text-paper-3">…and {f.citations.length - 8} more</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                aria-label="Search sources"
                className={`${field} max-w-xs`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title or summary"
              />
              {ALL_KINDS.map((k) => (
                <Button key={k} size="sm" variant={kindFilter.includes(k) ? "secondary" : "ghost"}
                  onClick={() => toggleKind(k)}>
                  {SOURCE_KIND_LABEL[k]}
                </Button>
              ))}
              <Button size="sm" variant={showReviewed ? "secondary" : "ghost"} onClick={() => setShowReviewed((v) => !v)}>
                {showReviewed ? "Showing all" : "Show approved/disapproved"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void load()}>Refresh</Button>
            </div>

            {loading && <p className="text-xs text-paper-3">Loading sources…</p>}

            {!loading && sources.length === 0 && (
              <p className="text-xs text-paper-3">
                No sources waiting for review. Add an idea, add proof, or run Ideation to create scored candidates.
              </p>
            )}

            {!loading && sources.map((s) => {
              const proof = s.proof_item_id ? proofBySource[s.id] : undefined;
              const decided = s.processing_status === "processed" || s.processing_status === "skipped";
              const needsAssetType = s.source_kind !== "ideation_candidate";
              return (
                <div key={s.id} className="border-b border-line py-3 last:border-b-0">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">
                          {SOURCE_KIND_LABEL[s.source_kind]}
                        </span>
                        <span
                          className={`text-2xs ${
                            s.processing_status === "failed"
                              ? "text-neg"
                              : s.processing_status === "processed"
                                ? "text-teal"
                                : "text-paper-3"
                          }`}
                        >
                          {s.processing_status}
                          {s.processing_status === "failed" && s.attempt_count < s.maximum_attempts && " · retryable"}
                        </span>
                        {s.payload?.overall_score !== undefined && (
                          <span className="text-2xs font-mono text-paper-3">
                            {s.payload.overall_score}/100 {s.payload.priority_band}
                            {s.payload.rank !== undefined ? ` · rank ${s.payload.rank}` : ""}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1.5 break-words text-xs font-medium leading-5 text-paper">{s.title}</h3>
                      <p className="mt-0.5 text-2xs text-paper-3">Provenance: {provenanceOf(s)}</p>
                      {s.failure_code && (
                        <p className="mt-0.5 text-2xs text-neg">{s.failure_code}: {s.failure_message}</p>
                      )}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                      {expanded === s.id ? "Close" : "Open"}
                    </Button>
                  </div>

                  {expanded === s.id && (
                    <div className="mt-3 rounded border border-line p-3">
                      {s.raw_content && (
                        <>
                          <h4 className={label}>Raw source (immutable)</h4>
                          <pre className="mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-2xs leading-5 text-paper-3">
                            {s.raw_content}
                          </pre>
                        </>
                      )}
                      {proof && (
                        <p className="mb-3 text-2xs text-paper-3">
                          Proof: {proof.verification_status} · consent {proof.consent_status.replace(/_/g, " ")} · {proof.usage_state.replace(/_/g, " ")}
                        </p>
                      )}

                      {decided ? (
                        <p className="text-2xs text-paper-3">
                          Already {s.processing_status === "processed" ? "approved" : "disapproved"}
                          {s.processing_status === "processed" ? " — see Content Items." : s.failure_message ? `: ${s.failure_message}` : "."}
                        </p>
                      ) : (
                        <>
                          {needsAssetType && (
                            <div className="mb-2">
                              <h4 className={label}>Approve as</h4>
                              <div className="flex flex-wrap gap-2">
                                {ASSET_TYPES.map((t) => (
                                  <Button
                                    key={t.value}
                                    size="sm"
                                    variant={assetTypeChoice[s.id] === t.value ? "secondary" : "ghost"}
                                    onClick={() => setAssetTypeChoice((prev) => ({ ...prev, [s.id]: t.value }))}
                                  >
                                    {t.label}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <Button size="sm" disabled={busy} onClick={() => void approve(s)}>
                              {busy ? "Approving…" : "Approve"}
                            </Button>
                            <input
                              aria-label="Disapproval reason (optional)"
                              className={field}
                              value={rejectReason[s.id] ?? ""}
                              onChange={(e) => setRejectReason((prev) => ({ ...prev, [s.id]: e.target.value }))}
                              placeholder="Reason (optional)"
                            />
                            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void disapprove(s)}>
                              Disapprove
                            </Button>
                          </div>
                          <p className="mt-1 text-2xs text-paper-3">
                            Approving lands this in Content Items, unscheduled. It is placed on the Calendar separately.
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
