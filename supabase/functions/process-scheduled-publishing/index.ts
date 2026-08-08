// P1 Scheduled Publishing worker. ONE worker for ALL clients/assets. Runs every
// minute (pg_cron + pg_net). Reliability contract:
//   • CRON_SECRET is required BEFORE any DB access (fail-safe 503 if unset).
//   • Stale 'publishing' claims are recovered first (evidence → published;
//     no-evidence → needs_reconciliation, never blind-retried).
//   • Due records are claimed ATOMICALLY (claim_due_distribution_records uses
//     FOR UPDATE SKIP LOCKED) so overlapping runs never double-publish.
//   • A per-run wall-clock budget keeps the worker well under the ~150s edge cap.
//   • Failures are classified: retryable → requeue with exponential backoff up to
//     MAX_ATTEMPTS; permanent → failed; unsupported formats are skipped, never
//     attempted. Every attempt is written to client_publish_attempts.
import { svc, json, cors } from "../_shared/aa.ts";
import { earlierFramesAllPublished, handoffToAnalytics, publishDistributionRecord, resolveMetaConfig, type DistributionRecord } from "../_shared/instagram-publish.ts";
import { resolvePublishCapability } from "../_shared/publish-capability.ts";
import {
  advanceReelPublication,
  liveReelPublishDeps,
  REEL_POLL_INTERVAL_MS,
  type ReelPublishRecord,
  type VideoContainerMediaType,
} from "../_shared/instagram-reels-publish.ts";
import { resolveReelPublicationEligibility, type FinalReelDeliverable } from "../_shared/final-reel-contract.ts";

const FUNCTION_NAME = "process-scheduled-publishing";
const MAX_PER_RUN = 3;                 // batch size (decision: 3)
const RUN_BUDGET_MS = 120_000;         // stop claiming near the 120s budget
const STALE_PUBLISHING = "5 minutes";  // recover claims stuck this long
const MAX_ATTEMPTS = 5;
// Exponential backoff (minutes) indexed by attempt number already made.
const BACKOFF_MINUTES = [2, 5, 15, 30, 60];

// Phase 2, Workstream E: supported combinations now come from the ONE shared
// capability resolver (_shared/publish-capability.ts) instead of two local sets,
// so the worker, the manual publish path, the SQL trigger and the UI cannot
// disagree about what is publishable.

function backoffMinutes(attemptsMade: number): number {
  return BACKOFF_MINUTES[Math.min(attemptsMade, BACKOFF_MINUTES.length - 1)];
}

