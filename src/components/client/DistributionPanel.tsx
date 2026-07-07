import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/primitives";
import {
  cancelDistributionRecord,
  fetchDistributionRecords,
  fetchEffectiveStageMap,
  publishDistributionRecordNow,
  saveDistributionRecord,
  scheduleDistributionRecord,
  type EffectiveStageEntry,
} from "@/lib/api";
import { ROUTES } from "@/lib/constants";
import { isPassedThrough } from "@/lib/pipeline";
import type { DistributionPublishPayload, DistributionPublishSettings, DistributionRecordRow, PublishStatus } from "@/types/phase";
import { PassedThroughDrawer } from "./PassedThroughDrawer";

const STATUS_STYLE: Record<PublishStatus, string> = {
  ready: "border-teal/20 bg-teal/10 text-teal",
  scheduled: "border-warn/20 bg-warn/10 text-warn",
  publishing: "border-warn/20 bg-warn/10 text-warn",
  published: "border-teal/20 bg-teal/10 text-teal",
  failed: "border-neg/20 bg-neg/10 text-neg",
  cancelled: "border-line bg-ink text-paper-3",
};

const ACTIVE_STATUSES: PublishStatus[] = ["ready", "scheduled", "publishing", "failed"];

const DEFAULT_CHECKLIST = [
  "Caption reviewed for accuracy and approved claims only",
  "No unapproved testimonials, metrics, or guarantees",
  "Media matches the approved asset group",
  "Destination account is the correct client profile",
];

function errorText(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as { message?: string; code?: string; details?: string; hint?: string };
    return [value.message, value.code && `Code: ${value.code}`, value.details, value.hint].filter(Boolean).join(" · ");
  }
  return error instanceof Error ? error.message : String(error);
}

function statusDate(record: DistributionRecordRow): string {
  if (record.published_at) return `published ${new Date(record.published_at).toLocaleString()}`;
  if (record.scheduled_publish_at) return `scheduled ${new Date(record.scheduled_publish_at).toLocaleString()}`;
  if (record.planned_publish_date) return `planned ${record.planned_publish_date}`;
  return "no date set";
}

interface EditorState {
  caption: string; hashtags: string; destination: string; platform: string;
  contentType: string; aspectRatio: string; proofRestrictions: string; igUserId: string;
  checklist: boolean[];
}

function seedEditor(record: DistributionRecordRow): EditorState {
  const payload = record.publish_payload as Partial<DistributionPublishPayload>;
  const settings = record.publish_settings as Partial<DistributionPublishSettings>;
  const meta = (settings.meta ?? {}) as Record<string, unknown>;
  return {
    caption: payload.caption ?? "",
    hashtags: (payload.hashtags ?? []).join(", "),
    destination: record.destination ?? settings.destination ?? "",
    platform: settings.platform ?? record.platform ?? "instagram",
    contentType: settings.content_type ?? "IMAGE",
    aspectRatio: settings.aspect_ratio ?? "4:5",
    proofRestrictions: settings.proof_restrictions ?? "",
    igUserId: typeof meta.ig_user_id === "string" ? meta.ig_user_id : "",
    checklist: [],
  };
}

