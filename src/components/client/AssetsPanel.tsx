import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/primitives";
import { fetchClientAssets, fetchEffectiveStageMap, fetchProductionBrief, generateAiAssets, transitionAssetsToDistribution, updateClientAssetGroupStatus, type EffectiveStageEntry } from "@/lib/api";
import { ROUTES } from "@/lib/constants";
import { isPassedThrough } from "@/lib/pipeline";
import type { ReviewState } from "@/types/client";
import type { AssetFormat, ClientAssetRow, ProductionMode } from "@/types/phase";
import { PassedThroughDrawer } from "./PassedThroughDrawer";

type GroupStatus = ReviewState | "mixed";
type PendingAction = { kind: ReviewState | "regenerate"; groupRef: string } | null;

interface AssetGroup {
  ref: string;
  rows: ClientAssetRow[];
  first: ClientAssetRow;
  status: GroupStatus;
  mode: ProductionMode | "unknown";
  dimensions: string[];
  warnings: string[];
}

const STATUS_STYLE: Record<GroupStatus, string> = {
  needs_review: "border-warn/20 bg-warn/10 text-warn",
  approved: "border-teal/20 bg-teal/10 text-teal",
  rejected: "border-neg/20 bg-neg/10 text-neg",
  archived: "border-line bg-ink text-paper-3",
  mixed: "border-warn/30 bg-warn/10 text-warn",
};

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function modeFor(row: ClientAssetRow): ProductionMode | "unknown" {
  return row.production_brief?.production_mode ?? (row.generation_provider === "openai" ? "ai" : "unknown");
}

function makeGroup(ref: string, input: ClientAssetRow[]): AssetGroup {
  const rows = [...input].sort((a, b) => a.sequence_index - b.sequence_index);
  const statuses = new Set(rows.map((row) => row.status));
  const dimensions = [...new Set(rows.map((row) => `${row.width}×${row.height}`))];
  const indexes = rows.map((row) => row.sequence_index);
  const warnings: string[] = [];
  if (statuses.size > 1) warnings.push("Child files have inconsistent review statuses.");
  if (dimensions.length > 1) warnings.push("Child files have mixed dimensions.");
  if (indexes.some((value, index) => value !== index + 1)) warnings.push("Sequence indexes are missing or non-contiguous.");
  if (rows.some((row) => !row.signed_url)) warnings.push("One or more private previews could not be signed. Reload to retry.");
  return {
    ref,
    rows,
    first: rows[0],
    status: statuses.size === 1 ? rows[0].status : "mixed",
    mode: modeFor(rows[0]),
    dimensions,
    warnings,
  };
}

function formatLabel(format: AssetFormat): string {
  return format.replaceAll("_", " ");
}

function aspectClass(format: AssetFormat): string {
  return format === "story_sequence" ? "aspect-[9/16]" : "aspect-[4/5]";
}