interface ClaimedRecord {
  id: string; client_id: string; source_ref: string; asset_format: string;
  asset_group_ref: string; sequence_index: number | null; attempt_count: number;
  publish_settings: Record<string, unknown>;
  publish_payload?: Record<string, unknown> | null;
  platform?: string | null;
  // Phase 3 (Reels).
  video_project_id?: string | null;
  video_deliverable_id?: string | null;
  external_container_id?: string | null;
  container_status?: string | null;
  container_created_at?: string | null;
  container_poll_count?: number | null;
  external_post_id?: string | null;
  published_at?: string | null;
  published_url?: string | null;
  execution_month?: string;
  production_brief_id?: string | null;
  title?: string | null;
  destination?: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ ok: false, function: FUNCTION_NAME, error: "CRON_SECRET is not configured; worker is disabled." }, 503);
  if (req.headers.get("x-cron-secret") !== expected) return json({ ok: false, function: FUNCTION_NAME, error: "Unauthorized." }, 401);

  const sb = svc();
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  const results: Array<{ id: string; source_ref: string; disposition: string; message?: string }> = [];

  // 1) Recover stale 'publishing' claims BEFORE claiming new work.
  let recovered = { recovered_published: 0, flagged_reconcile: 0 };
  const { data: rec } = await sb.rpc("recover_stale_publishing", { p_older_than: STALE_PUBLISHING });
  if (Array.isArray(rec) && rec[0]) recovered = rec[0] as typeof recovered;

  // 1b) Resolve anything that became ineligible AFTER it was scheduled (e.g. a
  //     final Reel superseded by a new upload). These are skipped by the claim
  //     predicate, so without this sweep they would sit scheduled forever.
  const { data: blockedCount } = await sb.rpc("block_unsupported_scheduled_distribution");
  const blockedUnsupported = typeof blockedCount === "number" ? blockedCount : 0;

  // 2) Claim + process up to MAX_PER_RUN, one at a time, within the run budget.
  let processed = 0;
  while (processed < MAX_PER_RUN && Date.now() - startedAt < RUN_BUDGET_MS) {
    const { data: claimedRows, error: claimErr } = await sb.rpc("claim_due_distribution_records", { p_worker_id: runId, p_limit: 1 });
    if (claimErr) { results.push({ id: "-", source_ref: "-", disposition: "claim_error", message: claimErr.message }); break; }
    const claimed = (claimedRows ?? []) as ClaimedRecord[];
    if (claimed.length === 0) break; // nothing more due
    const record = claimed[0];
    processed += 1;
    const attemptNumber = record.attempt_count; // claim already incremented it
    const contentType = typeof record.publish_settings?.content_type === "string" ? record.publish_settings.content_type : null;

    const attemptBase = {
      distribution_record_id: record.id, client_id: record.client_id, source_ref: record.source_ref,
      asset_format: record.asset_format, attempt_number: attemptNumber, worker_invocation_id: runId,
      claimed_by: runId, started_at: new Date().toISOString(),
    };

    // Determined early: REELS and Story video take a different path below and
    // are deliberately EXCLUDED from the context-less guard immediately after
    // this — resolvePublishCapability fails an async-video record closed
    // whenever it is called without a proven reelContext (correctly: a
    // context-less call cannot tell a real deliverable from a bare shot
    // clip), and no reelContext is available yet at this point in the loop.
    // advanceReel performs its own complete, fully-informed eligibility check
    // (real deliverable + project, via resolveReelPublicationEligibility)
    // before ever calling Meta, so skipping the shallow guard here does not
    // weaken validation — it defers to the check that can actually decide.
    const isReel = contentType === "REELS" || record.asset_format === "reel_video";
    const isStoryVideo = contentType === "STORIES" && record.asset_format === "story_video";

    // Guard: never ATTEMPT an unsupported combination — mark it permanently
    // failed so the worker stops considering it. This is what prevents an
    // infinite retry loop on a record that can never publish.
    if (!isReel && !isStoryVideo) {
      const media = Array.isArray(record.publish_payload?.media)
        ? record.publish_payload!.media as Array<{ mime_type?: string | null }>
        : [];
      const capability = resolvePublishCapability({
        platform: typeof record.publish_settings?.platform === "string" ? record.publish_settings.platform : record.platform,
        assetFormat: record.asset_format,
        contentType,
        mediaMimeTypes: media.map((item) => item?.mime_type ?? null),
      });
      if (!capability.supported) {
        await sb.from("client_distribution_records").update({
          publish_status: "failed", permanent_failure: true, claimed_at: null, claimed_by: null, next_attempt_at: null,
          last_error: `[unsupported_capability, non-retryable] ${capability.reason}`, updated_at: new Date().toISOString(),
        }).eq("id", record.id);
        await sb.from("client_publish_attempts").insert({ ...attemptBase, completed_at: new Date().toISOString(), result: "skipped", retryable: false, category: "unsupported_capability", message: capability.reason });
        await sb.from("activity_log").insert({
          client_id: record.client_id, event_type: "publish_blocked_unsupported",
          plain_english_message: `${record.source_ref} was not published on schedule: ${capability.reason}`,
          metadata: { distribution_record_id: record.id, source_ref: record.source_ref, asset_format: record.asset_format, content_type: contentType, capability_code: capability.code, mode: "scheduled_worker" },
        }).then(() => {}, () => {});
        results.push({ id: record.id, source_ref: record.source_ref, disposition: "skipped_unsupported" });
        continue;
      }
    }

    // Defensive re-check of the Story sequence gate (claim RPC also enforces it).
    const seq = record.sequence_index ?? 1;
    if (seq > 1) {
      const { data: earlier } = await sb.from("client_distribution_records")
        .select("publish_status").eq("client_id", record.client_id).eq("asset_group_ref", record.asset_group_ref).lt("sequence_index", seq);
      if (!earlierFramesAllPublished((earlier ?? []).map((e) => e.publish_status as string))) {
        // Release back to scheduled — earlier frame not yet published.
        await sb.from("client_distribution_records").update({ publish_status: "scheduled", claimed_at: null, claimed_by: null, updated_at: new Date().toISOString() }).eq("id", record.id);
        await sb.from("client_publish_attempts").insert({ ...attemptBase, completed_at: new Date().toISOString(), result: "skipped", retryable: true, category: "sequence_gate", message: `Frame ${seq} held: earlier frames not yet published.` });
        results.push({ id: record.id, source_ref: record.source_ref, disposition: "held_sequence" });
        continue;
      }
    }

    // 3a) REELS and Story video both take the asynchronous container path:
    //     Meta transcodes the video, so one invocation cannot both create the
    //     container and publish it. Each worker run advances the state
    //     machine by exactly one step. A Story video is the same kind of
    //     publication as a Reel (single approved MP4 deliverable), differing
    //     only in the Graph API media_type sent at container-creation time.
    if (isReel || isStoryVideo) {
      const mediaType: VideoContainerMediaType = isStoryVideo ? "STORIES" : "REELS";
      try {
        const disposition = await advanceReel(sb, record, runId, attemptBase, attemptNumber, mediaType);
        results.push({ id: record.id, source_ref: record.source_ref, disposition });
      } catch (thrown) {
        const message = thrown instanceof Error ? thrown.message : String(thrown);
        await releaseReelForRetry(sb, record, attemptNumber, `Worker error: ${message}`, attemptBase, "worker_exception");
        results.push({ id: record.id, source_ref: record.source_ref, disposition: "reel_worker_error" });
      }
      continue;
    }

    // 3b) Everything else publishes through the shared synchronous path (record
    //     is already 'publishing'). Wrapped so ONE record's unexpected throw never
    //     aborts the whole batch.
    try {
      const outcome = await publishDistributionRecord(sb, record.id, "scheduled_worker");
      const completedAt = new Date().toISOString();

      if (outcome.ok) {
        await sb.from("client_publish_attempts").insert({ ...attemptBase, completed_at: completedAt, result: "published", retryable: false, external_post_id: (outcome.record?.external_post_id as string) ?? null, message: outcome.message });
        await sb.from("activity_log").insert({ client_id: record.client_id, event_type: "asset_published_scheduled", plain_english_message: `${record.source_ref} published on schedule.`, metadata: { distribution_record_id: record.id, external_post_id: outcome.record?.external_post_id ?? null, attempt_number: attemptNumber } });
        results.push({ id: record.id, source_ref: record.source_ref, disposition: "published" });
        continue;
      }

      // Failure disposition. publishDistributionRecord already set the record 'failed'.
      const retryable = outcome.retryable === true;
      const canRetry = retryable && attemptNumber < MAX_ATTEMPTS;
      if (canRetry) {
        const delayMin = backoffMinutes(attemptNumber);
        await sb.from("client_distribution_records").update({
          publish_status: "scheduled", claimed_at: null, claimed_by: null,
          next_attempt_at: new Date(Date.now() + delayMin * 60_000).toISOString(), updated_at: completedAt,
        }).eq("id", record.id);
        await sb.from("client_publish_attempts").insert({ ...attemptBase, completed_at: completedAt, result: "retryable_failure", retryable: true, category: outcome.category ?? null, message: `${outcome.message ?? outcome.error} — retry in ${delayMin}m` });
        results.push({ id: record.id, source_ref: record.source_ref, disposition: `retry_${delayMin}m` });
      } else {
        await sb.from("client_distribution_records").update({ publish_status: "failed", permanent_failure: true, claimed_at: null, claimed_by: null, updated_at: completedAt }).eq("id", record.id);
        await sb.from("client_publish_attempts").insert({ ...attemptBase, completed_at: completedAt, result: "permanent_failure", retryable: false, category: outcome.category ?? (outcome.missing_config ? "missing_config" : null), message: outcome.message ?? outcome.error });
        await sb.from("activity_log").insert({ client_id: record.client_id, event_type: "asset_publish_failed", plain_english_message: `${record.source_ref} failed to publish (${retryable ? "max retries reached" : "permanent"}).`, metadata: { distribution_record_id: record.id, category: outcome.category, attempt_number: attemptNumber } });
        results.push({ id: record.id, source_ref: record.source_ref, disposition: retryable ? "failed_max_attempts" : "failed_permanent" });
      }
    } catch (thrown) {
      // Unexpected throw (e.g. a post-publish DB write). If publication evidence
      // exists, the post is LIVE → finalize published, NEVER requeue. Otherwise
      // treat as a transient failure and requeue within the attempt budget.
      const completedAt = new Date().toISOString();
      const msg = thrown instanceof Error ? thrown.message : String(thrown);
      const { data: reloaded } = await sb.from("client_distribution_records").select("external_post_id, published_at, published_url").eq("id", record.id).maybeSingle();
      const hasEvidence = !!(reloaded && (reloaded.external_post_id || reloaded.published_at || reloaded.published_url));
      if (hasEvidence) {
        await sb.from("client_distribution_records").update({ publish_status: "published", published_at: (reloaded?.published_at as string) ?? completedAt, updated_at: completedAt }).eq("id", record.id);
        await sb.from("client_publish_attempts").insert({ ...attemptBase, completed_at: completedAt, result: "published", retryable: false, external_post_id: (reloaded?.external_post_id as string) ?? null, message: `Post is live; worker threw after publish: ${msg}` });
        await sb.from("activity_log").insert({ client_id: record.client_id, event_type: "publish_handoff_failed", plain_english_message: `${record.source_ref} is published but the worker threw after publishing — no republish.`, metadata: { distribution_record_id: record.id, external_post_id: reloaded?.external_post_id ?? null, source_ref: record.source_ref, failed_stage: "post_publish", error: msg, occurred_at: completedAt } });
        results.push({ id: record.id, source_ref: record.source_ref, disposition: "published_after_throw" });
      } else if (attemptNumber < MAX_ATTEMPTS) {
        const delayMin = backoffMinutes(attemptNumber);
        await sb.from("client_distribution_records").update({ publish_status: "scheduled", claimed_at: null, claimed_by: null, next_attempt_at: new Date(Date.now() + delayMin * 60_000).toISOString(), last_error: `Worker error: ${msg}`, updated_at: completedAt }).eq("id", record.id);
        await sb.from("client_publish_attempts").insert({ ...attemptBase, completed_at: completedAt, result: "retryable_failure", retryable: true, category: "worker_exception", message: `${msg} — retry in ${delayMin}m` });
        results.push({ id: record.id, source_ref: record.source_ref, disposition: `retry_after_throw_${delayMin}m` });
      } else {
        await sb.from("client_distribution_records").update({ publish_status: "failed", permanent_failure: true, claimed_at: null, claimed_by: null, last_error: `Worker error: ${msg}`, updated_at: completedAt }).eq("id", record.id);
        await sb.from("client_publish_attempts").insert({ ...attemptBase, completed_at: completedAt, result: "permanent_failure", retryable: false, category: "worker_exception", message: msg });
        results.push({ id: record.id, source_ref: record.source_ref, disposition: "failed_after_throw" });
      }
    }
  }

  return json({ ok: true, function: FUNCTION_NAME, run_id: runId, elapsed_ms: Date.now() - startedAt, recovered, blocked_unsupported: blockedUnsupported, processed, results });
});

