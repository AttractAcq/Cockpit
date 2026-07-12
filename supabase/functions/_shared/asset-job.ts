// Persisted asset-generation job worker.
//
// The 546 fix lives here: instead of generating an N-image carousel/story in one
// long invocation, each slide/frame is produced in its own short call. This
// module owns "process exactly ONE queued item, then update progress; finalize
// the job only when every item is complete." It is invoked by both the UI-driven
// single-slide function and the cron safety-net processor.
//
// Resource safety (Part E):
//   • exactly one image is generated per call — never an array of buffers;
//   • the image bytes are uploaded immediately and go out of scope right after;
//   • no Promise.all / unbounded concurrency — items are strictly one at a time;
//   • the per-item prompt is precomputed at job start, so the full brief is NOT
//     re-parsed on every slide;
//   • external calls (OpenAI, storage) carry structured timeouts;
//   • logs never include prompt/image/token data.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  BUCKET, FORMAT_CONFIG, INPUT_MIME, generateImage, type SupportedAssetFormat,
} from "./ai-asset-generation.ts";

export interface JobRow {
  id: string;
  client_id: string;
  production_brief_id: string;
  source_ref: string;
  asset_group_ref: string;
  asset_format: SupportedAssetFormat;
  expected_output_count: number;
  completed_output_count: number;
  status: "queued" | "processing" | "partial" | "complete" | "failed" | "cancelled";
  visual_mode: string | null;
  generation_config: Record<string, unknown>;
  last_error: string | null;
}

export interface ItemRow {
  id: string;
  generation_job_id: string;
  sequence_index: number;
  status: "queued" | "processing" | "complete" | "failed";
  prompt_md: string;
  storage_path: string | null;
  client_asset_id: string | null;
  attempt_count: number;
}

export interface ProcessResult {
  job: JobRow;
  expected: number;
  completed: number;
  /** true once the job reached a terminal state (complete/partial/failed/cancelled). */
  terminal: boolean;
  /** true when this call actually generated one item. */
  itemProcessed: boolean;
  /** set when nothing could be claimed because other workers hold the remaining items. */
  inProgress: boolean;
  sequenceProcessed: number | null;
  lastError: string | null;
}

const TERMINAL = new Set(["complete", "partial", "failed", "cancelled"]);

async function loadJob(sb: SupabaseClient, jobId: string): Promise<JobRow> {
  const { data, error } = await sb.from("client_asset_generation_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Could not load generation job: ${error.message}`);
  if (!data) throw new Error("Generation job not found.");
  return data as JobRow;
}

async function itemStatusCounts(sb: SupabaseClient, jobId: string): Promise<Record<ItemRow["status"], number>> {
  const { data, error } = await sb.from("client_asset_generation_items").select("status").eq("generation_job_id", jobId);
  if (error) throw new Error(`Could not read item statuses: ${error.message}`);
  const counts: Record<ItemRow["status"], number> = { queued: 0, processing: 0, complete: 0, failed: 0 };
  for (const row of (data ?? []) as { status: ItemRow["status"] }[]) counts[row.status] += 1;
  return counts;
}

function result(job: JobRow, completed: number, extra: Partial<ProcessResult> = {}): ProcessResult {
  return {
    job, expected: job.expected_output_count, completed,
    terminal: TERMINAL.has(job.status), itemProcessed: false, inProgress: false,
    sequenceProcessed: null, lastError: job.last_error, ...extra,
  };
}

// Validate the group and, if whole, mark the job complete + the brief produced.
// Never marks the brief produced on an incomplete group.
async function finalizeIfComplete(sb: SupabaseClient, job: JobRow): Promise<JobRow> {
  const { data: items, error } = await sb.from("client_asset_generation_items")
    .select("sequence_index, status, storage_path").eq("generation_job_id", job.id).order("sequence_index");
  if (error) throw new Error(`Could not verify job items: ${error.message}`);
  const rows = (items ?? []) as { sequence_index: number; status: string; storage_path: string | null }[];
  const complete = rows.filter((r) => r.status === "complete" && r.storage_path);
  const expected = job.expected_output_count;

  const contiguous = complete.length === expected
    && complete.every((r, i) => r.sequence_index === i + 1);
  if (complete.length < expected || !contiguous) {
    return job; // not whole yet — leave as-is (caller decides partial/failed)
  }

  const completedAt = new Date().toISOString();
  const { data: updated, error: jobErr } = await sb.from("client_asset_generation_jobs")
    .update({ status: "complete", completed_output_count: expected, last_error: null, updated_at: completedAt })
    .eq("id", job.id).neq("status", "complete").select("*").maybeSingle();
  const finalJob = (updated as JobRow | null) ?? { ...job, status: "complete", completed_output_count: expected };
  if (jobErr) throw new Error(`Could not finalize job: ${jobErr.message}`);

  const { error: briefErr } = await sb.from("client_production_briefs")
    .update({ production_mode: "ai", production_status: "produced", updated_at: completedAt })
    .eq("id", job.production_brief_id);
  if (briefErr) throw new Error(`Could not mark the production brief produced: ${briefErr.message}`);

  // Archive earlier generated groups for this brief (keep only the finished one).
  const { error: archiveErr } = await sb.from("client_assets")
    .update({ status: "archived", updated_at: completedAt })
    .eq("production_brief_id", job.production_brief_id)
    .neq("asset_group_ref", job.asset_group_ref)
    .neq("status", "archived");
  if (archiveErr) throw new Error(`Could not archive the previous asset group: ${archiveErr.message}`);

  await sb.from("activity_log").insert({
    client_id: job.client_id,
    event_type: "production_assets_generated_ai",
    plain_english_message: `${job.source_ref} generated ${expected} AI image asset${expected === 1 ? "" : "s"}.`,
    object_type: "client_production_brief",
    object_id: job.production_brief_id,
    metadata: { source_ref: job.source_ref, asset_format: job.asset_format, asset_group_ref: job.asset_group_ref, asset_count: expected, via: "asset_generation_job" },
  }).select("id").maybeSingle();
  return finalJob;
}

// A terminally failed/partial job must not leave the brief wedged at 'producing'
// (the original 546 bricking). Mark it 'failed' so the operator can retry.
async function markBriefFailed(sb: SupabaseClient, briefId: string): Promise<void> {
  // PostgREST returns errors in the result rather than throwing; a failed status
  // sync here is non-fatal (the job row is the source of truth either way).
  await sb.from("client_production_briefs")
    .update({ production_status: "failed", updated_at: new Date().toISOString() })
    .eq("id", briefId)
    .eq("production_status", "producing");
}

// Download the operator's uploaded visual once (per slide invocation) for upload
// visual modes. Released as soon as the image is generated.
async function loadImageInput(sb: SupabaseClient, config: Record<string, unknown>): Promise<{ bytes: Uint8Array; mime: string } | undefined> {
  const mode = config.visual_mode;
  if (mode !== "uploaded_background" && mode !== "uploaded_insert") return undefined;
  const path = typeof config.uploaded_image_path === "string" ? config.uploaded_image_path : "";
  if (!path) throw new Error(`${mode} requires an uploaded image, but none is stored on the job.`);
  const { data: blob, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !blob) throw new Error(`Could not read the uploaded image at ${path}: ${error?.message ?? "not found"}.`);
  const declared = typeof config.uploaded_image_mime_type === "string" ? config.uploaded_image_mime_type : "";
  const mime = INPUT_MIME.has(declared) ? declared : (INPUT_MIME.has(blob.type) ? blob.type : "image/png");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime };
}

