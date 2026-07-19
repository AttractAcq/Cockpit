import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/primitives";
import { fetchArchiveDetail, fetchArchiveIndex, fetchLifecycleDateContext, type ArchiveDetail, type ArchiveIndexEntry } from "@/lib/api";
import { STAGE_LABEL } from "@/lib/pipeline";
import { groupLifecycleRecordsByDate, resolveCanonicalPublishDate, resolveLifecycleContentType, type DateDirection, type LifecycleDateContext } from "@/lib/lifecycle-date";
import { normalizeDestinationDisplay, STATUS_GUIDANCE } from "@/lib/distribution-operator";
import { ROUTES } from "@/lib/constants";
import type { ArchiveSnapshotRow, PipelineStage } from "@/types/phase";
import { DestructiveDialog } from "./DestructiveDialog";
import { MarkdownPreview } from "./ExecutionFilesPanel";
import { LifecycleDateSection, LifecycleDirectionToggle } from "@/components/shared/LifecycleDateSection";

type DetailTab = "master" | "content_creation" | "assets" | "distribution" | "analytics" | "analysis";
const DETAIL_TABS: Array<{ key: DetailTab; label: string }> = [
  { key: "master", label: "Master" },
  { key: "content_creation", label: "Content Briefs" },
  { key: "assets", label: "Assets" },
  { key: "distribution", label: "Distribution" },
  { key: "analytics", label: "Analytics" },
  { key: "analysis", label: "Analysis / Iteration" },
];

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function Json({ value }: { value: unknown }) {
  return <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-ink p-3 font-mono text-2xs leading-5 text-paper-2">{JSON.stringify(value, null, 2)}</pre>;
}

function Snapshots({ snapshots, stage }: { snapshots: ArchiveSnapshotRow[]; stage: PipelineStage }) {
  const forStage = snapshots.filter((snapshot) => snapshot.stage === stage);
  if (!forStage.length) return <div className="mt-3 text-2xs text-paper-3">No archive snapshot captured for this stage.</div>;
  return <div className="mt-3 space-y-2">
    <div className="text-2xs uppercase text-paper-3">Archive snapshots — what this stage looked like when it was left</div>
    {forStage.map((snapshot) => <div key={snapshot.id} className="rounded-lg border border-line bg-ink-200 p-3">
      <div className="mb-1 flex flex-wrap gap-2 text-2xs text-paper-3"><span className="font-mono text-teal">{snapshot.source_table}</span>{snapshot.snapshot_reason && <span>· {snapshot.snapshot_reason.replaceAll("_", " ")}</span>}<span>· {new Date(snapshot.created_at).toLocaleString()}</span></div>
      <Json value={snapshot.snapshot_data} />
    </div>)}
  </div>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-paper-3">{text}</div>;
}

function KeyValues({ row }: { row: Record<string, unknown> }) {
  const entries = Object.entries(row).filter(([key]) => !["id", "client_id"].includes(key));
  return <div className="grid gap-2 md:grid-cols-2">{entries.map(([key, value]) => <div key={key} className="min-w-0 rounded border border-line bg-ink p-2.5"><div className="text-2xs font-mono uppercase text-paper-3">{key.replaceAll("_", " ")}</div><div className="mt-1 whitespace-pre-wrap break-words text-xs text-paper-2">{value === null || value === "" ? "—" : typeof value === "string" ? value : JSON.stringify(value)}</div></div>)}</div>;
}

