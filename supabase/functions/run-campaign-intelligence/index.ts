// Phase 4A — Campaign Intelligence orchestration.
//
// Campaign Intelligence turns approved upstream Intelligence into a reviewable
// "what matters when, and why" calendar. It does not create offers or content
// ideas; those downstream modules consume approved campaign periods by id.

import { audit, cors, json, svc } from "../_shared/aa.ts";
import { validateIntelligenceAccess } from "../_shared/intelligence/auth.ts";

type Action = "prepare" | "step" | "finalize";
type ServiceClient = ReturnType<typeof svc>;

const REQUIRED_DOMAINS = ["market_os", "avatar_os", "competitor_os", "association_os", "brand_strategist"] as const;

const PERIOD_BLUEPRINTS = [
  {
    key: "foundation_and_alignment",
    title: "Foundation and alignment window",
    timingLabel: "First strategic planning window",
    stage: "context_alignment",
    objective: "Clarify the most defensible strategic conversation before seasonal activation.",
  },
  {
    key: "proof_and_problem_salience",
    title: "Proof and problem salience window",
    timingLabel: "Second strategic planning window",
    stage: "problem_salience",
    objective: "Increase attention around the most evidence-backed pains and desired outcomes.",
  },
  {
    key: "decision_and_offer_readiness",
    title: "Decision and offer-readiness window",
    timingLabel: "Third strategic planning window",
    stage: "decision_readiness",
    objective: "Prepare the market for commercially relevant decisions without generating the offer itself.",
  },
  {
    key: "review_and_next_cycle",
    title: "Review and next-cycle window",
    timingLabel: "Fourth strategic planning window",
    stage: "cycle_review",
    objective: "Review what the ICP should now understand, believe, or decide before the next campaign cycle.",
  },
] as const;

interface ResearchStepRow {
  id: string;
  client_id: string;
  research_run_id: string;
  step_key: string;
  step_order: number;
  title: string;
  status: string;
  attempt_count: number;
  maximum_attempts: number;
  failure_code: string | null;
  failure_message: string | null;
  output_summary: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
}

interface IntelligenceReleaseSnapshot {
  domain: typeof REQUIRED_DOMAINS[number];
  release_id: string;
  version: number;
  title: string;
  summary: string;
  approved_at: string;
}