function Confirmation({ action, group, busy, onCancel, onConfirm }: {
  action: NonNullable<PendingAction>;
  group: AssetGroup;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const regenerate = action.kind === "regenerate";
  const label = regenerate ? "Regenerate Asset" : action.kind === "needs_review" ? "Reset to Needs Review" : action.kind === "archived" ? "Archive Asset" : `${action.kind === "approved" ? "Approve" : "Reject"} Asset`;
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4" onClick={busy ? undefined : onCancel}>
    <div role="dialog" aria-modal="true" aria-label={label} className="w-full max-w-md rounded-[12px] border border-line bg-ink-200 p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <h3 className="text-sm font-medium text-paper">{label}?</h3>
      <p className="mt-3 text-xs leading-5 text-paper-3">{regenerate
        ? `This creates a new asset group from the same ${group.first.source_ref} production brief. The existing group and files remain stored for history.`
        : `This updates all ${group.rows.length} file${group.rows.length === 1 ? "" : "s"} in ${group.first.source_ref} to ${action.kind.replaceAll("_", " ")}. The production brief status will not change.`}</p>
      <div className="mt-5 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button><Button variant={action.kind === "rejected" || action.kind === "archived" ? "danger" : "primary"} disabled={busy} onClick={onConfirm}>{busy ? "Working…" : label}</Button></div>
    </div>
  </div>;
}

function AssetPreviewModal({ group, busy, notice, onClose, onAction, onViewProductionBrief }: {
  group: AssetGroup;
  busy: boolean;
  notice: { error: boolean; message: string } | null;
  onClose: () => void;
  onAction: (kind: NonNullable<PendingAction>["kind"]) => void;
  onViewProductionBrief?: (sourceRef: string) => void;
}) {
  const multi = group.first.asset_format === "carousel" || group.first.asset_format === "story_sequence";
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 sm:items-center" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label={`${group.first.source_ref} asset preview`} className="flex h-[95vh] w-full max-w-7xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:h-[92vh] sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="shrink-0 border-b border-line px-4 py-3 sm:px-5"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-2xs text-teal">{group.first.source_ref}</span><span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${STATUS_STYLE[group.status]}`}>{group.status.replaceAll("_", " ")}</span><span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">{formatLabel(group.first.asset_format)}</span></div><h2 className="mt-2 break-words text-sm font-medium text-paper">{group.first.title ?? group.first.source_ref}</h2><div className="mt-1 flex flex-wrap gap-3 font-mono text-2xs text-paper-3"><span>{group.rows.length} {multi ? group.first.asset_format === "carousel" ? "slides" : "frames" : "image"}</span><span>{group.dimensions.join(", ")}</span><span>{group.first.generation_provider} / {group.first.generation_model}</span><span>{new Date(group.first.created_at).toLocaleString()}</span></div></div><button aria-label="Close asset preview" onClick={onClose} className="text-paper-3 hover:text-paper">✕</button></div></header>
      <div className="flex shrink-0 flex-wrap gap-2 border-b border-line px-4 py-2.5 sm:px-5"><Button size="sm" variant="secondary" disabled={busy || group.status === "approved"} onClick={() => onAction("approved")}>Approve Asset</Button><Button size="sm" variant="danger" disabled={busy || group.status === "rejected"} onClick={() => onAction("rejected")}>Reject Asset</Button>{(group.status === "approved" || group.status === "rejected" || group.status === "mixed") && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction("needs_review")}>Reset to Needs Review</Button>}{group.status === "rejected" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => onAction("archived")}>Archive</Button>}<Button size="sm" variant="ghost" className="ml-auto" disabled={busy || group.first.asset_format === "reel_video"} onClick={() => onAction("regenerate")}>Regenerate Asset</Button></div>
      {notice && <div role={notice.error ? "alert" : "status"} className={`shrink-0 border-b px-5 py-2 text-xs ${notice.error ? "border-neg/20 bg-neg/5 text-neg" : "border-teal/20 bg-teal/5 text-teal"}`}>{notice.message}</div>}
      {!!group.warnings.length && <div className="shrink-0 border-b border-warn/20 bg-warn/5 px-5 py-2 text-xs text-warn">{group.warnings.join(" ")}</div>}
      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className={multi ? "flex snap-x gap-4 overflow-x-auto pb-4" : "mx-auto max-w-3xl"}>{group.rows.map((asset) => <figure key={asset.id} className={`${multi ? "w-[min(72vw,360px)] shrink-0 snap-start" : "w-full"}`}>
          <div className={`flex ${aspectClass(asset.asset_format)} items-center justify-center overflow-hidden rounded-lg border border-line bg-black/30`}>{asset.signed_url ? <img src={asset.signed_url} alt={`${asset.source_ref} ${asset.sequence_index}`} className="h-full w-full object-contain" /> : <div className="px-5 text-center text-xs text-neg">Private preview unavailable. The object may be missing or its signed URL could not be created.</div>}</div>
          <figcaption className="mt-2 flex items-center justify-between text-2xs text-paper-3"><span>{multi ? `${asset.asset_format === "carousel" ? "Slide" : "Frame"} ${asset.sequence_index}` : `${asset.width}×${asset.height}`}</span>{asset.signed_url && <a href={asset.signed_url} target="_blank" rel="noreferrer" className="text-teal hover:underline">Open full image ↗</a>}</figcaption>
        </figure>)}</div>
        <section className="mt-5 grid gap-3 rounded-lg border border-line bg-ink p-4 text-xs sm:grid-cols-2"><div><div className="text-2xs uppercase text-paper-3">Production</div><div className="mt-1 text-paper">{group.mode} · {group.first.generation_provider} / {group.first.generation_model}</div></div><div><div className="text-2xs uppercase text-paper-3">Dimensions</div><div className="mt-1 text-paper">{group.dimensions.join(", ")} · {group.first.mime_type}</div></div><div><div className="text-2xs uppercase text-paper-3">Production brief</div><div className="mt-1 break-all font-mono text-paper">{group.first.production_brief_id}</div>{onViewProductionBrief && <button className="mt-2 text-teal hover:underline" onClick={() => onViewProductionBrief(group.first.source_ref)}>Open in Content Creation →</button>}</div><div><div className="text-2xs uppercase text-paper-3">Source master</div><div className="mt-1 text-paper">{group.first.production_brief?.source_table ?? "Master source"} · {group.first.source_ref}</div>{group.first.production_brief?.source_row_id && <div className="mt-1 break-all font-mono text-2xs text-paper-3">{group.first.production_brief.source_row_id}</div>}</div><div className="sm:col-span-2"><div className="text-2xs uppercase text-paper-3">Storage path</div><div className="mt-1 break-all font-mono text-2xs text-paper">{group.first.storage_bucket}/{group.first.storage_path}</div></div><div className="sm:col-span-2"><div className="text-2xs uppercase text-paper-3">Generation prompt · {group.first.prompt_md.length.toLocaleString()} characters</div><pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-ink-200 p-3 font-mono text-2xs leading-5 text-paper-2">{group.first.prompt_md.slice(0, 2400)}{group.first.prompt_md.length > 2400 ? "\n…" : ""}</pre></div></section>
      </main>
    </div>
  </div>;
}

