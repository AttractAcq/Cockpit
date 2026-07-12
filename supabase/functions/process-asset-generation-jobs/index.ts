// Cron safety-net worker for asset generation. ONE worker for ALL jobs (never
// one cron per slide). The UI drives generation slide-by-slide for responsiveness;
// this exists so a job still finishes if the operator navigates away or the driver
// dies. It advances a few slides per run under a strict time budget so the worker
// itself never trips the edge wall-clock cap (HTTP 546).
//
// Deployment: verify_jwt=false + CRON_SECRET, plus ONE pg_cron job, e.g.:
//   select cron.schedule(
//     'process-asset-generation-jobs', '* * * * *',
//     $$ select net.http_post(
//          url    := '<SUPABASE_URL>/functions/v1/process-asset-generation-jobs',
//          headers:= jsonb_build_object('x-cron-secret', '<CRON_SECRET>'),
//          body   := '{}'::jsonb
//        ); $$);
// Intentionally left UNSCHEDULED until enabled — no faked scheduled execution.
import { svc, json, cors } from "../_shared/aa.ts";
import { processNextItem, type JobRow } from "../_shared/asset-job.ts";

const FUNCTION_NAME = "process-asset-generation-jobs";
const JOB_SCAN_LIMIT = 10;
const MAX_ITEMS_PER_RUN = 3;      // never an unbounded fan-out
const TIME_BUDGET_MS = 110_000;   // stop well before the ~150s edge cap
const STALE_PROCESSING = "3 minutes"; // requeue items wedged by a killed worker

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ ok: false, function: FUNCTION_NAME, error: "CRON_SECRET is not configured; worker is disabled." }, 503);
  if (req.headers.get("x-cron-secret") !== expected) return json({ ok: false, function: FUNCTION_NAME, error: "Unauthorized." }, 401);
  if (!(Deno.env.get("OPENAI_API_KEY") ?? "").trim()) return json({ ok: false, function: FUNCTION_NAME, error: "OPENAI_API_KEY is not configured." }, 503);

  const sb = svc();
  const startedAt = Date.now();
  try {
    const { data: jobs, error } = await sb.from("client_asset_generation_jobs")
      .select("id")
      .in("status", ["queued", "processing"])
      .order("updated_at", { ascending: true })
      .limit(JOB_SCAN_LIMIT);
    if (error) return json({ ok: false, function: FUNCTION_NAME, error: error.message }, 500);

    const jobIds = (jobs ?? []).map((row) => row.id as string);
    let processed = 0;
    const summaries: Array<{ job_id: string; status: JobRow["status"]; completed: number; expected: number }> = [];

    for (const jobId of jobIds) {
      if (processed >= MAX_ITEMS_PER_RUN || Date.now() - startedAt > TIME_BUDGET_MS) break;
      // Requeue items a killed worker left wedged in 'processing'. PostgREST
      // returns any error in the result rather than throwing; a stale-requeue miss
      // is non-fatal, so we ignore it and proceed to claim the next item.
      await sb.rpc("requeue_stale_asset_generation_items", { p_job_id: jobId, p_older_than: STALE_PROCESSING });
      const outcome = await processNextItem(sb, jobId);
      if (outcome.itemProcessed) processed += 1;
      summaries.push({ job_id: jobId, status: outcome.job.status, completed: outcome.completed, expected: outcome.expected });
    }

    console.log(JSON.stringify({ fn: FUNCTION_NAME, event: "run_done", scanned: jobIds.length, items_processed: processed, elapsed_ms: Date.now() - startedAt }));
    return json({ ok: true, function: FUNCTION_NAME, scanned: jobIds.length, items_processed: processed, jobs: summaries });
  } catch (error) {
    return json({ ok: false, function: FUNCTION_NAME, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