interface IntelligenceRecordRow {
  id: string;
  release_id: string;
  record_type: string;
  record_key: string;
  title: string;
  summary: string;
  payload: Record<string, unknown>;
  display_order: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compact(value: string, limit: number): string {
  const trimmed = value.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}\n[truncated]`;
}

function readableDomain(domain: string): string {
  return domain.replaceAll("_", " ");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function stepProgress(sb: ServiceClient, researchRunId: string) {
  const { data, error } = await sb.from("client_research_steps")
    .select("status,attempt_count,maximum_attempts").eq("research_run_id", researchRunId);
  if (error) throw new Error(error.message);
  const steps = data ?? [];
  const completed = steps.filter((step) => step.status === "completed").length;
  const failed = steps.filter((step) => step.status === "failed").length;
  const recoverable = steps.some((step) =>
    step.status === "queued" ||
    step.status === "running" ||
    step.status === "waiting_provider" ||
    (step.status === "failed" && step.attempt_count < step.maximum_attempts)
  );
  return { completed, failed, total: steps.length, terminal: !recoverable };
}

async function loadAuthority(sb: ServiceClient, clientId: string): Promise<
  | { ok: true; releases: IntelligenceReleaseSnapshot[]; records: Map<string, IntelligenceRecordRow[]>; authorityHash: string }
  | { ok: false; status: number; code: string; message: string; missing_domains?: string[] }
> {
  const { data: activeRows, error: activeError } = await sb.from("client_intelligence_active_releases")
    .select("intelligence_domain,release_id")
    .eq("client_id", clientId)
    .in("intelligence_domain", [...REQUIRED_DOMAINS]);
  if (activeError) return { ok: false, status: 500, code: "ACTIVE_AUTHORITY_LOAD_FAILED", message: activeError.message };

  const releaseIdsByDomain = new Map((activeRows ?? []).map((row) => [row.intelligence_domain as string, row.release_id as string]));
  const missing = REQUIRED_DOMAINS.filter((domain) => !releaseIdsByDomain.has(domain));
  if (missing.length > 0) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_UPSTREAM_INTELLIGENCE_REQUIRED",
      message: "Campaign Intelligence requires active approved Market OS, Avatar OS, Competitor OS, Association OS, and Brand Strategist authority.",
      missing_domains: missing,
    };
  }

  const releaseIds = REQUIRED_DOMAINS.map((domain) => releaseIdsByDomain.get(domain) as string);
  const { data: releaseRows, error: releaseError } = await sb.from("client_intelligence_releases")
    .select("id,intelligence_domain,version,title,summary,approved_at")
    .eq("client_id", clientId)
    .eq("status", "approved")
    .in("id", releaseIds);
  if (releaseError) return { ok: false, status: 500, code: "UPSTREAM_RELEASE_LOAD_FAILED", message: releaseError.message };

  const releases = REQUIRED_DOMAINS.map((domain) => {
    const release = (releaseRows ?? []).find((row) => row.intelligence_domain === domain);
    if (!release?.approved_at) return null;
    return {
      domain,
      release_id: release.id,
      version: release.version,
      title: release.title,
      summary: release.summary,
      approved_at: release.approved_at,
    };
  });
  if (releases.some((release) => !release)) {
    return {
      ok: false,
      status: 409,
      code: "APPROVED_UPSTREAM_INTELLIGENCE_REQUIRED",
      message: "Campaign Intelligence could not verify every active upstream release as approved.",
    };
  }

  const { data: recordRows, error: recordError } = await sb.from("client_intelligence_records")
    .select("id,release_id,record_type,record_key,title,summary,payload,display_order")
    .eq("client_id", clientId)
    .in("release_id", releaseIds)
    .order("display_order");
  if (recordError) return { ok: false, status: 500, code: "UPSTREAM_RECORD_LOAD_FAILED", message: recordError.message };

  const records = new Map<string, IntelligenceRecordRow[]>();
  for (const domain of REQUIRED_DOMAINS) {
    const releaseId = releaseIdsByDomain.get(domain);
    records.set(domain, (recordRows ?? []).filter((record) => record.release_id === releaseId) as IntelligenceRecordRow[]);
  }

  const authority = {
    releases,
    record_counts: Object.fromEntries([...records.entries()].map(([domain, rows]) => [domain, rows.length])),
  };
  return {
    ok: true,
    releases: releases as IntelligenceReleaseSnapshot[],
    records,
    authorityHash: await sha256(JSON.stringify(authority)),
  };
}

function representative(rows: IntelligenceRecordRow[], offset: number): IntelligenceRecordRow | null {
  if (rows.length === 0) return null;
  return rows[offset % rows.length];
}

function periodFromAuthority(
  blueprint: typeof PERIOD_BLUEPRINTS[number],
  index: number,
  records: Map<string, IntelligenceRecordRow[]>,
) {
  const market = representative(records.get("market_os") ?? [], index);
  const avatar = representative(records.get("avatar_os") ?? [], index);
  const competitor = representative(records.get("competitor_os") ?? [], index);
  const association = representative(records.get("association_os") ?? [], index);
  const strategy = representative(records.get("brand_strategist") ?? [], index);
  const evidence = [market, avatar, competitor, association, strategy].filter((record): record is IntelligenceRecordRow => Boolean(record));
  const primaryPain = avatar?.title ?? market?.title ?? "approved ICP problem area";
  const strategicTheme = strategy?.title ?? association?.title ?? blueprint.title;
  const marketContext = market ? `${market.title}: ${market.summary}` : "Approved Market OS context should be reviewed for this window.";
  const avatarContext = avatar ? `${avatar.title}: ${avatar.summary}` : "Approved Avatar OS context should be reviewed for this window.";

  return {
    period_key: blueprint.key,
    title: blueprint.title,
    strategic_theme: compact(strategicTheme, 500),
    timing_label: blueprint.timingLabel,
    timing_start: null,
    timing_end: null,
    icp_context: compact(`${marketContext}\n${avatarContext}`, 5000),
    emotional_states: ["review_required"],
    pain_point_salience: [compact(primaryPain, 160)],
    desired_outcome: compact(strategy?.summary ?? association?.summary ?? "Clarify the desired outcome using approved upstream authority during review.", 5000),
    awareness_shift: "Review how the ICP's interpretation of the problem should shift during this window before approval.",
    strategic_messaging_direction: compact(strategy?.summary ?? "Use approved upstream authority to define the dominant conversation for this period.", 5000),
    positioning_direction: compact(association?.summary ?? competitor?.summary ?? "Positioning direction requires human review before downstream use.", 5000),
    campaign_objective: blueprint.objective,
    customer_journey_stage: blueprint.stage,
    previous_period_relationship: index === 0
      ? "Opening period for this Campaign Intelligence release."
      : `Evolves from ${PERIOD_BLUEPRINTS[index - 1].title}.`,
    evidence_summary: compact(evidence.map((record) => `${record.record_type}/${record.record_key}`).join(", "), 2000),
    payload: {
      source_record_refs: evidence.map((record) => ({
        release_id: record.release_id,
        record_id: record.id,
        record_type: record.record_type,
        record_key: record.record_key,
        title: record.title,
      })),
      stage_4a_scaffold: true,
      human_review_required: true,
    },
    display_order: index + 1,
    evidence,
  };
}

async function prepare(sb: ServiceClient, clientId: string, userId: string) {
  const authority = await loadAuthority(sb, clientId);
  if (!authority.ok) return json({ ok: false, mode: "blocked", ...authority }, authority.status);

  const { data: openRuns, error: openError } = await sb.from("client_research_runs")
    .select("*").eq("client_id", clientId).eq("research_domain", "campaign_intelligence")
    .in("status", ["queued", "running", "waiting_provider", "failed"])
    .order("created_at", { ascending: false }).limit(5);
  if (openError) return json({ ok: false, mode: "blocked", message: openError.message }, 500);

  for (const run of openRuns ?? []) {
    if (run.prompt_digest !== authority.authorityHash) continue;
    const { data: release } = await sb.from("client_campaign_intelligence_releases")
      .select("id,status").eq("client_id", clientId).eq("research_run_id", run.id)
      .in("status", ["draft", "needs_review"]).maybeSingle();
    if (!release || release.status === "needs_review") continue;
    const { data: steps, error: stepError } = await sb.from("client_research_steps")
      .select("*").eq("research_run_id", run.id).order("step_order");
    if (stepError) return json({ ok: false, mode: "blocked", message: stepError.message }, 500);
    const hasExhaustedFailure = (steps ?? []).some((step) => step.status === "failed" && step.attempt_count >= step.maximum_attempts);
    if (hasExhaustedFailure) continue;
    const canResume = (steps ?? []).some((step) =>
      step.status === "queued" || step.status === "running" || step.status === "waiting_provider" ||
      (step.status === "failed" && step.attempt_count < step.maximum_attempts)
    );
    if (!canResume) continue;
    await sb.from("client_research_runs").update({ status: "queued", retryable: false, failure_code: null, failure_message: null }).eq("id", run.id);
    return json({ ok: true, mode: "resumed", message: "Resuming the existing Campaign Intelligence build.", research_run_id: run.id, release_id: release.id, steps: steps ?? [] });
  }

  const { data: latestRelease, error: latestError } = await sb.from("client_campaign_intelligence_releases")
    .select("version").eq("client_id", clientId).order("version", { ascending: false }).limit(1).maybeSingle();
  if (latestError) return json({ ok: false, mode: "blocked", message: latestError.message }, 500);
  const version = (latestRelease?.version ?? 0) + 1;
  const idempotencyKey = `campaign_intelligence:${authority.authorityHash.slice(0, 40)}:v${version}`;
  const { data: run, error: runError } = await sb.from("client_research_runs").insert({
    client_id: clientId,
    research_domain: "campaign_intelligence",
    intelligence_domain: null,
    status: "queued",
    idempotency_key: idempotencyKey,
    provider: "system",
    model: "stage_4a_campaign_intelligence_scaffold",
    prompt_digest: authority.authorityHash,
    configuration_snapshot: {
      authority_hash: authority.authorityHash,
      required_domains: REQUIRED_DOMAINS,
      output_contract: "campaign_period_calendar",
    },
    created_by: userId,
  }).select("*").single();
  if (runError) return json({ ok: false, mode: "blocked", message: runError.message }, 500);

  const authoritySnapshot = {
    authority_hash: authority.authorityHash,
    upstream_releases: authority.releases,
    generated_from: "approved_intelligence",
    separation_of_concerns: {
      campaign_intelligence: "what_matters_when_and_why",
      excluded: ["main_offers", "seasonal_offers", "content_ideation"],
    },
  };
  const { data: release, error: releaseError } = await sb.from("client_campaign_intelligence_releases").insert({
    client_id: clientId,
    version,
    status: "draft",
    research_run_id: run.id,
    title: `Campaign Intelligence v${version}`,
    summary: "Draft campaign-period strategy generated from approved upstream Intelligence. Human review is required before downstream use.",
    authority_snapshot: authoritySnapshot,
    created_by: userId,
  }).select("*").single();
  if (releaseError) {
    await sb.from("client_research_runs").update({ status: "failed", failure_code: "RELEASE_CREATE_FAILED", failure_message: releaseError.message, retryable: false }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: releaseError.message }, 500);
  }

  const { data: step, error: stepError } = await sb.from("client_research_steps").insert({
    client_id: clientId,
    research_run_id: run.id,
    step_key: "campaign_period_calendar",
    step_order: 1,
    title: "Campaign period calendar",
  }).select("*").single();
  if (stepError) {
    await sb.from("client_research_runs").update({ status: "failed", failure_code: "STEP_CREATE_FAILED", failure_message: stepError.message, retryable: false }).eq("id", run.id);
    return json({ ok: false, mode: "blocked", message: stepError.message }, 500);
  }

  await audit(sb, "campaign_intelligence.prepared", "client_campaign_intelligence_releases", release.id, {
    client_id: clientId,
    research_run_id: run.id,
    authority_hash: authority.authorityHash,
  });
  return json({ ok: true, mode: "prepared", message: "Campaign Intelligence workflow prepared.", research_run_id: run.id, release_id: release.id, steps: [step] });
}

async function runStep(sb: ServiceClient, clientId: string, researchRunId: string) {
  const { data: run, error: runError } = await sb.from("client_research_runs")
    .select("*").eq("id", researchRunId).eq("client_id", clientId).eq("research_domain", "campaign_intelligence").maybeSingle();
  if (runError || !run) return json({ ok: false, terminal: true, message: runError?.message ?? "Campaign Intelligence research run not found." }, 404);
  if (run.status === "completed" || run.status === "completed_partial" || run.status === "cancelled") {
    return json({ ok: true, terminal: true, message: "Campaign Intelligence research is already terminal.", research_run_id: researchRunId, progress: await stepProgress(sb, researchRunId) });
  }
  const { data: release, error: releaseError } = await sb.from("client_campaign_intelligence_releases")
    .select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).eq("status", "draft").maybeSingle();
  if (releaseError || !release) return json({ ok: false, terminal: true, message: releaseError?.message ?? "Draft Campaign Intelligence release not found." }, 409);

  const leaseOwner = `campaign-intelligence:${crypto.randomUUID()}`;
  const { data: claimed, error: claimError } = await sb.rpc("claim_client_research_step", {
    p_research_run_id: researchRunId,
    p_lease_owner: leaseOwner,
    p_lease_seconds: 120,
  });
  if (claimError) return json({ ok: false, terminal: true, message: claimError.message, research_run_id: researchRunId }, 500);
  if (!claimed) {
    const progress = await stepProgress(sb, researchRunId);
    return json({
      ok: progress.completed > 0 && progress.terminal,
      terminal: progress.terminal,
      message: progress.terminal ? "No recoverable Campaign Intelligence steps remain." : "Another worker currently owns the next Campaign Intelligence step.",
      research_run_id: researchRunId,
      release_id: release.id,
      progress,
    });
  }

  const step = claimed as ResearchStepRow;
  await sb.from("client_research_runs").update({
    status: "running",
    started_at: run.started_at ?? new Date().toISOString(),
    retryable: false,
    failure_code: null,
    failure_message: null,
  }).eq("id", researchRunId);

  try {
    const authority = await loadAuthority(sb, clientId);
    if (!authority.ok) throw new Error(authority.message);
    if (run.prompt_digest !== authority.authorityHash) {
      throw new Error("Approved upstream Intelligence changed after this Campaign Intelligence run began. Start a new run from the new authority.");
    }

    const { data: existingPeriods, error: existingPeriodError } = await sb.from("client_campaign_periods")
      .select("id").eq("client_id", clientId).eq("release_id", release.id);
    if (existingPeriodError) throw new Error(existingPeriodError.message);
    const existingPeriodIds = (existingPeriods ?? []).map((period) => period.id).filter(Boolean);
    if (existingPeriodIds.length > 0) {
      const { error: deleteLinksError } = await sb.from("client_campaign_period_source_links").delete()
        .eq("client_id", clientId)
        .in("campaign_period_id", existingPeriodIds);
      if (deleteLinksError) throw new Error(deleteLinksError.message);
    }
    await sb.from("client_campaign_periods").delete().eq("client_id", clientId).eq("release_id", release.id);

    const periods = PERIOD_BLUEPRINTS.map((blueprint, index) => periodFromAuthority(blueprint, index, authority.records));
    const { data: insertedPeriods, error: periodError } = await sb.from("client_campaign_periods").insert(periods.map((period) => ({
      client_id: clientId,
      release_id: release.id,
      period_key: period.period_key,
      title: period.title,
      strategic_theme: period.strategic_theme,
      timing_label: period.timing_label,
      timing_start: period.timing_start,
      timing_end: period.timing_end,
      icp_context: period.icp_context,
      emotional_states: period.emotional_states,
      pain_point_salience: period.pain_point_salience,
      desired_outcome: period.desired_outcome,
      awareness_shift: period.awareness_shift,
      strategic_messaging_direction: period.strategic_messaging_direction,
      positioning_direction: period.positioning_direction,
      campaign_objective: period.campaign_objective,
      customer_journey_stage: period.customer_journey_stage,
      previous_period_relationship: period.previous_period_relationship,
      evidence_summary: period.evidence_summary,
      payload: period.payload,
      display_order: period.display_order,
    }))).select("id,period_key");
    if (periodError) throw new Error(periodError.message);

    const periodIdByKey = new Map((insertedPeriods ?? []).map((period) => [period.period_key, period.id]));
    const sourceRows = periods.flatMap((period) => {
      const periodId = periodIdByKey.get(period.period_key);
      if (!periodId) return [];
      return period.evidence.map((record) => {
        const sourceDomain = REQUIRED_DOMAINS.find((domain) =>
          authority.releases.find((releaseSnapshot) => releaseSnapshot.domain === domain)?.release_id === record.release_id
        ) ?? "brand_strategist";
        return {
          client_id: clientId,
          campaign_period_id: periodId,
          source_domain: sourceDomain,
          source_release_id: record.release_id,
          source_record_id: record.id,
          relationship: "informs",
          note: `${readableDomain(sourceDomain)} record informed the Stage 4A scaffold.`,
        };
      });
    });
    if (sourceRows.length > 0) {
      const { error: linkError } = await sb.from("client_campaign_period_source_links").insert(sourceRows);
      if (linkError) throw new Error(linkError.message);
    }

    await sb.from("client_research_steps").update({
      status: "completed",
      completed_at: new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      output_summary: {
        period_count: periods.length,
        source_link_count: sourceRows.length,
        scaffold: true,
      },
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({ source_count: sourceRows.length }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({
      ok: true,
      terminal: progress.terminal,
      message: "Campaign period calendar completed.",
      research_run_id: researchRunId,
      release_id: release.id,
      step: { ...step, status: "completed", completed_at: new Date().toISOString() },
      progress,
    });
  } catch (error) {
    const message = compact(errorMessage(error), 2000);
    await sb.from("client_research_steps").update({
      status: "failed",
      attempt_count: step.maximum_attempts,
      failure_code: "CAMPAIGN_INTELLIGENCE_STEP_FAILED",
      failure_message: message,
      lease_owner: null,
      lease_expires_at: null,
    }).eq("id", step.id);
    await sb.from("client_research_runs").update({
      status: "failed",
      failure_code: "CAMPAIGN_INTELLIGENCE_STEP_FAILED",
      failure_message: message,
      retryable: false,
    }).eq("id", researchRunId);
    const progress = await stepProgress(sb, researchRunId);
    return json({ ok: false, terminal: true, message, research_run_id: researchRunId, release_id: release.id, progress }, 500);
  }
}

async function finalize(sb: ServiceClient, clientId: string, researchRunId: string) {
  const [runResult, releaseResult] = await Promise.all([
    sb.from("client_research_runs").select("*").eq("id", researchRunId).eq("client_id", clientId).maybeSingle(),
    sb.from("client_campaign_intelligence_releases").select("*").eq("client_id", clientId).eq("research_run_id", researchRunId).maybeSingle(),
  ]);
  if (runResult.error || !runResult.data || releaseResult.error || !releaseResult.data) {
    return json({ ok: false, message: runResult.error?.message ?? releaseResult.error?.message ?? "Campaign Intelligence run or release not found." }, 404);
  }
  const { count: periodCount, error: periodError } = await sb.from("client_campaign_periods")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("release_id", releaseResult.data.id);
  if (periodError) return json({ ok: false, message: periodError.message }, 500);
  const progress = await stepProgress(sb, researchRunId);
  if (!progress.terminal || progress.completed === 0) {
    return json({ ok: false, message: "Campaign Intelligence cannot be finalised while recoverable work remains or no step completed.", progress }, 409);
  }
  if ((periodCount ?? 0) === 0) {
    return json({ ok: false, message: "Campaign Intelligence has no campaign periods." }, 409);
  }
  const now = new Date().toISOString();
  const status = progress.failed > 0 ? "completed_partial" : "completed";
  const { data: updatedRelease, error: releaseUpdateError } = await sb.from("client_campaign_intelligence_releases").update({
    status: "needs_review",
    summary: "Draft Campaign Intelligence calendar ready for human review. Downstream modules must only consume it after approval.",
    generated_at: now,
    submitted_at: now,
  }).eq("id", releaseResult.data.id).select("*").single();
  if (releaseUpdateError) return json({ ok: false, message: releaseUpdateError.message }, 500);
  const { data: updatedRun, error: runUpdateError } = await sb.from("client_research_runs").update({
    status,
    completed_at: now,
    failure_code: progress.failed > 0 ? "CAMPAIGN_INTELLIGENCE_PARTIAL" : null,
    failure_message: progress.failed > 0 ? `${progress.failed} Campaign Intelligence step(s) did not complete.` : null,
    retryable: false,
  }).eq("id", researchRunId).select("*").single();
  if (runUpdateError) return json({ ok: false, message: runUpdateError.message }, 500);
  await audit(sb, "campaign_intelligence.submitted_for_review", "client_campaign_intelligence_releases", updatedRelease.id, {
    client_id: clientId,
    research_run_id: researchRunId,
    period_count: periodCount,
  });
  return json({ ok: true, message: "Campaign Intelligence is ready for human review.", release: updatedRelease, run: updatedRun });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, message: "Method not allowed." }, 405);

  let body: { action?: Action; client_id?: string; research_run_id?: string };
  try { body = await req.json(); }
  catch { return json({ ok: false, message: "Invalid JSON body." }, 400); }
  const clientId = (body.client_id ?? "").trim();
  const action = body.action;
  if (!clientId) return json({ ok: false, message: "client_id is required." }, 400);
  if (!action || !new Set<Action>(["prepare", "step", "finalize"]).has(action)) {
    return json({ ok: false, message: "action must be prepare, step, or finalize." }, 400);
  }

  const access = await validateIntelligenceAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ ok: false, code: access.code, message: access.message }, access.status);
  const sb = svc();
  try {
    if (action === "prepare") return await prepare(sb, clientId, access.userId);
    const researchRunId = (body.research_run_id ?? "").trim();
    if (!researchRunId) return json({ ok: false, message: "research_run_id is required." }, 400);
    if (action === "step") return await runStep(sb, clientId, researchRunId);
    return await finalize(sb, clientId, researchRunId);
  } catch (error) {
    return json({ ok: false, message: errorMessage(error) }, 500);
  }
});