export function AssetsPanel({ clientId, executionMonth, onViewProductionBrief }: { clientId: string; executionMonth?: string; onViewProductionBrief?: (sourceRef: string) => void }) {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<ClientAssetRow[]>([]);
  const [stageMap, setStageMap] = useState<Map<string, EffectiveStageEntry>>(new Map());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("all");
  const [status, setStatus] = useState("all");
  const [source, setSource] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextAssets, stages] = await Promise.all([fetchClientAssets(clientId), executionMonth ? fetchEffectiveStageMap(clientId, executionMonth) : Promise.resolve(new Map<string, EffectiveStageEntry>())]);
      setAssets(nextAssets); setStageMap(stages);
    }
    catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => { void load(); }; window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, ClientAssetRow[]>();
    for (const asset of assets) map.set(asset.asset_group_ref, [...(map.get(asset.asset_group_ref) ?? []), asset]);
    return [...map.entries()].map(([ref, rows]) => makeGroup(ref, rows)).sort((a, b) => b.first.created_at.localeCompare(a.first.created_at));
  }, [assets]);
  // Active = groups whose ref is still in the assets stage. Once approved (stage
  // distribution or later) the group leaves the active list for the drawer.
  const activeGroups = useMemo(() => groups.filter((group) => { const entry = stageMap.get(group.first.source_ref); return !entry || !isPassedThrough(entry.stage, "assets"); }), [groups, stageMap]);
  const passedThroughEntries = useMemo(() => [...stageMap.values()].filter((entry) => entry.has_produced_asset && isPassedThrough(entry.stage, "assets")), [stageMap]);
  const filtered = useMemo(() => activeGroups.filter((group) => {
    const query = search.trim().toLowerCase();
    const textMatch = !query || `${group.first.source_ref} ${group.first.title ?? ""}`.toLowerCase().includes(query);
    const day = group.first.created_at.slice(0, 10);
    return textMatch && (format === "all" || group.first.asset_format === format) && (status === "all" || group.status === status) && (source === "all" || group.mode === source) && (!dateFrom || day >= dateFrom) && (!dateTo || day <= dateTo);
  }), [activeGroups, dateFrom, dateTo, format, search, source, status]);
  const openGroup = groups.find((group) => group.ref === openRef) ?? null;
  const pendingGroup = pending ? groups.find((group) => group.ref === pending.groupRef) ?? null : null;

  async function confirmAction() {
    if (!pending || !pendingGroup) return;
    setBusy(true); setNotice(null);
    try {
      if (pending.kind === "regenerate") {
        const brief = await fetchProductionBrief(pendingGroup.first.production_brief_id);
        const result = await generateAiAssets(brief);
        await load();
        setOpenRef(result.asset_group_ref);
        setNotice({ error: false, message: `Generated a new ${result.asset_count}-file asset group. The prior group remains stored.` });
      } else {
        const rows = await updateClientAssetGroupStatus(clientId, pendingGroup.ref, pending.kind);
        setAssets((current) => current.map((row) => rows.find((next) => next.id === row.id) ?? row));
        // Approval advances the ref Assets → Distribution: snapshot the asset
        // group and mark it distribution-pending. Guarded so a re-approve of an
        // already-advanced ref does not re-snapshot or regress. Best-effort; the
        // status write already committed and presence keeps visibility correct.
        if (pending.kind === "approved" && executionMonth) {
          const entry = stageMap.get(pendingGroup.first.source_ref);
          if (!entry || !isPassedThrough(entry.stage, "assets")) {
            try {
              await transitionAssetsToDistribution({
                clientId, executionMonth, sourceRef: pendingGroup.first.source_ref,
                assetGroupRef: pendingGroup.ref, productionBriefId: pendingGroup.first.production_brief_id,
                title: pendingGroup.first.title, assetFormat: pendingGroup.first.asset_format,
                assetSnapshot: { asset_group_ref: pendingGroup.ref, files: rows.map((row) => ({ id: row.id, storage_path: row.storage_path, sequence_index: row.sequence_index, status: row.status })) },
              });
            } catch { /* non-fatal */ }
          }
          await load();
          window.dispatchEvent(new Event("aa:reload"));
        }
        setNotice({ error: false, message: `All ${rows.length} group file${rows.length === 1 ? "" : "s"} marked ${pending.kind.replaceAll("_", " ")}.${pending.kind === "approved" && executionMonth ? " Moved to Distribution." : ""}` });
      }
      setPending(null);
    } catch (value) { setNotice({ error: true, message: errorText(value) }); setPending(null); }
    finally { setBusy(false); }
  }

  if (loading && !assets.length) return <div className="p-6 text-xs text-paper-3">Loading generated assets…</div>;
  return <div className="min-h-0 flex-1 overflow-y-auto p-4">
    <div className="mb-3 rounded-[10px] border border-line bg-ink-200 p-4"><div className="flex flex-wrap items-center gap-3"><div><div className="text-sm text-paper">Produced Assets</div><div className="mt-1 text-2xs text-paper-3">One review card per asset group. Private previews use one-hour signed links.</div></div><span className="ml-auto font-mono text-2xs text-paper-3">{filtered.length} of {activeGroups.length} active · {assets.length} files</span><Button size="sm" variant="ghost" disabled={!passedThroughEntries.length} onClick={() => setDrawerOpen(true)}>Archived / Passed Through{passedThroughEntries.length ? ` (${passedThroughEntries.length})` : ""}</Button><Button size="sm" variant="ghost" disabled={loading} onClick={() => void load()}>{loading ? "Reloading…" : "Reload"}</Button></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"><input aria-label="Search assets" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search ref or title…" className="rounded border border-line bg-ink px-2.5 py-1.5 text-xs text-paper outline-none focus:border-teal lg:col-span-2"/><select aria-label="Asset format" value={format} onChange={(event) => setFormat(event.target.value)} className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper"><option value="all">All formats</option>{["ad_static", "feed_post", "carousel", "story_sequence", "reel_video"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select><select aria-label="Asset status" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper"><option value="all">All statuses</option>{["needs_review", "approved", "rejected", "archived", "mixed"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select><select aria-label="Production source" value={source} onChange={(event) => setSource(event.target.value)} className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper"><option value="all">All production</option><option value="ai">AI</option><option value="human">Human</option></select><input aria-label="Assets from date" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper"/><input aria-label="Assets to date" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="rounded border border-line bg-ink px-2 py-1.5 text-xs text-paper"/></div>
    </div>
    {error && <div role="alert" className="mb-3 rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {!groups.length ? <div className="rounded-[10px] border border-dashed border-line p-10 text-center"><div className="text-sm text-paper">No generated assets yet.</div><div className="mt-2 text-xs text-paper-3">Open an approved production brief in Content Creation and choose Produce → AI.</div></div> : !activeGroups.length ? <div className="rounded-[10px] border border-dashed border-line p-10 text-center"><div className="text-sm text-paper">No asset groups are active in review.</div><div className="mt-2 text-xs text-paper-3">Approved groups have moved to Distribution — see Archived / Passed Through.</div></div> : !filtered.length ? <div className="rounded-[10px] border border-dashed border-line p-10 text-center"><div className="text-sm text-paper">No asset groups match these filters.</div><button className="mt-2 text-xs text-teal hover:underline" onClick={() => { setSearch(""); setFormat("all"); setStatus("all"); setSource("all"); setDateFrom(""); setDateTo(""); }}>Clear filters</button></div> : <div className="grid gap-3 lg:grid-cols-2">{filtered.map((group) => <article key={group.ref} className="flex min-w-0 flex-col rounded-[10px] border border-line bg-ink-200 p-4"><div className="flex items-start gap-3"><div className={`w-20 shrink-0 overflow-hidden rounded border border-line ${aspectClass(group.first.asset_format)} bg-black/20`}>{group.first.signed_url ? <img src={group.first.signed_url} alt={group.first.title ?? group.first.source_ref} className="h-full w-full object-cover"/> : <div className="flex h-full items-center justify-center p-2 text-center text-2xs text-neg">Preview unavailable</div>}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-2xs text-teal">{group.first.source_ref}</span><span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${STATUS_STYLE[group.status]}`}>{group.status.replaceAll("_", " ")}</span></div><h3 className="mt-2 break-words text-xs text-paper">{group.first.title ?? formatLabel(group.first.asset_format)}</h3><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-paper-3"><span>{formatLabel(group.first.asset_format)}</span><span>{group.mode}</span><span>{group.rows.length} {group.rows.length === 1 ? "file" : "files"}</span><span>{group.dimensions.join(", ")}</span><span>{group.first.generation_provider} / {group.first.generation_model}</span><span>{new Date(group.first.created_at).toLocaleDateString()}</span></div></div></div>{!!group.warnings.length && <div className="mt-3 rounded border border-warn/20 bg-warn/5 px-2 py-1.5 text-2xs text-warn">{group.warnings.join(" ")}</div>}<div className="mt-3 flex justify-end"><Button size="sm" variant="secondary" onClick={() => { setOpenRef(group.ref); setNotice(null); }}>View</Button></div></article>)}</div>}
    {openGroup && <AssetPreviewModal group={openGroup} busy={busy} notice={notice} onClose={() => { if (!busy) { setOpenRef(null); setNotice(null); } }} onAction={(kind) => setPending({ kind, groupRef: openGroup.ref })} onViewProductionBrief={onViewProductionBrief} />}
    {pending && pendingGroup && <Confirmation action={pending} group={pendingGroup} busy={busy} onCancel={() => setPending(null)} onConfirm={() => void confirmAction()} />}
    {drawerOpen && <PassedThroughDrawer tabStage="assets" entries={passedThroughEntries} onClose={() => setDrawerOpen(false)} onViewFullArchive={(sourceRef) => navigate(`${ROUTES.clientSection(clientId, "archive")}?source_ref=${encodeURIComponent(sourceRef)}`)} />}
  </div>;
}
