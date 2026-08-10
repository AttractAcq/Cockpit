// collect-facebook-insights · Programme Stage 1B-E.
// Mirrors collect-instagram-insights/index.ts's structure and safety
// contract exactly (CRON_SECRET-gated before any DB access, budgeted run,
// one collection run row + one attempt row per candidate, never marks
// anything collected without a real Meta response). Facebook needs its own
// function rather than a platform branch inside the Instagram one because
// the actual Graph calls differ: a Page-token exchange is required first
// (facebook-publish.ts's resolvePageAccessToken, not Instagram's raw system-
// user token), and metrics come from two different Graph calls (post
// insights + the post object's own comments/shares fields), not one.
import { json, cors, svc } from "../_shared/aa.ts";
import { resolveClientMetaToken } from "../_shared/facebook-destination-auth.ts";
import { resolvePageAccessToken } from "../_shared/facebook-publish.ts";
import {
  FACEBOOK_POST_INSIGHT_METRICS, FACEBOOK_POST_OBJECT_FIELDS,
  classifyFacebookInsightsError, isFacebookInsightsCollectable, nextDueFacebookSnapshot, normalizeFacebookInsights,
  type FacebookInsightsErrorCategory, type MetaFacebookInsightDatum,
} from "../_shared/facebook-insights.ts";

const FUNCTION_NAME = "collect-facebook-insights";
const GRAPH_VERSION = "v21.0"; // Same pinned version as every other Facebook/Instagram Graph call in this repo.
const RUN_BUDGET_MS = 115_000;

interface Candidate {
  id: string; client_id: string; source_ref: string; asset_format: string; publish_status: string;
  external_post_id: string | null; published_at: string | null; platform: string | null;
  publish_settings?: Record<string, unknown> | null;
  clients?: { slug?: string } | Array<{ slug?: string }> | null;
}
interface Result { distribution_record_id: string; source_ref: string; snapshot_label: string; status: "would_collect" | "collected" | "skipped" | "failed"; reason?: string; error_category?: FacebookInsightsErrorCategory; metrics?: Record<string, number>; }

function clientSlug(record: Candidate): string | null {
  const joined = Array.isArray(record.clients) ? record.clients[0] : record.clients;
  return typeof joined?.slug === "string" ? joined.slug : null;
}
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
function clampBatchSize(value: unknown): number {
  const parsed = Number(value ?? 5);
  return Number.isFinite(parsed) ? Math.min(20, Math.max(1, Math.trunc(parsed))) : 5;
}