function DetailBody({ tab, detail, clientId, onDeleteAsset }: { tab: DetailTab; detail: ArchiveDetail; clientId: string; onDeleteAsset?: (assetId: string) => void }) {
  if (tab === "master") {
    return <div>{detail.master ? <><div className="mb-2 flex items-center gap-2 text-2xs text-paper-3"><span className="rounded border border-line px-1.5 py-0.5">{detail.master.table}</span><span className="font-mono text-teal">{detail.master.row.ref}</span><span>· live source row</span></div><KeyValues row={detail.master.row as unknown as Record<string, unknown>} /></> : <Empty text="No master row could be resolved for this ref." />}<Snapshots snapshots={detail.snapshots} stage="master" /></div>;
  }
  if (tab === "content_creation") {
    return <div>{detail.brief ? <><div className="mb-2 flex flex-wrap items-center gap-2 text-2xs text-paper-3"><span className="rounded border border-line px-1.5 py-0.5">{detail.brief.asset_format.replaceAll("_", " ")}</span><span>status {detail.brief.status}</span><span>· v{detail.brief.version}</span><span>· {detail.brief.production_status.replaceAll("_", " ")}</span></div><div className="rounded-lg border border-line bg-ink p-4"><MarkdownPreview content={detail.brief.content_md} /></div></> : <Empty text="No production brief exists for this ref." />}<Snapshots snapshots={detail.snapshots} stage="content_creation" /></div>;
  }
  if (tab === "assets") {
    return <div>{detail.assets.length ? <div className="space-y-3"><div className="text-2xs text-paper-3">{detail.assets.length} asset file{detail.assets.length === 1 ? "" : "s"} · group {detail.assets[0].asset_group_ref} · status {detail.assets[0].status}</div><div className="flex flex-wrap gap-3">{detail.assets.map((asset) => <figure key={asset.id} className="w-40"><div className="flex aspect-[4/5] items-center justify-center overflow-hidden rounded-lg border border-line bg-black/30">{asset.signed_url ? <img src={asset.signed_url} alt={`${asset.source_ref} ${asset.sequence_index}`} className="h-full w-full object-contain" /> : <span className="px-2 text-center text-2xs text-neg">Preview unavailable</span>}</div><figcaption className="mt-1 flex items-center justify-between gap-1 text-2xs text-paper-3"><span>#{asset.sequence_index} · v{asset.version ?? 1} · {asset.status}</span>{onDeleteAsset && <button className="text-neg hover:underline" onClick={() => onDeleteAsset(asset.id)}>Delete</button>}</figcaption></figure>)}</div></div> : <Empty text="No produced assets for this ref." />}<Snapshots snapshots={detail.snapshots} stage="assets" /></div>;
  }
  if (tab === "distribution") {
    const record = detail.distribution;
    return <div>{record ? <div className="space-y-3"><div className="flex flex-wrap gap-2 text-2xs text-paper-3"><span className="rounded border border-line px-1.5 py-0.5">status {record.publish_status}</span><span>· {STATUS_GUIDANCE[record.publish_status]}</span>{record.publish_mode && <span>· {record.publish_mode.replaceAll("_", " ")}</span>}<span>· platform {record.platform}</span>{record.destination && <span>· → {normalizeDestinationDisplay(record.destination)}</span>}</div><div className="grid gap-2 sm:grid-cols-3 text-2xs text-paper-3"><div>planned: {record.planned_publish_date ?? "—"}</div><div>scheduled: {record.scheduled_publish_at ? <>{new Date(record.scheduled_publish_at).toLocaleString()}<br/><span className="font-mono">UTC {record.scheduled_publish_at}</span></> : "—"}</div><div>published: {record.published_at ? new Date(record.published_at).toLocaleString() : "—"}</div></div><div className="text-2xs text-paper-3">Published URL: {record.published_url ? <a href={record.published_url} target="_blank" rel="noreferrer" className="text-teal hover:underline">{record.published_url}</a> : "—"}</div>{record.last_error && <div className="text-2xs text-neg">{record.last_error}</div>}<div><div className="text-2xs uppercase text-paper-3">Publish payload</div><Json value={record.publish_payload} /></div><div><div className="text-2xs uppercase text-paper-3">Publish settings</div><Json value={record.publish_settings} /></div></div> : <Empty text="This ref has not reached distribution." />}<Snapshots snapshots={detail.snapshots} stage="distribution" /></div>;
  }
  if (tab === "analytics") {
    const record = detail.analytics;
    return <div>{record ? <div className="space-y-3"><div className="flex flex-wrap gap-2 text-2xs text-paper-3"><span className="rounded border border-line px-1.5 py-0.5">{record.analytics_status.replaceAll("_", " ")}</span><span>· published {new Date(record.published_at).toLocaleString()}</span><span>· {detail.metricSnapshots.length} metric snapshot{detail.metricSnapshots.length === 1 ? "" : "s"}</span><span>· {detail.businessSignals.length} business signal snapshot{detail.businessSignals.length === 1 ? "" : "s"}</span></div><div className="text-2xs text-paper-3">Published URL: {record.published_url ? <a href={record.published_url} target="_blank" rel="noreferrer" className="text-teal hover:underline">{record.published_url}</a> : "—"}</div><a className="text-2xs text-teal hover:underline" href={`${ROUTES.clientSection(clientId, "analytics")}?distribution_id=${encodeURIComponent(record.distribution_record_id ?? "")}`}>Open manual analytics</a>{record.notes && <div className="text-xs text-paper-2">{record.notes}</div>}<div><div className="text-2xs uppercase text-paper-3">Legacy lifecycle metrics</div><Json value={record.metrics} /></div>{detail.metricSnapshots[0] && <div className="text-2xs text-paper-3">Latest manual metrics: {new Date(detail.metricSnapshots[0].snapshot_at).toLocaleString()}</div>}</div> : <Empty text="This ref has not been published, so no analytics record exists." />}<Snapshots snapshots={detail.snapshots} stage="analytics" /></div>;
  }
  // analysis / iteration
  const inAnalysis = detail.pipelineState?.current_stage === "analysis";
  return <div>
    <div className="rounded-lg border border-dashed border-line p-6 text-center text-xs text-paper-3">
      {inAnalysis ? "This ref is in the analysis / iteration stage, ready for the future iteration loop." : "Iteration outputs will appear here once the analysis / iteration loop is built. No iteration output is generated yet."}
    </div>
    {detail.pipelineState && <div className="mt-3"><div className="text-2xs uppercase text-paper-3">Pipeline state</div><Json value={detail.pipelineState} /></div>}
    <Snapshots snapshots={detail.snapshots} stage="analysis" />
  </div>;
}

function ArchiveDetailModal({ clientId, executionMonth, sourceRef, onClose }: {
  clientId: string; executionMonth: string; sourceRef: string; onClose: () => void;
}) {
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [tab, setTab] = useState<DetailTab>("master");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteAssetId, setDeleteAssetId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    fetchArchiveDetail(clientId, executionMonth, sourceRef)
      .then((value) => { if (active) setDetail(value); })
      .catch((value) => { if (active) setError(errorText(value)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientId, executionMonth, sourceRef, reloadKey]);
  useEffect(() => { function onEscape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); } window.addEventListener("keydown", onEscape); return () => window.removeEventListener("keydown", onEscape); }, [onClose]);

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 sm:items-center" onClick={onClose}>
    <div className="flex h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:h-[90vh] sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="shrink-0 border-b border-line px-5 py-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-2xs text-teal">{sourceRef}</span>{detail?.pipelineState && <span className="rounded border border-teal/20 bg-teal/10 px-1.5 py-0.5 font-mono text-2xs text-teal">stage: {STAGE_LABEL[detail.pipelineState.current_stage]}</span>}</div><h2 className="mt-1 break-words text-base font-medium text-paper">{detail?.brief?.title ?? detail?.distribution?.title ?? sourceRef}</h2><div className="mt-1 text-2xs text-paper-3">Full lifecycle · live records + immutable stage snapshots</div></div><button onClick={onClose} className="text-paper-3 hover:text-paper">✕</button></div></header>
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-line px-4 py-2">{DETAIL_TABS.map(({ key, label }) => <button key={key} onClick={() => setTab(key)} className={`rounded-md px-2.5 py-1 text-2xs font-medium ${tab === key ? "bg-teal/15 text-teal" : "text-paper-3 hover:bg-ink hover:text-paper"}`}>{label}</button>)}</div>
      <main className="min-h-0 flex-1 overflow-y-auto p-5">{loading ? <div className="text-xs text-paper-3">Loading lifecycle…</div> : error ? <div className="text-xs text-neg">{error}</div> : detail ? <DetailBody tab={tab} detail={detail} clientId={clientId} onDeleteAsset={setDeleteAssetId} /> : null}</main>
    </div>
    {deleteAssetId && <DestructiveDialog target={{ operation_type: "delete_asset", asset_id: deleteAssetId }} title="Permanently delete asset" confirmWord="DELETE" onClose={() => setDeleteAssetId(null)} onDone={() => { setReloadKey((k) => k + 1); window.dispatchEvent(new Event("aa:reload")); }} />}
  </div>;
}

/**
 * H4 Archive: the full lifecycle view aggregated by source_ref. Combines live
 * current records from every source table with the immutable stage snapshots.
 * Read-only — nothing is deleted, moved, or overwritten.
 */
export function ArchivePanel({ clientId, executionMonth }: { clientId: string; executionMonth: string }) {
  const [searchParams] = useSearchParams();
  const [entries, setEntries] = useState<ArchiveIndexEntry[]>([]);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [highlightRef, setHighlightRef] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateDirection, setDateDirection] = useState<DateDirection>("desc");
  const [lifecycleContext, setLifecycleContext] = useState<LifecycleDateContext>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const [nextEntries, dateContext] = await Promise.all([fetchArchiveIndex(clientId, executionMonth), fetchLifecycleDateContext(clientId, executionMonth)]); setEntries(nextEntries); setLifecycleContext(dateContext); }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => { void load(); }; window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);

  // Deep-link from the H2 passed-through drawers: ?source_ref=… opens & highlights it.
  useEffect(() => {
    const ref = searchParams.get("source_ref");
    if (!ref) return;
    setOpenRef(ref); setHighlightRef(ref); setQuery(ref);
  }, [searchParams]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => !q || `${entry.source_ref} ${entry.title ?? ""}`.toLowerCase().includes(q));
  }, [entries, query]);
  const groupedByDate = useMemo(() => groupLifecycleRecordsByDate(filtered, { lifecycleStage: "archive", context: lifecycleContext, direction: dateDirection }), [dateDirection, filtered, lifecycleContext]);

  if (loading && !entries.length) return <div className="p-6 text-xs text-paper-3">Loading archive…</div>;
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div><div className="text-sm text-paper">Lifecycle Archive</div><div className="mt-1 text-2xs text-paper-3">Every ref that has progressed beyond master. Live records + immutable snapshots, by source_ref.</div></div>
        <input aria-label="Search archive" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ref or title…" className="ml-auto rounded border border-line bg-ink px-2.5 py-1.5 text-xs text-paper outline-none focus:border-teal" />
        <LifecycleDirectionToggle value={dateDirection} onChange={setDateDirection} />
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>{loading ? "Reloading…" : "Reload"}</Button>
      </div>
    </div>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {!filtered.length ? (
      <div className="rounded-[10px] border border-dashed border-line p-10 text-center"><div className="text-sm text-paper">{entries.length ? "No refs match this search." : "Nothing in the lifecycle archive yet."}</div><div className="mt-2 text-xs text-paper-3">{entries.length ? "" : "Refs appear here once they progress past the Master stage."}</div></div>
    ) : (
      <div className="flex flex-col gap-4">
        {groupedByDate.map((section) => <LifecycleDateSection key={section.key} group={section} statusSummary={`${section.records.length} archived refs`}>
        <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">
        {section.records.map((entry) => {
          const lifecycleDate = resolveCanonicalPublishDate(entry, "archive", lifecycleContext).date;
          const contentType = resolveLifecycleContentType(entry);
          return (
          <article key={entry.source_ref} className={`flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 ${highlightRef === entry.source_ref ? "bg-teal/5" : ""}`}>
            <span className="w-28 shrink-0 font-mono text-2xs text-teal">{entry.source_ref}</span>
            <div className="min-w-[240px] flex-1">
              <div className="break-words text-xs text-paper">{entry.title ?? entry.source_ref}</div>
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-2xs text-paper-3">
                <span>{contentType.label}</span>
                <span>· stages: {entry.stages_present.map((stage) => STAGE_LABEL[stage]).join(" ▸ ")}</span>
              </div>
              <div className="mt-1 text-2xs text-paper-3">{entry.latest_status.replaceAll("_", " ")} · content date {lifecycleDate ?? "date unavailable"} · archive updated {new Date(entry.updated_at).toLocaleString()}</div>
            </div>
            <span className="rounded border border-teal/20 bg-teal/10 px-1.5 py-0.5 font-mono text-2xs text-teal">{STAGE_LABEL[entry.current_stage]}</span>
            <Button size="sm" variant="ghost" onClick={() => { setHighlightRef(entry.source_ref); setOpenRef(entry.source_ref); }}>View</Button>
          </article>
          );
        })}
        </div>
        </LifecycleDateSection>)}
      </div>
    )}
    {openRef && <ArchiveDetailModal clientId={clientId} executionMonth={executionMonth} sourceRef={openRef} onClose={() => setOpenRef(null)} />}
  </div>;
}