function PublishRecordModal({ record, onClose, onUpdated }: {
  record: DistributionRecordRow;
  onClose: () => void;
  onUpdated: (next: DistributionRecordRow) => void;
}) {
  const settings = record.publish_settings as Partial<DistributionPublishSettings>;
  const payload = record.publish_payload as Partial<DistributionPublishPayload>;
  const checklistItems = settings.safety_checklist?.length ? settings.safety_checklist : DEFAULT_CHECKLIST;
  const media = payload.media ?? [];

  const [step, setStep] = useState<"mode" | "publish_now" | "schedule">("mode");
  const [editor, setEditor] = useState<EditorState>(() => ({ ...seedEditor(record), checklist: checklistItems.map(() => false) }));
  const [date, setDate] = useState(record.planned_publish_date ?? "");
  const [time, setTime] = useState("09:00");
  const [tz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);

  const checklistComplete = editor.checklist.every(Boolean);

  function buildPayload(): Record<string, unknown> {
    const next: DistributionPublishPayload = {
      caption: editor.caption,
      hashtags: editor.hashtags.split(",").map((value) => value.trim()).filter(Boolean),
      media: media as DistributionPublishPayload["media"],
      source_ref: record.source_ref, asset_group_ref: record.asset_group_ref, asset_format: record.asset_format,
    };
    return next as unknown as Record<string, unknown>;
  }
  function buildSettings(): Record<string, unknown> {
    const next: DistributionPublishSettings = {
      platform: editor.platform, destination: editor.destination.trim() || null,
      content_type: editor.contentType, aspect_ratio: editor.aspectRatio,
      proof_restrictions: editor.proofRestrictions.trim() || null,
      safety_checklist: checklistItems,
      meta: editor.igUserId.trim() ? { ig_user_id: editor.igUserId.trim() } : {},
    };
    return next as unknown as Record<string, unknown>;
  }

  async function publishNow() {
    if (!checklistComplete) return;
    if (!window.confirm(`Publish ${record.source_ref} to ${editor.platform} now? This attempts a real publish via Meta.`)) return;
    setBusy("publish"); setNotice(null); setMissing(null);
    try {
      // Persist edits first so nothing is lost regardless of the publish outcome.
      const saved = await saveDistributionRecord(record.id, { publishPayload: buildPayload(), publishSettings: buildSettings(), destination: editor.destination.trim() || null });
      onUpdated(saved);
      const result = await publishDistributionRecordNow(record.id);
      if (result.ok && result.record) {
        onUpdated(result.record as unknown as DistributionRecordRow);
        setNotice({ error: false, message: result.message ?? "Published." });
      } else if (result.missing_config?.length) {
        setMissing(result.missing_config);
        setNotice({ error: true, message: "Meta is not configured — nothing was published. Configure the items below, then retry." });
      } else {
        setNotice({ error: true, message: result.message ?? result.error ?? "Publish did not succeed. Record was not marked published." });
      }
    } catch (error) { setNotice({ error: true, message: errorText(error) }); }
    finally { setBusy(null); }
  }

  async function schedule() {
    if (!checklistComplete) return;
    if (!date || !time) { setNotice({ error: true, message: "Choose a publish date and time." }); return; }
    const scheduledAt = new Date(`${date}T${time}`);
    if (Number.isNaN(scheduledAt.getTime())) { setNotice({ error: true, message: "Invalid date/time." }); return; }
    setBusy("schedule"); setNotice(null);
    try {
      const settingsWithTz = { ...buildSettings(), meta: { ...(buildSettings().meta as Record<string, unknown>), timezone: tz } };
      const saved = await scheduleDistributionRecord(record.id, {
        scheduledPublishAt: scheduledAt.toISOString(), publishPayload: buildPayload(), publishSettings: settingsWithTz, destination: editor.destination.trim() || null,
      });
      onUpdated(saved);
      setNotice({ error: false, message: `Scheduled for ${scheduledAt.toLocaleString()} (${tz}). The scheduled worker publishes it when due — nothing is published now.` });
    } catch (error) { setNotice({ error: true, message: errorText(error) }); }
    finally { setBusy(null); }
  }

  const field = "rounded border border-line bg-ink px-2.5 py-2 text-xs text-paper outline-none focus:border-teal/50";
  const editorForm = (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-2xs uppercase text-paper-3">Caption / copy</span><textarea className={`${field} min-h-28`} value={editor.caption} onChange={(event) => setEditor((current) => ({ ...current, caption: event.target.value }))} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Platform</span><select className={field} value={editor.platform} onChange={(event) => setEditor((current) => ({ ...current, platform: event.target.value }))}><option value="instagram">instagram</option></select></label>
      <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Destination / IG account handle</span><input className={field} placeholder="@client_handle" value={editor.destination} onChange={(event) => setEditor((current) => ({ ...current, destination: event.target.value }))} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Content type</span><input className={field} value={editor.contentType} onChange={(event) => setEditor((current) => ({ ...current, contentType: event.target.value }))} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Aspect ratio</span><input className={field} value={editor.aspectRatio} onChange={(event) => setEditor((current) => ({ ...current, aspectRatio: event.target.value }))} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Hashtags (comma separated)</span><input className={field} value={editor.hashtags} onChange={(event) => setEditor((current) => ({ ...current, hashtags: event.target.value }))} /></label>
      <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Meta IG business account id</span><input className={field} placeholder="numeric ig_user_id" value={editor.igUserId} onChange={(event) => setEditor((current) => ({ ...current, igUserId: event.target.value }))} /></label>
      <label className="flex flex-col gap-1 sm:col-span-2"><span className="text-2xs uppercase text-paper-3">Proof / claim restrictions</span><textarea className={`${field} min-h-16`} value={editor.proofRestrictions} onChange={(event) => setEditor((current) => ({ ...current, proofRestrictions: event.target.value }))} /></label>
      <div className="sm:col-span-2">
        <div className="text-2xs uppercase text-paper-3">Media ({media.length} file{media.length === 1 ? "" : "s"}) · from client-assets (not editable)</div>
        <ul className="mt-1 space-y-1">{media.map((item, index) => <li key={index} className="break-all font-mono text-2xs text-paper-3">{item.storage_bucket}/{item.storage_path} · {item.width}×{item.height}</li>)}</ul>
      </div>
      <div className="sm:col-span-2 rounded-lg border border-line bg-ink p-3">
        <div className="text-2xs uppercase text-paper-3">Safety checklist — all required</div>
        <ul className="mt-2 space-y-1.5">{checklistItems.map((item, index) => <li key={index}><label className="flex items-start gap-2 text-xs text-paper-2"><input type="checkbox" className="mt-0.5 accent-teal" checked={editor.checklist[index] ?? false} onChange={(event) => setEditor((current) => { const checklist = [...current.checklist]; checklist[index] = event.target.checked; return { ...current, checklist }; })} />{item}</label></li>)}</ul>
      </div>
      <div className="sm:col-span-2 text-2xs text-paper-3">Published URL: <span className="font-mono">{record.published_url ?? "— (set automatically on successful publish)"}</span></div>
    </div>
  );

  return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 sm:items-center" onClick={onClose}>
    <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[16px] border border-line bg-ink-200 sm:rounded-[16px]" onClick={(event) => event.stopPropagation()}>
      <header className="shrink-0 border-b border-line px-5 py-4"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-2xs text-teal">{record.source_ref}</span><span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${STATUS_STYLE[record.publish_status]}`}>{record.publish_status}</span><span className="rounded border border-line px-1.5 py-0.5 text-2xs text-paper-3">{record.asset_format.replaceAll("_", " ")}</span></div><h2 className="mt-1 text-base font-medium text-paper">Publish Record</h2></div><button onClick={onClose} className="text-paper-3 hover:text-paper">✕</button></div></header>
      {notice && <div role={notice.error ? "alert" : "status"} className={`shrink-0 border-b px-5 py-2 text-xs ${notice.error ? "border-neg/20 bg-neg/5 text-neg" : "border-teal/20 bg-teal/5 text-teal"}`}>{notice.message}</div>}
      {missing && <div className="shrink-0 border-b border-warn/20 bg-warn/5 px-5 py-2 text-xs text-warn"><div className="font-medium">Missing Meta configuration:</div><ul className="mt-1 list-disc pl-5">{missing.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        {step === "mode" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="rounded-xl border border-teal/30 bg-teal/5 p-5 text-left hover:bg-teal/10" onClick={() => setStep("publish_now")}><div className="text-sm font-medium text-paper">Publish Now</div><div className="mt-2 text-xs leading-5 text-paper-3">Review the payload and attempt a real Meta publish immediately.</div></button>
            <button className="rounded-xl border border-teal/30 bg-teal/5 p-5 text-left hover:bg-teal/10" onClick={() => setStep("schedule")}><div className="text-sm font-medium text-paper">Schedule</div><div className="mt-2 text-xs leading-5 text-paper-3">Set a date/time; the shared worker publishes it when due. Nothing publishes now.</div></button>
          </div>
        ) : step === "publish_now" ? (
          <div className="space-y-4"><Button size="sm" variant="ghost" onClick={() => setStep("mode")}>← Choose method</Button>{editorForm}</div>
        ) : (
          <div className="space-y-4"><Button size="sm" variant="ghost" onClick={() => setStep("mode")}>← Choose method</Button>{editorForm}
            <div className="grid gap-3 rounded-lg border border-line bg-ink p-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Publish date</span><input type="date" className={field} value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Publish time</span><input type="time" className={field} value={time} onChange={(event) => setTime(event.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Timezone</span><input className={field} value={tz} readOnly /></label>
            </div>
          </div>
        )}
      </main>
      {step === "publish_now" && <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3"><span className="text-2xs text-paper-3">{checklistComplete ? "Real publish — never faked. Missing config fails safely." : "Complete the safety checklist to enable publishing."}</span><Button size="sm" variant="primary" className="ml-auto" disabled={!checklistComplete || busy !== null} onClick={() => void publishNow()}>{busy === "publish" ? "Publishing…" : "Publish"}</Button></footer>}
      {step === "schedule" && <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3"><span className="text-2xs text-paper-3">{checklistComplete ? "Saved as scheduled — not published now." : "Complete the safety checklist to enable scheduling."}</span><Button size="sm" variant="primary" className="ml-auto" disabled={!checklistComplete || busy !== null} onClick={() => void schedule()}>{busy === "schedule" ? "Scheduling…" : "Schedule Post"}</Button></footer>}
    </div>
  </div>;
}

/**
 * H3 Distribution: approved assets land here as distribution records. Operators
 * open Publish Record to Publish Now (real Meta attempt, safe on missing config)
 * or Schedule (worker publishes when due). Nothing is published or faked here.
 */
export function DistributionPanel({ clientId, executionMonth, onViewAssets }: { clientId: string; executionMonth: string; onViewAssets?: () => void }) {
  const navigate = useNavigate();
  const [records, setRecords] = useState<DistributionRecordRow[]>([]);
  const [stageMap, setStageMap] = useState<Map<string, EffectiveStageEntry>>(new Map());
  const [open, setOpen] = useState<DistributionRecordRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextRecords, stages] = await Promise.all([fetchDistributionRecords(clientId, executionMonth), fetchEffectiveStageMap(clientId, executionMonth)]);
      setRecords(nextRecords); setStageMap(stages);
    } catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => { void load(); }; window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);

  const active = useMemo(() => records.filter((record) => ACTIVE_STATUSES.includes(record.publish_status)), [records]);
  const publishedCount = records.filter((record) => record.publish_status === "published").length;
  const passedThroughEntries = useMemo(() => [...stageMap.values()].filter((entry) => isPassedThrough(entry.stage, "distribution")), [stageMap]);
  function accept(next: DistributionRecordRow) { setRecords((current) => current.map((record) => record.id === next.id ? next : record)); setOpen((current) => current && current.id === next.id ? next : current); window.dispatchEvent(new Event("aa:reload")); }

  async function cancel(record: DistributionRecordRow) {
    if (!window.confirm(`Cancel distribution for ${record.source_ref}? It will no longer be publishable until re-approved.`)) return;
    try { accept(await cancelDistributionRecord(record.id)); } catch (value) { setError(errorText(value)); }
  }

  if (loading && !records.length) return <div className="p-6 text-xs text-paper-3">Loading distribution queue…</div>;
  return <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="text-paper">{active.length} active</span>
        <span className="text-teal">{publishedCount} published</span>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={loading} onClick={() => void load()}>{loading ? "Reloading…" : "Reload"}</Button>
        <Button size="sm" variant="ghost" disabled={!passedThroughEntries.length} onClick={() => setDrawerOpen(true)}>Archived / Passed Through{passedThroughEntries.length ? ` (${passedThroughEntries.length})` : ""}</Button>
      </div>
      <p className="mt-2 text-2xs text-paper-3">Approved assets arrive as distribution-ready. Publish Now attempts a real Meta publish (safe if credentials are missing). Schedule stores a record the shared worker publishes when due — no publishing happens on this screen.</p>
    </div>
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {!active.length ? (
      <div className="rounded-[10px] border border-dashed border-line p-10 text-center">
        <div className="text-sm text-paper">Nothing is waiting for distribution.</div>
        <div className="mt-2 text-xs text-paper-3">Approve an asset group in the Assets tab to make it distribution-ready.</div>
      </div>
    ) : (
      <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">
        {active.map((record) => (
          <article key={record.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <span className="w-28 shrink-0 font-mono text-2xs text-teal">{record.source_ref}</span>
            <div className="min-w-[240px] flex-1">
              <div className="break-words text-xs text-paper">{record.title ?? record.source_ref}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-paper-3">
                <span>{record.asset_format.replaceAll("_", " ")}</span>
                <span>{record.platform ?? "instagram"}</span>
                {record.destination && <span>→ {record.destination}</span>}
                {record.publish_mode && <span>{record.publish_mode.replaceAll("_", " ")}</span>}
                <span>{statusDate(record)}</span>
                {record.published_url && <a href={record.published_url} target="_blank" rel="noreferrer" className="text-teal hover:underline">post ↗</a>}
              </div>
              {record.last_error && <div className="mt-1 text-2xs text-neg">{record.last_error}</div>}
            </div>
            <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${STATUS_STYLE[record.publish_status]}`}>{record.publish_status}</span>
            {onViewAssets && <Button size="sm" variant="ghost" onClick={onViewAssets}>Asset</Button>}
            {record.publish_status !== "cancelled" && <Button size="sm" variant="ghost" onClick={() => void cancel(record)}>Cancel</Button>}
            <Button size="sm" variant="primary" disabled={record.publish_status === "publishing"} onClick={() => setOpen(record)}>Publish Record</Button>
          </article>
        ))}
      </div>
    )}
    {open && <PublishRecordModal record={open} onClose={() => setOpen(null)} onUpdated={accept} />}
    {drawerOpen && <PassedThroughDrawer tabStage="distribution" entries={passedThroughEntries} onClose={() => setDrawerOpen(false)} onViewFullArchive={(sourceRef) => navigate(`${ROUTES.clientSection(clientId, "archive")}?source_ref=${encodeURIComponent(sourceRef)}`)} />}
  </div>;
}