// ── Phase 3: Instagram Reels state machine (one step per worker run) ─────────
//
// The record is only ever in `publishing` for the duration of ONE short step.
// Between steps it is released back to `scheduled` with a next_attempt_at, which
// is what makes the flow resumable, re-claimable by exactly one worker (the claim
// RPC uses FOR UPDATE SKIP LOCKED), and immune to the stale-publishing recovery
// sweep. Polling deliberately does NOT consume the publish-failure budget:
// `attempt_count` is restored and `container_poll_count` is the honest counter.

type AttemptBase = Record<string, unknown>;

/** Release a Reel back to `scheduled` for its next step. */
async function releaseReelForPolling(
  sb: ReturnType<typeof svc>,
  record: ClaimedRecord,
  attemptNumber: number,
  patch: Record<string, unknown>,
): Promise<void> {
  await sb.from("client_distribution_records").update({
    publish_status: "scheduled",
    claimed_at: null,
    claimed_by: null,
    // A status poll is not a publish attempt — restore the pre-claim value so the
    // MAX_ATTEMPTS budget keeps meaning "failed publish attempts".
    attempt_count: Math.max(attemptNumber - 1, 0),
    next_attempt_at: new Date(Date.now() + REEL_POLL_INTERVAL_MS).toISOString(),
    updated_at: new Date().toISOString(),
    ...patch,
  }).eq("id", record.id);
}