/**
 * Requeue every failed item of a job (operator "retry failed slides"). Resets a
 * terminal partial/failed job back to 'processing' and clears the brief's failed
 * flag so the driver can finish it. No-op on a complete job.
 */
export async function retryFailedItems(sb: SupabaseClient, jobId: string): Promise<JobRow> {
  const job = await loadJob(sb, jobId);
  if (job.status === "complete" || job.status === "cancelled") return job;
  await sb.from("client_asset_generation_items")
    .update({ status: "queued", last_error: null, updated_at: new Date().toISOString() })
    .eq("generation_job_id", jobId).eq("status", "failed");
  const { data: updated } = await sb.from("client_asset_generation_jobs")
    .update({ status: "processing", last_error: null, updated_at: new Date().toISOString() })
    .eq("id", jobId).select("*").maybeSingle();
  await sb.from("client_production_briefs")
    .update({ production_status: "producing", updated_at: new Date().toISOString() })
    .eq("id", job.production_brief_id).eq("production_status", "failed");
  return (updated as JobRow | null) ?? { ...job, status: "processing" };
}

/**
 * Claim and process exactly ONE queued item of a job. Returns progress. When the
 * last item completes, finalizes the job + brief. On item failure, records the
 * error and leaves the job non-produced (partial/failed) — never bricked mid-flight.
 */