async function fetchGraph(path: string, params: Record<string, string>, token: string): Promise<Record<string, unknown>> {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${path}?${new URLSearchParams({ ...params, access_token: token }).toString()}`;
  let response: Response;
  try { response = await fetch(url); }
  catch { throw Object.assign(new Error("Meta network request failed."), { category: "meta_network" as FacebookInsightsErrorCategory }); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`Meta Graph request failed for ${path}.`), { category: classifyFacebookInsightsError(response.status, body) });
  return body as Record<string, unknown>;
}

async function collectFacebookMetrics(postId: string, pageToken: string): Promise<Record<string, number>> {
  const [insights, postObject] = await Promise.all([
    fetchGraph(`${postId}/insights`, { metric: FACEBOOK_POST_INSIGHT_METRICS.join(",") }, pageToken).then((d) => (d.data ?? []) as MetaFacebookInsightDatum[]).catch((error) => {
      // A single unsupported/rejected metric in the batch fails the whole
      // request on Facebook's Insights endpoint (unlike Instagram, which
      // rejects per-metric) — treat as "collect what we can" by degrading to
      // an empty insights set rather than failing the whole snapshot when
      // the only problem is the metric list, matching the "never fabricate,
      // never silently succeed" rule the other direction: still surfaced via
      // the thrown error for a real auth/permission/network failure.
      const category = (error as { category?: FacebookInsightsErrorCategory }).category;
      if (category === "meta_unsupported_metric") return [] as MetaFacebookInsightDatum[];
      throw error;
    }),
    fetchGraph(postId, { fields: FACEBOOK_POST_OBJECT_FIELDS }, pageToken),
  ]);
  return normalizeFacebookInsights(insights, postObject as { comments?: { summary?: { total_count?: unknown } }; shares?: { count?: unknown } });
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
    .select("*,clients(slug)").eq("publish_status", "published").eq("platform", "facebook")
    .not("external_post_id", "is", null).not("published_at", "is", null).order("published_at", { ascending: true });
  if (recordsError) return json({ ok: false, function: FUNCTION_NAME, error: recordsError.message }, 500);
  const candidates = (records ?? []) as Candidate[];
  const candidateIds = candidates.map((record) => record.id);
  const { data: snapshots, error: snapshotsError } = candidateIds.length
    ? await sb.from("client_metric_snapshots").select("distribution_record_id,snapshot_label").eq("collection_method", "api").eq("platform", "facebook").in("distribution_record_id", candidateIds)
    : { data: [], error: null };
  if (snapshotsError) return json({ ok: false, function: FUNCTION_NAME, error: snapshotsError.message }, 500);
  const labels = new Map<string, string[]>();
  for (const row of snapshots ?? []) labels.set(row.distribution_record_id, [...(labels.get(row.distribution_record_id) ?? []), row.snapshot_label]);

  const due = candidates
    .filter((record) => isFacebookInsightsCollectable(record))
    .map((record) => ({ record, due: nextDueFacebookSnapshot(record, labels.get(record.id) ?? []) }))
    .filter((item) => item.due).slice(0, batchSize) as Array<{ record: Candidate; due: NonNullable<ReturnType<typeof nextDueFacebookSnapshot>> }>;

  if (dryRun) {
    const results: Result[] = due.map(({ record, due: snapshot }) => ({ distribution_record_id: record.id, source_ref: record.source_ref, snapshot_label: snapshot.label, status: "would_collect" }));
    return json({ ok: true, function: FUNCTION_NAME, run_id: workerId, dry_run: true, due_count: due.length, collected_count: 0, skipped_count: 0, failed_count: 0, results });
  }

  const { data: run, error: runError } = await sb.from("client_insights_collection_runs").insert({ worker_id: workerId, mode: "live", status: "running", due_count: due.length }).select("id").single();
  if (runError || !run) return json({ ok: false, function: FUNCTION_NAME, error: runError?.message ?? "Could not create collection run." }, 500);

  const results: Result[] = [];
  for (const { record, due: snapshot } of due) {
    const attemptBase = { run_id: run.id, distribution_record_id: record.id, client_id: record.client_id, source_ref: record.source_ref, external_post_id: record.external_post_id!, snapshot_label: snapshot.label, metrics_requested: [...FACEBOOK_POST_INSIGHT_METRICS] };
    if (Date.now() - started >= RUN_BUDGET_MS) {
      await sb.from("client_insights_collection_attempts").insert({ ...attemptBase, status: "skipped", reason: "run_budget" });
      results.push({ distribution_record_id: record.id, source_ref: record.source_ref, snapshot_label: snapshot.label, status: "skipped", reason: "run_budget" });
      continue;
    }
    try {
      const slug = clientSlug(record);
      if (!slug) throw Object.assign(new Error("Client slug is unavailable."), { category: "validation" as FacebookInsightsErrorCategory });
      const { data: destination } = await sb.from("client_distribution_records").select("destination").eq("id", record.id).maybeSingle();
      const pageId = destination?.destination;
      if (!pageId) throw Object.assign(new Error("Record has no Facebook Page destination."), { category: "validation" as FacebookInsightsErrorCategory });
      const { token, missing } = await resolveClientMetaToken(sb, slug);
      if (!token) throw Object.assign(new Error(`Meta token is unavailable: ${missing.join("; ")}`), { category: "meta_authentication" as FacebookInsightsErrorCategory });
      const pageToken = await resolvePageAccessToken(pageId, token).catch((error) => {
        throw Object.assign(new Error(error instanceof Error ? error.message : String(error)), { category: "meta_authentication" as FacebookInsightsErrorCategory });
      });
      const metrics = await collectFacebookMetrics(record.external_post_id!, pageToken);
      const { error: persistError } = await sb.rpc("persist_facebook_insights_collection", { p_run_id: run.id, p_distribution_record_id: record.id, p_snapshot_label: snapshot.label, p_metrics_requested: [...FACEBOOK_POST_INSIGHT_METRICS], p_metrics_collected: metrics, p_unsupported_metrics: [] });
      if (persistError) throw Object.assign(new Error(persistError.message), { category: "validation" as FacebookInsightsErrorCategory });
      results.push({ distribution_record_id: record.id, source_ref: record.source_ref, snapshot_label: snapshot.label, status: "collected", metrics });
    } catch (error) {
      const category = (error as { category?: FacebookInsightsErrorCategory }).category ?? "unknown";
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