/** Transient failure: consume one attempt and back off, or fail permanently. */
async function releaseReelForRetry(
  sb: ReturnType<typeof svc>,
  record: ClaimedRecord,
  attemptNumber: number,
  message: string,
  attemptBase: AttemptBase,
  category: string,
): Promise<void> {
  const completedAt = new Date().toISOString();
  if (attemptNumber < MAX_ATTEMPTS) {
    const delayMin = backoffMinutes(attemptNumber);
    await sb.from("client_distribution_records").update({
      publish_status: "scheduled", claimed_at: null, claimed_by: null,
      next_attempt_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
      last_error: message, updated_at: completedAt,
    }).eq("id", record.id);
    await sb.from("client_publish_attempts").insert({
      ...attemptBase, completed_at: completedAt, result: "retryable_failure",
      retryable: true, category, message: `${message} — retry in ${delayMin}m`,
    });
    return;
  }
  await sb.from("client_distribution_records").update({
    publish_status: "failed", permanent_failure: true, claimed_at: null, claimed_by: null,
    next_attempt_at: null, last_error: message, updated_at: completedAt,
  }).eq("id", record.id);
  await sb.from("client_publish_attempts").insert({
    ...attemptBase, completed_at: completedAt, result: "permanent_failure",
    retryable: false, category, message,
  });
}