export async function processNextItem(sb: SupabaseClient, jobId: string): Promise<ProcessResult> {
  let job = await loadJob(sb, jobId);
  if (TERMINAL.has(job.status)) return result(job, job.completed_output_count, { terminal: true });

  if (job.status === "queued") {
    await sb.from("client_asset_generation_jobs").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", job.id);
    job = { ...job, status: "processing" };
  }

  // Atomically claim the next queued item (FOR UPDATE SKIP LOCKED inside the RPC).
  const { data: claimed, error: claimErr } = await sb.rpc("claim_next_asset_generation_item", { p_job_id: job.id });
  if (claimErr) throw new Error(`Could not claim a slide: ${claimErr.message}`);
  const item = (Array.isArray(claimed) ? claimed[0] : claimed) as ItemRow | undefined;

  if (!item) {
    // Nothing to claim — decide the job's resting state from item counts.
    const counts = await itemStatusCounts(sb, job.id);
    if (counts.complete >= job.expected_output_count) {
      const finalJob = await finalizeIfComplete(sb, job);
      return result(finalJob, finalJob.completed_output_count, { terminal: TERMINAL.has(finalJob.status) });
    }
    if (counts.processing > 0) {
      return result(job, counts.complete, { inProgress: true }); // another worker holds it
    }
    // No queued, none processing, not all complete → remaining items failed.
    const status = counts.complete > 0 ? "partial" : "failed";
    const { data: updated } = await sb.from("client_asset_generation_jobs")
      .update({ status, completed_output_count: counts.complete, updated_at: new Date().toISOString() })
      .eq("id", job.id).select("*").maybeSingle();
    const finalJob = (updated as JobRow | null) ?? { ...job, status };
    await markBriefFailed(sb, job.production_brief_id);
    return result(finalJob, counts.complete, { terminal: true });
  }

  const config = FORMAT_CONFIG[job.asset_format];
  const cfg = job.generation_config;
  const str = (key: string): string | null => (typeof cfg[key] === "string" ? cfg[key] as string : null);
  const storagePrefix = str("storage_prefix") ?? job.client_id;
  const briefTitle = str("brief_title") ?? job.source_ref;
  const storagePath = `${storagePrefix}/${job.asset_group_ref}/${String(item.sequence_index).padStart(2, "0")}.png`;
  let uploaded = false;
  try {
    const imageInput = await loadImageInput(sb, cfg);
    // ── single image; bytes released after upload ──
    const generated = await generateImage(item.prompt_md, config, imageInput);
    const { error: uploadError } = await sb.storage.from(BUCKET).upload(storagePath, generated.bytes, { contentType: "image/png", upsert: true });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);
    uploaded = true;

    const { data: asset, error: assetError } = await sb.from("client_assets").insert({
      client_id: job.client_id,
      production_brief_id: job.production_brief_id,
      source_ref: job.source_ref,
      asset_format: job.asset_format,
      asset_group_ref: job.asset_group_ref,
      sequence_index: item.sequence_index,
      title: job.expected_output_count === 1 ? briefTitle : `${briefTitle} — ${job.asset_format === "carousel" ? "Slide" : "Frame"} ${item.sequence_index}`,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      mime_type: "image/png",
      width: config.width,
      height: config.height,
      status: "needs_review",
      generation_provider: "openai",
      generation_model: generated.model,
      prompt_md: item.prompt_md,
      metadata: {
        aspect_ratio: config.aspectRatio, sequence_count: job.expected_output_count, quality: generated.quality,
        function: "generate-carousel-slide", generation_job_id: job.id,
        visual_mode: str("visual_mode") ?? "text_only",
        uploaded_image_path: str("uploaded_image_path"),
        uploaded_image_filename: str("uploaded_image_filename"),
        visual_instructions: str("visual_instructions"),
        background_strength: str("visual_mode") === "generated_background" ? (str("background_strength") ?? "subtle") : null,
        image_input_used: generated.imageInputUsed,
        expected_output_count: job.expected_output_count,
        actual_output_count: job.expected_output_count,
      },
    }).select("id").single();
    if (assetError || !asset) throw new Error(`Asset row insert failed: ${assetError?.message ?? "no row returned"}`);

    await sb.from("client_asset_generation_items")
      .update({ status: "complete", storage_path: storagePath, client_asset_id: asset.id, last_error: null, updated_at: new Date().toISOString() })
      .eq("id", item.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (uploaded) await sb.storage.from(BUCKET).remove([storagePath]).catch(() => {}); // avoid orphaned object
    await sb.from("client_asset_generation_items")
      .update({ status: "failed", last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", item.id);
    const counts = await itemStatusCounts(sb, job.id);
    // One failed slide must NOT abandon the others: if slides are still queued,
    // keep the job 'processing' and record the error — the driver moves on to the
    // next slide (the failed one is retried only on an explicit operator request).
    if (counts.queued > 0) {
      const { data: updated } = await sb.from("client_asset_generation_jobs")
        .update({ last_error: message.slice(0, 500), completed_output_count: counts.complete, updated_at: new Date().toISOString() })
        .eq("id", job.id).select("*").maybeSingle();
      const stillJob = (updated as JobRow | null) ?? { ...job, last_error: message };
      return result(stillJob, counts.complete, { sequenceProcessed: item.sequence_index, lastError: message });
    }
    // Queue drained with a failure present → job is terminal (partial/failed).
    const status = counts.complete > 0 ? "partial" : "failed";
    const { data: updated } = await sb.from("client_asset_generation_jobs")
      .update({ status, completed_output_count: counts.complete, last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("id", job.id).select("*").maybeSingle();
    const finalJob = (updated as JobRow | null) ?? { ...job, status };
    await markBriefFailed(sb, job.production_brief_id);
    return result(finalJob, counts.complete, { terminal: true, sequenceProcessed: item.sequence_index, lastError: message });
  }

  // Recompute progress and finalize if whole.
  const counts = await itemStatusCounts(sb, job.id);
  await sb.from("client_asset_generation_jobs").update({ completed_output_count: counts.complete, updated_at: new Date().toISOString() }).eq("id", job.id);
  let finalJob: JobRow = { ...job, completed_output_count: counts.complete };
  if (counts.complete >= job.expected_output_count) finalJob = await finalizeIfComplete(sb, finalJob);
  return result(finalJob, counts.complete, {
    terminal: TERMINAL.has(finalJob.status), itemProcessed: true, sequenceProcessed: item.sequence_index,
  });
}
