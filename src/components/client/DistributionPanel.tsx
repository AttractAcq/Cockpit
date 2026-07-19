import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/primitives";
import {
  cancelDistributionRecord,
  fetchDistributionRecords,
  fetchEffectiveStageMap,
  fetchLifecycleDateContext,
  fetchPublishAttempts,
  publishDistributionRecordNow,
  reconcileDistributionRecord,
  retryDistributionRecord,
  saveDistributionRecord,
  scheduleDistributionRecord,
  signDistributionMedia,
  type EffectiveStageEntry,
  type ReconcileResolution,
} from "@/lib/api";
import { ROUTES } from "@/lib/constants";
import { isPassedThrough } from "@/lib/pipeline";
import { zonedWallClockToUtcIso } from "@/lib/schedule-time";
import { groupLifecycleRecordsByDate, resolveCanonicalPublishDate, resolveLifecycleContentType, type DateDirection, type LifecycleDateContext } from "@/lib/lifecycle-date";
import { useFocusedRecord } from "@/lib/use-focused-record";
import { errorCategory, hasExternalEvidence, normalizeDestinationDisplay, STATUS_GUIDANCE, validateStoryRecord } from "@/lib/distribution-operator";
import type { DistributionPublishPayload, DistributionPublishSettings, DistributionRecordRow, PublishAttemptRow, PublishStatus } from "@/types/phase";
import { PassedThroughDrawer } from "./PassedThroughDrawer";
import { LifecycleDateSection, LifecycleDirectionToggle } from "@/components/shared/LifecycleDateSection";

const STATUS_STYLE: Record<PublishStatus, string> = {
  ready: "border-teal/20 bg-teal/10 text-teal",
  scheduled: "border-warn/20 bg-warn/10 text-warn",
  publishing: "border-warn/20 bg-warn/10 text-warn",
  published: "border-teal/20 bg-teal/10 text-teal",
  failed: "border-neg/20 bg-neg/10 text-neg",
  cancelled: "border-line bg-ink text-paper-3",
  needs_reconciliation: "border-neg/40 bg-neg/15 text-neg",
};

const ACTIVE_STATUSES: PublishStatus[] = ["ready", "scheduled", "publishing", "failed", "needs_reconciliation"];

/** Common IANA zones for the scheduler selector; the operator's browser zone is added on top. */
const COMMON_TIMEZONES = [
  "Europe/London", "Europe/Rome", "Europe/Paris", "Europe/Madrid", "Europe/Berlin",
  "Africa/Johannesburg", "America/New_York", "America/Los_Angeles", "Asia/Dubai", "UTC",
];


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

function recordTimezone(record: DistributionRecordRow): string | null {
  const settings = record.publish_settings as Partial<DistributionPublishSettings>;
  const meta = settings.meta && typeof settings.meta === "object" ? settings.meta as Record<string, unknown> : {};
  return typeof meta.timezone === "string" ? meta.timezone : null;
}

function scheduledLocal(record: DistributionRecordRow): string | null {
  if (!record.scheduled_publish_at) return null;
  const timezone = recordTimezone(record);
  if (!timezone) return new Date(record.scheduled_publish_at).toLocaleString();
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(record.scheduled_publish_at)); }
  catch { return new Date(record.scheduled_publish_at).toLocaleString(); }
}

/** "Frame X of N" for a Story-sequence frame record; null for single records. */
function frameLabel(record: DistributionRecordRow): string | null {
  return record.sequence_count && record.sequence_count > 1 ? `Frame ${record.sequence_index} of ${record.sequence_count}` : null;
}

