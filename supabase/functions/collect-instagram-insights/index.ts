// collect-instagram-insights · verify_jwt=false at deployment.
// Protected by CRON_SECRET before service-role client creation or any DB access.
// Scheduling is managed separately through the database cron job.
import { json, cors, svc } from "../_shared/aa.ts";
import { resolveMetaConfig, type DistributionRecord } from "../_shared/instagram-publish.ts";
import { clampBatchSize, classifyInsightsError, insightsKind, isTerminallyExpiredStory, metricsForKind, nextDueSnapshot, normalizeMetaInsights, type InsightsErrorCategory } from "../_shared/instagram-insights.ts";

const FUNCTION_NAME = "collect-instagram-insights";
const GRAPH_VERSION = "v24.0";
const RUN_BUDGET_MS = 115_000;

interface Candidate extends DistributionRecord {
  clients?: { slug?: string } | Array<{ slug?: string }> | null;
}
interface Result { distribution_record_id: string; source_ref: string; snapshot_label: string; status: "would_collect" | "collected" | "skipped" | "failed"; reason?: string; error_category?: InsightsErrorCategory; metrics?: Record<string, number>; unsupported_metrics?: string[]; }

function clientSlug(record: Candidate): string | null {
  const joined = Array.isArray(record.clients) ? record.clients[0] : record.clients;
  return typeof joined?.slug === "string" ? joined.slug : null;
}
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function fetchMetric(mediaId: string, metric: string, token: string): Promise<{ data: unknown[] }> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}/insights?metric=${encodeURIComponent(metric)}&access_token=${encodeURIComponent(token)}`;
  let response: Response;
  try { response = await fetch(url); }
  catch { throw Object.assign(new Error("Meta network request failed."), { category: "meta_network" as InsightsErrorCategory }); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`Meta Insights request failed for metric ${metric}.`), { category: classifyInsightsError(response.status, body) });
  return body as { data: unknown[] };
}

async function collectMetrics(mediaId: string, requested: readonly string[], token: string): Promise<{ metrics: Record<string, number>; unsupported: string[] }> {
  const rows: unknown[] = [];
  const unsupported: string[] = [];
  for (const metric of requested) {
    try { rows.push(...((await fetchMetric(mediaId, metric, token)).data ?? [])); }
    catch (error) {
      if ((error as { category?: InsightsErrorCategory }).category === "meta_unsupported_metric") { unsupported.push(metric); continue; }
      throw error;
    }
  }
  return { metrics: normalizeMetaInsights(rows as Array<{ name?: unknown; value?: unknown; values?: Array<{ value?: unknown }> }>), unsupported };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) return json({ ok: false, function: FUNCTION_NAME, error: "CRON_SECRET is not configured; worker is disabled." }, 503);
  if (req.headers.get("x-cron-secret") !== expected) return json({ ok: false, function: FUNCTION_NAME, error: "Unauthorized." }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body uses live defaults for future cron invocation */ }
  const dryRun = body.dry_run === true;
  const batchSize = clampBatchSize(body.batch_size);
  const workerId = crypto.randomUUID();
  const started = Date.now();
  const sb = svc();

  const { data: records, error: recordsError } = await sb.from("client_distribution_records")
    .select("*,clients(slug)").eq("publish_status", "published").eq("platform", "instagram")
    .not("external_post_id", "is", null).not("published_at", "is", null).order("published_at", { ascending: true });
  if (recordsError) return json({ ok: false, function: FUNCTION_NAME, error: recordsError.message }, 500);
  const candidates = (records ?? []) as Candidate[];
  const candidateIds = candidates.map((record) => record.id);
  const { data: snapshots, error: snapshotsError } = candidateIds.length
    ? await sb.from("client_metric_snapshots").select("distribution_record_id,snapshot_label").eq("collection_method", "api").in("distribution_record_id", candidateIds)
    : { data: [], error: null };
  if (snapshotsError) return json({ ok: false, function: FUNCTION_NAME, error: snapshotsError.message }, 500);
  const { data: expiredAttempts, error: expiredAttemptsError } = candidateIds.length
    ? await sb.from("client_insights_collection_attempts").select("distribution_record_id,snapshot_label")
      .eq("status", "skipped").eq("reason", "skipped_expired").in("distribution_record_id", candidateIds)
    : { data: [], error: null };
  if (expiredAttemptsError) return json({ ok: false, function: FUNCTION_NAME, error: expiredAttemptsError.message }, 500);
  const labels = new Map<string, string[]>();
  for (const row of snapshots ?? []) labels.set(row.distribution_record_id, [...(labels.get(row.distribution_record_id) ?? []), row.snapshot_label]);
  const terminallyExpiredStoryIds = new Set((expiredAttempts ?? []).map((row) => row.distribution_record_id));

  const due = candidates
    .filter((record) => !isTerminallyExpiredStory(record, terminallyExpiredStoryIds.has(record.id)))
    .map((record) => ({ record, due: nextDueSnapshot(record, labels.get(record.id) ?? []) }))
    .filter((item) => item.due).slice(0, batchSize) as Array<{ record: Candidate; due: NonNullable<ReturnType<typeof nextDueSnapshot>> }>;
  const results: Result[] = [];
  if (dryRun) {
    for (const { record, due: snapshot } of due) {
      const expired = snapshot.expired;
      results.push({ distribution_record_id: record.id, source_ref: record.source_ref, snapshot_label: snapshot.label, status: expired ? "skipped" : "would_collect", reason: expired ? "skipped_expired" : undefined, unsupported_metrics: [], metrics: {} });
    }
    return json({ ok: true, function: FUNCTION_NAME, run_id: workerId, dry_run: true, due_count: due.length, collected_count: 0, skipped_count: results.filter((r) => r.status === "skipped").length, failed_count: 0, results });
  }

  const { data: run, error: runError } = await sb.from("client_insights_collection_runs").insert({ worker_id: workerId, mode: "live", status: "running", due_count: due.length }).select("id").single();
  if (runError || !run) return json({ ok: false, function: FUNCTION_NAME, error: runError?.message ?? "Could not create collection run." }, 500);

  for (const { record, due: snapshot } of due) {
    const kind = insightsKind(record.asset_format, record.publish_settings);
    const requested = [...metricsForKind(kind)];
    const attemptBase = { run_id: run.id, distribution_record_id: record.id, client_id: record.client_id, source_ref: record.source_ref, external_post_id: record.external_post_id!, snapshot_label: snapshot.label, metrics_requested: requested };
    if (Date.now() - started >= RUN_BUDGET_MS) {
      await sb.from("client_insights_collection_attempts").insert({ ...attemptBase, status: "skipped", reason: "run_budget" });
      results.push({ distribution_record_id: record.id, source_ref: record.source_ref, snapshot_label: snapshot.label, status: "skipped", reason: "run_budget" });
      continue;
    }
    if (snapshot.expired) {
      await sb.from("client_insights_collection_attempts").insert({ ...attemptBase, status: "skipped", reason: "skipped_expired" });
      results.push({ distribution_record_id: record.id, source_ref: record.source_ref, snapshot_label: snapshot.label, status: "skipped", reason: "skipped_expired" });
      continue;
    }
    try {
      const slug = clientSlug(record);
      if (!slug) throw Object.assign(new Error("Client slug is unavailable."), { category: "validation" as InsightsErrorCategory });
      const config = await resolveMetaConfig(sb, slug, record);
      if (!config.token) throw Object.assign(new Error("Meta token is unavailable."), { category: "meta_authentication" as InsightsErrorCategory });
      const collected = await collectMetrics(record.external_post_id!, requested, config.token);
      const { error: persistError } = await sb.rpc("persist_instagram_insights_collection", { p_run_id: run.id, p_distribution_record_id: record.id, p_snapshot_label: snapshot.label, p_metrics_requested: requested, p_metrics_collected: collected.metrics, p_unsupported_metrics: collected.unsupported });
      if (persistError) throw Object.assign(new Error(persistError.message), { category: "validation" as InsightsErrorCategory });
      results.push({ distribution_record_id: record.id, source_ref: record.source_ref, snapshot_label: snapshot.label, status: "collected", metrics: collected.metrics, unsupported_metrics: collected.unsupported });
    } catch (error) {
      const category = (error as { category?: InsightsErrorCategory }).category ?? "unknown";
      const message = safeMessage(error);
      await sb.from("client_insights_collection_attempts").insert({ ...attemptBase, status: "failed", error_category: category, error_message: message });
      results.push({ distribution_record_id: record.id, source_ref: record.source_ref, snapshot_label: snapshot.label, status: "failed", error_category: category, reason: message });
    }
  }

  const collectedCount = results.filter((r) => r.status === "collected").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  await sb.from("client_insights_collection_runs").update({ finished_at: new Date().toISOString(), status: failedCount ? "completed_with_errors" : "completed", collected_count: collectedCount, skipped_count: skippedCount, failed_count: failedCount }).eq("id", run.id);
  return json({ ok: failedCount === 0, function: FUNCTION_NAME, run_id: run.id, dry_run: false, due_count: due.length, collected_count: collectedCount, skipped_count: skippedCount, failed_count: failedCount, results });
});
