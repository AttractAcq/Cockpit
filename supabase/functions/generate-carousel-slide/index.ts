// Single-slide worker. Processes EXACTLY ONE queued item of a generation job:
// one image-generation call, one upload, one client_assets row, then marks the
// item complete and recomputes job progress (finalizing the job + brief when the
// last slide lands). One image per invocation keeps every call far under the edge
// wall-clock cap — this is the core of the 546 fix.
//
// The UI (or the cron safety net) calls this repeatedly until the job is terminal.
import { svc, json, cors } from "../_shared/aa.ts";
import { STAFF_ROLES } from "../_shared/ai-asset-generation.ts";
import { processNextItem, retryFailedItems } from "../_shared/asset-job.ts";

const FUNCTION_NAME = "generate-carousel-slide";

function failure(status: number, stage: string, error: string, details?: unknown): Response {
  return json({ ok: false, function: FUNCTION_NAME, stage, error, details, message: `${FUNCTION_NAME} failed at ${stage}: ${error}` }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return failure(405, "request", "POST only");
  const sb = svc();
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return failure(401, "authorization", "Not authenticated.");
    const { data: operator, error: operatorError } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (operatorError) return failure(500, "authorization", "Could not load operator role.", operatorError.message);
    if (!operator || !STAFF_ROLES.has(operator.role)) return failure(403, "authorization", "Admin, account manager, or editor access is required.");

    const body = await req.json() as { generation_job_id?: string; retry_failed?: boolean };
    const jobId = body.generation_job_id?.trim() ?? "";
    if (!jobId) return failure(400, "request", "generation_job_id is required.");
    if (!(Deno.env.get("OPENAI_API_KEY") ?? "").trim()) return failure(503, "configuration", "AI image production is not configured. OPENAI_API_KEY is required.");

    // Structured log — ids only, never prompt/image/token data.
    console.log(JSON.stringify({ fn: FUNCTION_NAME, event: "process_start", job_id: jobId, retry: !!body.retry_failed }));
    if (body.retry_failed) await retryFailedItems(sb, jobId);
    const outcome = await processNextItem(sb, jobId);
    console.log(JSON.stringify({
      fn: FUNCTION_NAME, event: "process_done", job_id: jobId, status: outcome.job.status,
      completed: outcome.completed, expected: outcome.expected, item_processed: outcome.itemProcessed,
      sequence: outcome.sequenceProcessed, terminal: outcome.terminal, had_error: !!outcome.lastError,
    }));

    return json({
      ok: true, function: FUNCTION_NAME,
      job: outcome.job, status: outcome.job.status,
      completed_output_count: outcome.completed, expected_output_count: outcome.expected,
      item_processed: outcome.itemProcessed, sequence_processed: outcome.sequenceProcessed,
      terminal: outcome.terminal, in_progress: outcome.inProgress, last_error: outcome.lastError,
      asset_group_ref: outcome.job.asset_group_ref,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("timed out") ? 504 : message.includes("OpenAI Images") ? 502 : 500;
    return failure(status, "process_slide", message);
  }
});