function mediaIsVideo(media: Array<{ mime_type?: string }>): boolean {
  return media.some((item) => (item.mime_type ?? "").toLowerCase().startsWith("video/"));
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
  const storyValidation = validateStoryRecord(record);
  const frame = frameLabel(record);

  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const first = media[0];
    if (!first) { setPreview(null); return; }
    void signDistributionMedia(first.storage_bucket, first.storage_path).then((url) => { if (active) setPreview(url); });
    return () => { active = false; };
  }, [record.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [step, setStep] = useState<"mode" | "publish_now" | "schedule">("mode");
  const [editor, setEditor] = useState<EditorState>(() => ({ ...seedEditor(record), checklist: checklistItems.map(() => false) }));
  const [date, setDate] = useState(record.planned_publish_date ?? "");
  const [time, setTime] = useState("09:00");
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [tz, setTz] = useState(browserTz);
  const tzOptions = useMemo(() => Array.from(new Set([browserTz, ...COMMON_TIMEZONES])), [browserTz]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);

  const checklistComplete = editor.checklist.every(Boolean);
  const isStory = storyValidation.isStory || editor.contentType.trim().toUpperCase() === "STORIES";
  const invalidStory = isStory && media.length !== 1;
  const storyGuardMessage = invalidStory ? `Stories must be published one frame per record. This record contains ${media.length} media items, so it cannot be published or scheduled as a Story.` : null;
  const videoStory = isStory && mediaIsVideo(media);

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
    const existingMeta = settings.meta && typeof settings.meta === "object" ? settings.meta as Record<string, unknown> : {};
    const next: DistributionPublishSettings = {
      platform: editor.platform, destination: editor.destination.trim() || null,
      content_type: editor.contentType, aspect_ratio: editor.aspectRatio,
      proof_restrictions: editor.proofRestrictions.trim() || null,
      safety_checklist: checklistItems,
      meta: { ...existingMeta, ...(editor.igUserId.trim() ? { ig_user_id: editor.igUserId.trim() } : {}) },
    };
    return next as unknown as Record<string, unknown>;
  }

  async function publishNow() {
    if (!checklistComplete) return;
    if (invalidStory) { setNotice({ error: true, message: storyGuardMessage! }); return; }
    if (videoStory) { setNotice({ error: true, message: "Video Story publishing is not yet supported." }); return; }
    if (!window.confirm(`Publish ${record.source_ref}${frame ? ` (${frame})` : ""} to ${editor.platform} now? This attempts a real publish via Meta.`)) return;
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
    if (invalidStory) { setNotice({ error: true, message: storyGuardMessage! }); return; }
    if (!date || !time) { setNotice({ error: true, message: "Choose a publish date and time." }); return; }
    let scheduledIso: string;
    try { scheduledIso = zonedWallClockToUtcIso(date, time, tz); }
    catch { setNotice({ error: true, message: "Invalid date/time." }); return; }
    if (Number.isNaN(new Date(scheduledIso).getTime())) { setNotice({ error: true, message: "Invalid date/time." }); return; }
    setBusy("schedule"); setNotice(null);
    try {
      // Persist the chosen IANA zone so the schedule is unambiguous (not browser-local).
      const settingsWithTz = { ...buildSettings(), meta: { ...(buildSettings().meta as Record<string, unknown>), timezone: tz } };
      const saved = await scheduleDistributionRecord(record.id, {
        scheduledPublishAt: scheduledIso, timezone: tz, plannedPublishDate: date || null,
        publishPayload: buildPayload(), publishSettings: settingsWithTz, destination: editor.destination.trim() || null,
      });
      onUpdated(saved);
      setNotice({ error: false, message: `Scheduled for ${date} ${time} (${tz}) → ${new Date(scheduledIso).toLocaleString()} local. The worker publishes it when due — nothing is published now.` });
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
        <div className="flex items-center gap-2 text-2xs uppercase text-paper-3">Media ({media.length} file{media.length === 1 ? "" : "s"}) · from client-assets (not editable){frame && <span className="rounded border border-teal/30 bg-teal/5 px-1.5 py-0.5 normal-case text-teal">{frame}</span>}{isStory && <span className="rounded border border-line px-1.5 py-0.5 normal-case text-paper-3">Story</span>}</div>
        <div className="mt-2 flex gap-3">
          <div className={`w-24 shrink-0 overflow-hidden rounded border border-line bg-black/20 ${isStory ? "aspect-[9/16]" : "aspect-[4/5]"}`}>{preview ? <img src={preview} alt={`${record.source_ref} preview`} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center p-1 text-center text-2xs text-paper-3">no preview</div>}</div>
          <ul className="min-w-0 flex-1 space-y-1">{media.map((item, index) => <li key={index} className="break-all font-mono text-2xs text-paper-3">{item.storage_bucket}/{item.storage_path} · {item.width}×{item.height} · {item.mime_type}</li>)}</ul>
        </div>
        {isStory && <div className="mt-2 rounded border border-warn/20 bg-warn/5 px-2.5 py-1.5 text-2xs text-warn">Story caption is planning-only — Meta does not render this caption on an image Story. One frame publishes per record; multi-frame Stories are separate records published in sequence order.</div>}
      </div>
      <div className="sm:col-span-2 rounded-lg border border-line bg-ink p-3">
        <div className="text-2xs uppercase text-paper-3">Safety checklist — all required</div>
        <ul className="mt-2 space-y-1.5">{checklistItems.map((item, index) => <li key={index}><label className="flex items-start gap-2 text-xs text-paper-2"><input type="checkbox" className="mt-0.5 accent-teal" checked={editor.checklist[index] ?? false} onChange={(event) => setEditor((current) => { const checklist = [...current.checklist]; checklist[index] = event.target.checked; return { ...current, checklist }; })} />{item}</label></li>)}</ul>
      </div>
      {invalidStory && <div role="alert" className="sm:col-span-2 rounded-lg border border-neg/40 bg-neg/10 p-3 text-xs text-neg"><div className="font-medium">Invalid Story record · {media.length} media items · Expected exactly 1</div><div className="mt-1">{storyGuardMessage}</div></div>}
      {isStory && !invalidStory && <div className="sm:col-span-2 flex flex-wrap gap-2 rounded-lg border border-teal/20 bg-teal/5 p-3 text-2xs text-teal"><span>Story frame</span><span>sequence {record.sequence_index}</span>{record.sequence_count && <span>of {record.sequence_count}</span>}<span>One-image Story record</span></div>}
      <div className="sm:col-span-2 grid gap-1 rounded-lg border border-line bg-ink p-2.5 text-2xs text-paper-3">
        <div>External post id: <span className="font-mono text-paper">{record.external_post_id ?? "— (set on successful publish)"}</span></div>
        <div>Published URL: <span className="font-mono">{record.published_url ? record.published_url : record.published_at ? (isStory ? "— (Stories have no stable public permalink)" : "— (none returned)") : "— (set automatically on successful publish)"}</span></div>
      </div>
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
            <button disabled={invalidStory || record.permanent_failure} className="rounded-xl border border-teal/30 bg-teal/5 p-5 text-left hover:bg-teal/10 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setStep("publish_now")}><div className="text-sm font-medium text-paper">Publish Now</div><div className="mt-2 text-xs leading-5 text-paper-3">{record.permanent_failure ? "Fix the underlying issue, then use Schedule again. Permanent failures cannot be retried here." : "Review the payload and attempt a real Meta publish immediately."}</div></button>
            <button disabled={invalidStory} className="rounded-xl border border-teal/30 bg-teal/5 p-5 text-left hover:bg-teal/10 disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setStep("schedule")}><div className="text-sm font-medium text-paper">{record.permanent_failure ? "Schedule again" : "Schedule"}</div><div className="mt-2 text-xs leading-5 text-paper-3">Set a date/time; the shared worker publishes it when due. Nothing publishes now.</div></button>
            {invalidStory && <div className="sm:col-span-2 rounded border border-neg/40 bg-neg/10 p-3 text-xs text-neg">{storyGuardMessage}</div>}
          </div>
        ) : step === "publish_now" ? (
          <div className="space-y-4"><Button size="sm" variant="ghost" onClick={() => setStep("mode")}>← Choose method</Button>{editorForm}</div>
        ) : (
          <div className="space-y-4"><Button size="sm" variant="ghost" onClick={() => setStep("mode")}>← Choose method</Button>{editorForm}
            <div className="grid gap-3 rounded-lg border border-line bg-ink p-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Publish date</span><input type="date" className={field} value={date} onChange={(event) => setDate(event.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Publish time</span><input type="time" className={field} value={time} onChange={(event) => setTime(event.target.value)} /></label>
              <label className="flex flex-col gap-1"><span className="text-2xs uppercase text-paper-3">Timezone</span><select className={field} value={tz} onChange={(event) => setTz(event.target.value)}>{tzOptions.map((zone) => <option key={zone} value={zone}>{zone}{zone === browserTz ? " (your browser)" : ""}</option>)}</select></label>
            </div>
            {date && time && <p className="text-2xs text-paper-3">Publishes at <span className="font-mono text-paper">{date} {time}</span> in <span className="font-mono text-paper">{tz}</span>. Stored as UTC; the worker publishes at that instant regardless of daylight-saving shifts.</p>}
          </div>
        )}
      </main>
      {step === "publish_now" && <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3"><span className={`text-2xs ${videoStory || invalidStory ? "text-neg" : "text-paper-3"}`}>{invalidStory ? storyGuardMessage : videoStory ? "Video Story publishing is not yet supported" : checklistComplete ? (isStory ? "Publishes this one Story frame. Real publish — never faked." : "Real publish — never faked. Missing config fails safely.") : "Complete the safety checklist to enable publishing."}</span><Button size="sm" variant="primary" className="ml-auto" disabled={!checklistComplete || busy !== null || videoStory || invalidStory} title={invalidStory ? storyGuardMessage ?? undefined : videoStory ? "Video Story publishing is not yet supported" : undefined} onClick={() => void publishNow()}>{busy === "publish" ? "Publishing…" : isStory ? "Publish Story" : "Publish"}</Button></footer>}
      {step === "schedule" && <footer className="flex shrink-0 items-center gap-2 border-t border-line px-5 py-3"><span className={`text-2xs ${invalidStory ? "text-neg" : "text-paper-3"}`}>{invalidStory ? storyGuardMessage : checklistComplete ? "Saved as scheduled — not published now." : "Complete the safety checklist to enable scheduling."}</span><Button size="sm" variant="primary" className="ml-auto" disabled={!checklistComplete || busy !== null || invalidStory} onClick={() => void schedule()}>{busy === "schedule" ? "Scheduling…" : record.permanent_failure ? "Schedule Again" : "Schedule Post"}</Button></footer>}
    </div>
  </div>;
}

function AttemptHistoryDrawer({ record, onClose }: { record: DistributionRecordRow; onClose: () => void }) {
  const [attempts, setAttempts] = useState<PublishAttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    fetchPublishAttempts(record.id)
      .then((rows) => { if (active) setAttempts(rows); })
      .catch((value) => { if (active) setError(errorText(value)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [record.id]);

  return <div className="fixed inset-0 z-[65] flex justify-end bg-black/70" onClick={onClose}>
    <aside className="flex h-full w-full max-w-xl flex-col border-l border-line bg-ink-200" onClick={(event) => event.stopPropagation()}>
      <header className="flex items-start gap-3 border-b border-line px-5 py-4"><div className="min-w-0 flex-1"><div className="font-mono text-2xs text-teal">{record.source_ref}</div><h2 className="mt-1 text-base font-medium text-paper">Publish attempt history</h2><div className="mt-1 text-2xs text-paper-3">External evidence: {hasExternalEvidence(record) ? "yes" : "no"}{record.published_url && <> · <a className="text-teal hover:underline" href={record.published_url} target="_blank" rel="noreferrer">published URL ↗</a></>}</div></div><button onClick={onClose} className="text-paper-3 hover:text-paper">✕</button></header>
      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading && <div className="py-8 text-center text-xs text-paper-3">Loading publish attempts…</div>}
        {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 p-3 text-xs text-neg">{error}</div>}
        {!loading && !error && !attempts.length && <div className="rounded border border-dashed border-line p-8 text-center text-xs text-paper-3">No publish attempts recorded.</div>}
        <div className="space-y-3">{attempts.map((attempt) => {
          const permanent = attempt.permanent_failure ?? attempt.result === "permanent_failure";
          return <article key={attempt.id} className="rounded-lg border border-line bg-ink p-3">
            <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-paper">Attempt {attempt.attempt_number}</span><span className={`rounded border px-1.5 py-0.5 text-2xs ${permanent ? "border-neg/40 bg-neg/10 text-neg" : attempt.retryable === true ? "border-warn/30 bg-warn/5 text-warn" : "border-line text-paper-3"}`}>{attempt.result.replaceAll("_", " ")}</span>{permanent && <span className="rounded border border-neg/40 bg-neg/10 px-1.5 py-0.5 text-2xs text-neg">Permanent failure</span>}</div>
            <dl className="mt-3 grid gap-2 text-2xs text-paper-3 sm:grid-cols-2"><div><dt>Started</dt><dd className="text-paper-2">{new Date(attempt.started_at ?? attempt.created_at).toLocaleString()}</dd></div><div><dt>Finished</dt><dd className="text-paper-2">{attempt.completed_at ? new Date(attempt.completed_at).toLocaleString() : "—"}</dd></div><div><dt>Worker</dt><dd className="break-all font-mono text-paper-2">{attempt.claimed_by ?? attempt.worker_invocation_id ?? "—"}</dd></div><div><dt>Category</dt><dd className="text-paper-2">{attempt.category ?? "—"}</dd></div><div><dt>Retryability</dt><dd className="text-paper-2">{permanent ? "non-retryable / permanent" : attempt.retryable === null ? "not recorded" : attempt.retryable ? "retryable" : "non-retryable"}</dd></div><div><dt>External post ID</dt><dd className="break-all font-mono text-paper-2">{attempt.external_post_id ?? "—"}</dd></div>{attempt.published_url && <div className="sm:col-span-2"><dt>Published URL</dt><dd><a className="break-all text-teal hover:underline" href={attempt.published_url} target="_blank" rel="noreferrer">{attempt.published_url}</a></dd></div>}</dl>
            {attempt.message && <div className="mt-3 rounded border border-line bg-ink-200 p-2 text-xs text-paper-2">{attempt.message}</div>}
          </article>;
        })}</div>
      </main>
    </aside>
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
  const [attemptRecord, setAttemptRecord] = useState<DistributionRecordRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateDirection, setDateDirection] = useState<DateDirection>("asc");
  const [lifecycleContext, setLifecycleContext] = useState<LifecycleDateContext>({});

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [nextRecords, stages, dateContext] = await Promise.all([fetchDistributionRecords(clientId, executionMonth), fetchEffectiveStageMap(clientId, executionMonth), fetchLifecycleDateContext(clientId, executionMonth)]);
      setRecords(nextRecords); setStageMap(stages); setLifecycleContext(dateContext);
    } catch (value) { setError(errorText(value)); }
    finally { setLoading(false); }
  }, [clientId, executionMonth]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const reload = () => { void load(); }; window.addEventListener("aa:reload", reload); return () => window.removeEventListener("aa:reload", reload); }, [load]);

  const active = useMemo(() => records.filter((record) => ACTIVE_STATUSES.includes(record.publish_status)), [records]);
  const groupedByDate = useMemo(() => groupLifecycleRecordsByDate(active, { lifecycleStage: "distribution", context: lifecycleContext, direction: dateDirection }), [active, dateDirection, lifecycleContext]);
  const publishedCount = records.filter((record) => record.publish_status === "published").length;
  const passedThroughEntries = useMemo(() => [...stageMap.values()].filter((entry) => isPassedThrough(entry.stage, "distribution")), [stageMap]);
  useFocusedRecord({
    queryKeys: ["distribution_id", "source_ref"],
    records,
    getMatchValue: useCallback((record: DistributionRecordRow, queryKey: string) => queryKey === "distribution_id" ? record.id : record.source_ref, []),
    onFound: useCallback((record: DistributionRecordRow) => setOpen(record), []),
  });
  function accept(next: DistributionRecordRow) { setRecords((current) => current.map((record) => record.id === next.id ? next : record)); setOpen((current) => current && current.id === next.id ? next : current); window.dispatchEvent(new Event("aa:reload")); }

  async function cancel(record: DistributionRecordRow) {
    if (!window.confirm(`Cancel distribution for ${record.source_ref}? It will no longer be publishable until re-approved.`)) return;
    try { accept(await cancelDistributionRecord(record.id)); } catch (value) { setError(errorText(value)); }
  }

  async function retry(record: DistributionRecordRow) {
    if (!window.confirm(`Re-queue ${record.source_ref} for the scheduled worker (fresh retry budget)? Nothing publishes now; the worker attempts it on its next run.`)) return;
    try { accept(await retryDistributionRecord(record.id)); } catch (value) { setError(errorText(value)); }
  }

  async function reconcile(record: DistributionRecordRow, resolution: ReconcileResolution) {
    if (resolution === "confirm_published") {
      const hasEvidence = !!(record.external_post_id || record.published_at || record.published_url);
      let externalId: string | null = null;
      if (!hasEvidence) {
        const entered = window.prompt(`Confirm ${record.source_ref} actually posted on Instagram.\nEnter the numeric Instagram media ID from the live post:`, "");
        if (entered === null) return;
        if (!/^\d+$/.test(entered.trim())) { setError("A numeric Instagram media ID is required to confirm a published post."); return; }
        externalId = entered.trim();
      } else if (!window.confirm(`Confirm ${record.source_ref} as published (evidence already on record)?`)) return;
      try { accept(await reconcileDistributionRecord(record.id, "confirm_published", externalId)); } catch (value) { setError(errorText(value)); }
      return;
    }
    const verb = resolution === "reset_scheduled" ? "re-queue for a fresh attempt — only if you verified it did NOT post" : "cancel this record";
    if (!window.confirm(`Reconcile ${record.source_ref}: ${verb}?`)) return;
    try { accept(await reconcileDistributionRecord(record.id, resolution)); } catch (value) { setError(errorText(value)); }
  }

  if (loading && !records.length) return <div className="p-6 text-xs text-paper-3">Loading distribution queue…</div>;
  // Layout: a fixed (shrink-0) header, then a dedicated scroll body
  // (min-h-0 flex-1 overflow-y-auto). The whole panel is a bounded flex column
  // under the app's h-dvh shell, so the body scrolls without any viewport-height
  // hack, and long lists + expanded record details are always reachable.
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="shrink-0 px-4 pt-4">
    <div className="rounded-[10px] border border-line bg-ink-200 px-4 py-3">
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="text-paper">{active.length} active</span>
        <span className="text-teal">{publishedCount} published</span>
        <Button size="sm" variant="ghost" className="ml-auto" disabled={loading} onClick={() => void load()}>{loading ? "Reloading…" : "Reload"}</Button>
        <Button size="sm" variant="ghost" disabled={!passedThroughEntries.length} onClick={() => setDrawerOpen(true)}>Archived / Passed Through{passedThroughEntries.length ? ` (${passedThroughEntries.length})` : ""}</Button>
      </div>
      <p className="mt-2 text-2xs text-paper-3">Approved assets arrive as distribution-ready. Publish Now attempts a real Meta publish (safe if credentials are missing). Schedule stores a record the shared worker publishes when due — no publishing happens on this screen.</p>
      <div className="mt-3"><LifecycleDirectionToggle value={dateDirection} onChange={setDateDirection} /></div>
    </div>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3">
    {error && <div role="alert" className="rounded border border-neg/20 bg-neg/5 px-3 py-2 text-xs text-neg">{error}</div>}
    {!active.length ? (
      <div className="rounded-[10px] border border-dashed border-line p-10 text-center">
        <div className="text-sm text-paper">Nothing is waiting for distribution.</div>
        <div className="mt-2 text-xs text-paper-3">Approve an asset group in the Assets tab to make it distribution-ready.</div>
      </div>
    ) : (
      <div className="flex flex-col gap-4">
        {groupedByDate.map((section) => <LifecycleDateSection key={section.key} group={section} statusSummary={`${section.records.filter((record) => record.publish_status === "scheduled").length} scheduled · ${section.records.filter((record) => record.publish_status === "failed").length} failed`}>
        <div className="overflow-hidden rounded-[10px] border border-line bg-ink-200">
        {section.records.map((record) => {
          const contentType = resolveLifecycleContentType(record);
          const lifecycleDate = resolveCanonicalPublishDate(record, "distribution", lifecycleContext).date;
          const story = validateStoryRecord(record);
          const evidence = hasExternalEvidence(record);
          const category = errorCategory(record.last_error);
          const timezone = recordTimezone(record);
          const igUserId = ((record.publish_settings as Partial<DistributionPublishSettings>).meta as Record<string, unknown> | undefined)?.ig_user_id;
          const canCancel = ["ready", "scheduled", "failed", "needs_reconciliation"].includes(record.publish_status);
          return (
          <article key={record.id} className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <span className="w-28 shrink-0 font-mono text-2xs text-teal">{record.source_ref}</span>
            <div className="min-w-[240px] flex-1">
              <div className="break-words text-xs text-paper">{record.title ?? record.source_ref}</div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-paper-3">
                <span>{contentType.label}</span>
                {frameLabel(record) && <span className="text-teal">{frameLabel(record)}</span>}
                {story.isStory && story.valid && <span className="text-teal">Story frame · One-image Story record</span>}
                {story.isStory && !story.valid && <span className="rounded border border-neg/40 bg-neg/10 px-1.5 py-0.5 text-neg">Invalid Story record · {story.mediaCount} media items · Expected exactly 1</span>}
                <span>{record.platform ?? "instagram"}</span>
                {record.destination && <span title={typeof igUserId === "string" ? `ig_user_id: ${igUserId}` : undefined}>→ {normalizeDestinationDisplay(record.destination)}</span>}
                {typeof igUserId === "string" && <span className="font-mono" title="Meta Instagram business account ID">ig_user_id {igUserId}</span>}
                {record.publish_mode && <span>{record.publish_mode.replaceAll("_", " ")}</span>}
                <span>planned {lifecycleDate ?? "date unavailable"}</span>
                <span>{statusDate(record)}</span>
                {record.publish_status === "scheduled" && record.scheduled_publish_at && <span>local {scheduledLocal(record)}{timezone ? ` (${timezone})` : ""}</span>}
                {record.publish_status === "scheduled" && record.scheduled_publish_at && <span className="font-mono">UTC {record.scheduled_publish_at}</span>}
                <span>attempts {record.attempt_count ?? 0}</span>
                {record.next_attempt_at && <span className="text-warn">next attempt {new Date(record.next_attempt_at).toLocaleString()}</span>}
                {record.published_url && <a href={record.published_url} target="_blank" rel="noreferrer" className="text-teal hover:underline">post ↗</a>}
              </div>
              <div className="mt-1 text-2xs text-paper-2">{STATUS_GUIDANCE[record.publish_status]}</div>
              {record.last_error && <div className="mt-1 text-2xs text-neg">{record.last_error}</div>}
              {record.permanent_failure && <div className="mt-2 rounded border border-neg/40 bg-neg/10 p-2 text-2xs text-neg"><div className="font-medium">Permanent failure</div><div className="mt-1">Error category: {category ?? "not recorded"} · External evidence: {evidence ? "yes" : "no"}</div><div className="mt-1">{evidence ? "External publication evidence exists. Do not retry. Use reconciliation review." : "This can be recovered by scheduling again after the underlying issue is fixed. Retry may be blocked for permanent failures unless override support is added."}</div></div>}
              {record.publish_status === "needs_reconciliation" && <div className="mt-1 text-2xs text-neg">External Instagram state is uncertain — verify on Instagram before resolving. Do not blind-retry.</div>}
            </div>
            <span className={`rounded border px-1.5 py-0.5 font-mono text-2xs ${STATUS_STYLE[record.publish_status]}`}>{record.publish_status}</span>
            {onViewAssets && <Button size="sm" variant="ghost" onClick={onViewAssets}>Asset</Button>}
            <Button size="sm" variant="ghost" onClick={() => setAttemptRecord(record)}>Attempts</Button>
            {record.publish_status === "failed" && !record.permanent_failure && <Button size="sm" variant="ghost" title="Retry is for non-permanent retryable failures" onClick={() => void retry(record)}>Retry retryable failure</Button>}
            {record.publish_status === "needs_reconciliation" && <>
              <Button size="sm" variant="ghost" title="Reconcile ambiguous external state" onClick={() => void reconcile(record, "confirm_published")}>Reconcile: it posted</Button>
              <Button size="sm" variant="ghost" title="Use only after confirming no external post exists" onClick={() => void reconcile(record, "reset_scheduled")}>Reconcile: no post</Button>
            </>}
            {canCancel && <Button size="sm" variant="ghost" title="Removes this item from active operation; historical evidence is retained" onClick={() => void cancel(record)}>Cancel operation</Button>}
            <Button size="sm" variant="primary" disabled={record.publish_status === "publishing" || record.publish_status === "needs_reconciliation" || record.publish_status === "cancelled" || !story.valid} title={!story.valid ? story.message ?? undefined : undefined} onClick={() => setOpen(record)}>{record.permanent_failure && !evidence ? "Schedule again" : "Publish Record"}</Button>
          </article>
          );
        })}
        </div>
        </LifecycleDateSection>)}
      </div>
    )}
    </div>
    {open && <PublishRecordModal record={open} onClose={() => setOpen(null)} onUpdated={accept} />}
    {attemptRecord && <AttemptHistoryDrawer record={attemptRecord} onClose={() => setAttemptRecord(null)} />}
    {drawerOpen && <PassedThroughDrawer tabStage="distribution" entries={passedThroughEntries} onClose={() => setDrawerOpen(false)} onViewFullArchive={(sourceRef) => navigate(`${ROUTES.clientSection(clientId, "archive")}?source_ref=${encodeURIComponent(sourceRef)}`)} />}
  </div>;
}
