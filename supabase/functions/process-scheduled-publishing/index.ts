// Phase H3 — scheduled publishing worker. ONE worker for ALL clients/assets
// (never one cron per asset). It scans for due scheduled records and runs the
// SAME shared publisher used by the manual "Publish Now" path.
//
// Deployment (H4): deploy with verify_jwt=false, set CRON_SECRET, and add ONE
// pg_cron job that calls this function on an interval, e.g.:
//
//   select cron.schedule(
//     'process-scheduled-publishing', '*/5 * * * *',
//     $$ select net.http_post(
//          url    := '<SUPABASE_URL>/functions/v1/process-scheduled-publishing',
//          headers:= jsonb_build_object('x-cron-secret', '<CRON_SECRET>'),
//          body   := '{}'::jsonb
//        ); $$);
//
// It is intentionally left UNDEPLOYED and UNSCHEDULED in H3 — no scheduled
// execution is faked.
import { svc, json, cors } from "../_shared/aa.ts";
import { earlierFramesAllPublished, publishDistributionRecord } from "../_shared/instagram-publish.ts";

const FUNCTION_NAME = "process-scheduled-publishing";
const BATCH_LIMIT = 25;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // Guard: require the configured cron secret. If unset, refuse — this endpoint
  // must never be publicly triggerable without an explicit secret.
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ ok: false, function: FUNCTION_NAME, error: "CRON_SECRET is not configured; worker is disabled." }, 503);
  if (req.headers.get("x-cron-secret") !== expected) return json({ ok: false, function: FUNCTION_NAME, error: "Unauthorized." }, 401);

  const sb = svc();
  const nowIso = new Date().toISOString();
  // Process due records grouped so that Story frames of the same asset group are
  // handled lowest sequence_index first.
  const { data: due, error } = await sb.from("client_distribution_records")
    .select("id, client_id, asset_group_ref, sequence_index")
    .eq("publish_status", "scheduled")
    .lte("scheduled_publish_at", nowIso)
    .order("asset_group_ref", { ascending: true })
    .order("sequence_index", { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) return json({ ok: false, function: FUNCTION_NAME, error: error.message }, 500);

  const results: Array<{ id: string; ok: boolean; status: string | null; message?: string }> = [];
  for (const row of due ?? []) {
    const id = row.id as string;
    const seq = (row.sequence_index as number | null) ?? 1;
    // Sequence gate: never publish a later Story frame while an earlier frame in
    // the same asset group is still unpublished. Preserves in-order Stories.
    if (seq > 1) {
      const { data: earlier } = await sb.from("client_distribution_records")
        .select("publish_status")
        .eq("client_id", row.client_id as string)
        .eq("asset_group_ref", row.asset_group_ref as string)
        .lt("sequence_index", seq);
      const statuses = (earlier ?? []).map((e) => e.publish_status as string);
      if (!earlierFramesAllPublished(statuses)) {
        results.push({ id, ok: false, status: "scheduled", message: `Frame ${seq} held: earlier frames not yet published.` });
        continue;
      }
    }
    const outcome = await publishDistributionRecord(sb, id, "scheduled_worker");
    results.push({ id, ok: outcome.ok, status: outcome.status, message: outcome.message });
  }
  return json({ ok: true, function: FUNCTION_NAME, scanned_at: nowIso, processed: results.length, results });
});