async function advanceReel(
  sb: ReturnType<typeof svc>,
  record: ClaimedRecord,
  runId: string,
  attemptBase: AttemptBase,
  attemptNumber: number,
  mediaType: VideoContainerMediaType = "REELS",
): Promise<string> {
  const completedAt = () => new Date().toISOString();

  // Re-prove eligibility every step. A final Reel superseded or un-approved after
  // scheduling must stop here, not reach Meta.
  const deliverableId = record.video_deliverable_id ?? null;
  if (!deliverableId) {
    await sb.from("client_distribution_records").update({
      publish_status: "failed", permanent_failure: true, claimed_at: null, claimed_by: null,
      last_error: "[blocked_shot_clip_not_publishable, non-retryable] Individual Reel Studio shot clips cannot be published.",
      updated_at: completedAt(),
    }).eq("id", record.id);
    await sb.from("client_publish_attempts").insert({
      ...attemptBase, completed_at: completedAt(), result: "skipped", retryable: false,
      category: "blocked_shot_clip_not_publishable", message: "No final Reel linked to this record.",
    });
    return "reel_blocked_no_deliverable";
  }

  const [deliverableResult, projectResult] = await Promise.all([
    sb.from("video_project_deliverables").select("*").eq("id", deliverableId).maybeSingle(),
    record.video_project_id
      ? sb.from("video_projects").select("id, client_id").eq("id", record.video_project_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const deliverable = (deliverableResult.data ?? null) as FinalReelDeliverable | null;
  const project = (projectResult.data ?? null) as { id: string; client_id: string } | null;

  const eligibility = resolveReelPublicationEligibility({
    deliverable, project, recordClientId: record.client_id,
  });
  if (!eligibility.supported) {
    await sb.from("client_distribution_records").update({
      publish_status: "failed", permanent_failure: true, claimed_at: null, claimed_by: null,
      next_attempt_at: null,
      last_error: `[${eligibility.code.toLowerCase()}, non-retryable] ${eligibility.reason}`,
      updated_at: completedAt(),
    }).eq("id", record.id);
    await sb.from("client_publish_attempts").insert({
      ...attemptBase, completed_at: completedAt(), result: "permanent_failure",
      retryable: false, category: eligibility.code.toLowerCase(), message: eligibility.reason,
    });
    await sb.from("activity_log").insert({
      client_id: record.client_id, event_type: "reel_publication_failed",
      plain_english_message: `${record.source_ref}: Reel publication stopped — ${eligibility.reason}`,
      metadata: {
        distribution_record_id: record.id, video_project_id: record.video_project_id ?? null,
        deliverable_id: deliverableId, code: eligibility.code, source_ref: record.source_ref,
      },
    }).then(() => {}, () => {});
    return "reel_blocked_ineligible";
  }

  // Credentials are resolved per step and never logged or returned.
  const { data: clientRow } = await sb.from("clients").select("slug").eq("id", record.client_id).maybeSingle();
  const config = await resolveMetaConfig(sb, clientRow?.slug ?? "", record as unknown as DistributionRecord);
  if (config.missing.length > 0) {
    await releaseReelForRetry(
      sb, record, attemptNumber,
      `Meta configuration missing: ${config.missing.join("; ")}`,
      attemptBase, "missing_config",
    );
    return "reel_missing_config";
  }

  const reelRecord: ReelPublishRecord = {
    id: record.id, client_id: record.client_id, source_ref: record.source_ref,
    asset_format: record.asset_format, publish_status: "publishing",
    external_container_id: record.external_container_id ?? null,
    container_status: record.container_status ?? null,
    container_created_at: record.container_created_at ?? null,
    container_poll_count: record.container_poll_count ?? 0,
    external_post_id: record.external_post_id ?? null,
    published_at: record.published_at ?? null,
    published_url: record.published_url ?? null,
    publish_payload: record.publish_payload ?? {},
    publish_settings: record.publish_settings ?? {},
    video_deliverable_id: deliverableId,
  };

  const disposition = await advanceReelPublication(liveReelPublishDeps(sb, record.id), {
    record: reelRecord,
    igUserId: config.igUserId!,
    token: config.token!,
    media: { storage_bucket: deliverable!.storage_bucket, storage_path: deliverable!.storage_path },
    mediaType,
  });

  switch (disposition.kind) {
    case "container_created": {
      await releaseReelForPolling(sb, record, attemptNumber, { container_poll_count: 0, last_error: null });
      await sb.from("client_publish_attempts").insert({
        ...attemptBase, completed_at: completedAt(), result: "started", retryable: true,
        category: "reel_container_created", container_ids: { reel: disposition.containerId },
        message: "Instagram media container created; awaiting processing.",
      });
      await sb.from("activity_log").insert({
        client_id: record.client_id, event_type: "reel_container_created",
        plain_english_message: `${record.source_ref}: Instagram media container created for the final Reel.`,
        metadata: {
          distribution_record_id: record.id, video_project_id: record.video_project_id ?? null,
          deliverable_id: deliverableId, container_id: disposition.containerId, source_ref: record.source_ref,
        },
      }).then(() => {}, () => {});
      return "reel_container_created";
    }
    case "container_processing": {
      await releaseReelForPolling(sb, record, attemptNumber, {
        container_status: "IN_PROGRESS",
        container_checked_at: completedAt(),
        container_poll_count: disposition.pollCount,
        last_error: null,
      });
      await sb.from("client_publish_attempts").insert({
        ...attemptBase, completed_at: completedAt(), result: "started", retryable: true,
        category: "reel_container_processing", container_ids: { reel: disposition.containerId },
        message: `Instagram is still processing this Reel (check ${disposition.pollCount}).`,
      });
      return `reel_processing_${disposition.pollCount}`;
    }
    case "already_published": {
      await sb.from("client_distribution_records").update({
        publish_status: "published", claimed_at: null, claimed_by: null, updated_at: completedAt(),
      }).eq("id", record.id);
      return "reel_already_published";
    }
    case "published": {
      // persistExternalPostId already committed the evidence. Finish the record.
      await sb.from("client_distribution_records").update({
        publish_status: "published", published_url: disposition.permalink,
        container_status: "PUBLISHED", container_checked_at: completedAt(),
        claimed_at: null, claimed_by: null, last_error: null, updated_at: completedAt(),
      }).eq("id", record.id);
      await sb.from("client_publish_attempts").insert({
        ...attemptBase, completed_at: completedAt(), result: "published", retryable: false,
        external_post_id: disposition.externalPostId, container_ids: { reel: disposition.containerId },
        message: "Reel published to Instagram.",
      });
      await sb.from("activity_log").insert({
        client_id: record.client_id, event_type: "reel_published",
        plain_english_message: `${record.source_ref}: final Reel published to Instagram.`,
        metadata: {
          distribution_record_id: record.id, video_project_id: record.video_project_id ?? null,
          deliverable_id: deliverableId, external_post_id: disposition.externalPostId,
          container_id: disposition.containerId, source_ref: record.source_ref,
        },
      }).then(() => {}, () => {});
      // Analytics/archive/pipeline handoff reuses the existing shared path and is
      // best-effort: its failure never un-publishes a live post.
      await handoffToAnalytics(
        sb,
        record as unknown as DistributionRecord,
        { external_post_id: disposition.externalPostId, permalink: disposition.permalink },
        completedAt(),
      ).catch(() => {});
      return "reel_published";
    }
    case "transient_failure": {
      await releaseReelForRetry(
        sb, record, attemptNumber,
        `[${disposition.classification.category}, retryable] ${disposition.classification.message}`,
        attemptBase, disposition.classification.category,
      );
      return "reel_retry";
    }
    case "permanent_failure": {
      await sb.from("client_distribution_records").update({
        publish_status: "failed", permanent_failure: true, claimed_at: null, claimed_by: null,
        next_attempt_at: null,
        last_error: `[${disposition.classification.category}, non-retryable] ${disposition.classification.message}`,
        container_checked_at: completedAt(), updated_at: completedAt(),
      }).eq("id", record.id);
      await sb.from("client_publish_attempts").insert({
        ...attemptBase, completed_at: completedAt(), result: "permanent_failure", retryable: false,
        category: disposition.classification.category,
        meta_error_code: disposition.classification.code ?? null,
        meta_error_subcode: disposition.classification.subcode ?? null,
        message: disposition.classification.message,
      });
      await sb.from("activity_log").insert({
        client_id: record.client_id, event_type: "reel_publication_failed",
        plain_english_message: `${record.source_ref}: Reel publication failed permanently (${disposition.classification.category}).`,
        metadata: {
          distribution_record_id: record.id, video_project_id: record.video_project_id ?? null,
          deliverable_id: deliverableId, category: disposition.classification.category,
          source_ref: record.source_ref,
        },
      }).then(() => {}, () => {});
      return "reel_failed_permanent";
    }
  }
}
