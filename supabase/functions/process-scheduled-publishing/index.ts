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
import { earlierFramesAllPublished, publishDistributionRecord } from "../_shared/instagram-publish.ts";

const FUNCTION_NAME = "process-scheduled-publishing";
const MAX_PER_RUN = 3;                 // batch size (decision: 3)
const RUN_BUDGET_MS = 120_000;         // stop claiming near the 120s budget
const STALE_PUBLISHING = "5 minutes";  // recover claims stuck this long
const MAX_ATTEMPTS = 5;
// Exponential backoff (minutes) indexed by attempt number already made.
const BACKOFF_MINUTES = [2, 5, 15, 30, 60];

const SUPPORTED_FORMATS = new Set(["feed_post", "carousel", "story_sequence", "ad_static"]);
const UNSUPPORTED_CONTENT_TYPES = new Set(["REELS"]);

function backoffMinutes(attemptsMade: number): number {
  return BACKOFF_MINUTES[Math.min(attemptsMade, BACKOFF_MINUTES.length - 1)];
}

interface ClaimedRecord {
  id: string; client_id: string; source_ref: string; asset_format: string;
  asset_group_ref: string; sequence_index: number | null; attempt_count: number;
  publish_settings: Record<string, unknown>;
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

    // Guard: never ATTEMPT an unsupported format — mark permanently failed.
    if (!SUPPORTED_FORMATS.has(record.asset_format) || (contentType && UNSUPPORTED_CONTENT_TYPES.has(contentType))) {
      await sb.from("client_distribution_records").update({
        publish_status: "failed", permanent_failure: true, claimed_at: null, claimed_by: null,
        last_error: `Unsupported format for scheduled publishing: ${record.asset_format}/${contentType ?? "?"}.`, updated_at: new Date().toISOString(),
      }).eq("id", record.id);
      await sb.from("client_publish_attempts").insert({ ...attemptBase, completed_at: new Date().toISOString(), result: "skipped", retryable: false, category: "unsupported_format", message: "Unsupported format; not attempted." });
      results.push({ id: record.id, source_ref: record.source_ref, disposition: "skipped_unsupported" });
      continue;
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

    // 3) Publish through the shared path (record is already 'publishing').
    //    Wrapped so ONE record's unexpected throw never aborts the whole batch.
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

  return json({ ok: true, function: FUNCTION_NAME, run_id: runId, elapsed_ms: Date.now() - startedAt, recovered, processed, results });
});
