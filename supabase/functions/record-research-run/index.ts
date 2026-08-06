// Programme Stage C runtime: controlled research runs.
//
// Evidence is SUPPLIED, never generated. A model asked to produce research URLs
// will invent them, and a fabricated citation that looks real is worse than no
// citation at all. This records research an operator (or a future real search
// integration) has actually retrieved, with full provenance.
//
// A run with no sources FAILS — an empty research run must never look completed.
//
// Writes only to client_research_runs and client_research_sources.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";

const DOMAINS = new Set([
  "business", "market", "competitors", "customer_language",
  "category_regulation", "market_conditions",
]);
const EVIDENCE_KINDS = new Set(["quoted", "paraphrased"]);
const CONFIDENCE = new Set(["low", "medium", "high"]);
const RESTRICTIONS = new Set(["unrestricted", "attribution_required", "review_required", "do_not_publish"]);

interface SourceInput {
  url?: string; title?: string; publisher?: string; retrieved_at?: string;
  evidence_kind?: string; evidence_text?: string; confidence?: string; use_restriction?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; research_domain?: string; idempotency_key?: string; sources?: SourceInput[] };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const domain = (body.research_domain ?? "").trim();
  const sources = Array.isArray(body.sources) ? body.sources : [];

  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!DOMAINS.has(domain)) return json({ code: "INVALID_DOMAIN", allowed: [...DOMAINS] }, 400);
  if (sources.length === 0) {
    return json({
      code: "NO_SOURCES",
      message: "A research run requires at least one retrieved source. An empty run cannot be recorded as completed.",
    }, 400);
  }

  // Validate every source before writing anything: a run is all-or-nothing.
  const errors: string[] = [];
  sources.forEach((s, i) => {
    const at = `source ${i + 1}`;
    if (!s.url || s.url.trim().length === 0) errors.push(`${at} has no url.`);
    if (!s.title || s.title.trim().length === 0) errors.push(`${at} has no title.`);
    if (!s.evidence_text || s.evidence_text.trim().length === 0) errors.push(`${at} has no evidence_text.`);
    if (!EVIDENCE_KINDS.has(s.evidence_kind ?? "")) errors.push(`${at} evidence_kind must be quoted or paraphrased.`);
    if (!CONFIDENCE.has(s.confidence ?? "")) errors.push(`${at} confidence must be low, medium or high.`);
    if (s.use_restriction && !RESTRICTIONS.has(s.use_restriction)) errors.push(`${at} has an invalid use_restriction.`);
    if (!s.retrieved_at || Number.isNaN(Date.parse(s.retrieved_at))) errors.push(`${at} has no valid retrieved_at.`);
  });
  if (errors.length > 0) return json({ code: "INVALID_SOURCES", errors }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();
  const idempotencyKey = (body.idempotency_key ?? `${domain}:${new Date().toISOString().slice(0, 10)}`).slice(0, 160);

  const { data: existing } = await sb
    .from("client_research_runs").select("id, status, source_count")
    .eq("client_id", clientId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) {
    return json({
      duplicate: true, research_run_id: existing.id, status: existing.status,
      source_count: existing.source_count,
      message: "A run with this idempotency key already exists for this client.",
    }, 200);
  }

  const { data: run, error: runErr } = await sb
    .from("client_research_runs")
    .insert({
      client_id: clientId, research_domain: domain, status: "running",
      idempotency_key: idempotencyKey, created_by: access.userId,
    })
    .select("id").single();
  if (runErr) return json({ code: "RUN_INSERT_FAILED", message: runErr.message }, 500);
  const runId = run.id as string;

  const rows = sources.map((s) => ({
    client_id: clientId,
    research_run_id: runId,
    url: s.url!.trim(),
    title: s.title!.trim(),
    publisher: s.publisher?.trim() || null,
    retrieved_at: new Date(s.retrieved_at!).toISOString(),
    evidence_kind: s.evidence_kind,
    evidence_text: s.evidence_text!.trim(),
    confidence: s.confidence,
    use_restriction: s.use_restriction ?? "review_required",
  }));

  const { error: srcErr } = await sb.from("client_research_sources").insert(rows);
  if (srcErr) {
    // Never leave a run stuck in 'running' with no evidence.
    await sb.from("client_research_runs").update({
      status: "failed", failure_code: "SOURCE_INSERT_FAILED",
      failure_message: srcErr.message.slice(0, 2000), retryable: true,
    }).eq("id", runId);
    return json({ code: "SOURCE_INSERT_FAILED", message: srcErr.message, research_run_id: runId }, 500);
  }

  const { error: doneErr } = await sb.from("client_research_runs").update({
    status: "completed", source_count: rows.length, completed_at: new Date().toISOString(),
  }).eq("id", runId);
  if (doneErr) return json({ code: "COMPLETE_FAILED", message: doneErr.message, research_run_id: runId }, 500);

  await audit(sb, "research_run.recorded", "client_research_runs", runId, {
    client_id: clientId, research_domain: domain, source_count: rows.length,
  });

  return json({ duplicate: false, research_run_id: runId, status: "completed", source_count: rows.length }, 201);
});
