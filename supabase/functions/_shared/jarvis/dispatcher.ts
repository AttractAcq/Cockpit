// Master AI ("Jarvis") — tool execution dispatcher.
//
// Every handler here is a thin proxy to an already-existing, already-tested
// edge function or RPC — this file never reimplements business-rule
// validation (brief-approval gates, proof-claim checks, quantity contracts,
// etc.), it only routes to the real thing, using the SAME caller identity a
// human operator clicking the equivalent button would use. Edge functions
// are invoked through `userClient.functions.invoke`, RPCs/table reads
// through `userClient.rpc`/`userClient.from` — both use the forwarded staff
// JWT, so every downstream function's own auth/RLS check applies unchanged.
//
// Free-tier handlers execute directly. Toggle/floor handlers are dispatched
// to here ONLY after jarvis-turn's gate check has already decided to run
// them (i.e. autonomous_mode allowed it, or a human just approved a pending
// action) — floor tools never reach this file without that human approval,
// by construction of the run loop in jarvis-turn/index.ts.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface JarvisToolContext {
  userClient: SupabaseClient;
  sb: SupabaseClient;
  clientId: string;
  actorId: string;
}

export interface JarvisToolResult {
  ok: boolean;
  output: unknown;
}

function ok(output: unknown): JarvisToolResult {
  return { ok: true, output };
}
function fail(message: string): JarvisToolResult {
  return { ok: false, output: { error: message } };
}

async function invokeFn(userClient: SupabaseClient, name: string, body: Record<string, unknown>): Promise<JarvisToolResult> {
  const { data, error } = await userClient.functions.invoke(name, { body });
  if (error) return fail(`${name} failed: ${error.message}`);
  return ok(data);
}

const MASTER_TABLES = new Set(["organic_master", "story_master", "ads_master"]);

export async function executeJarvisTool(
  ctx: JarvisToolContext,
  toolName: string,
  input: Record<string, unknown>,
): Promise<JarvisToolResult> {
  const { userClient, clientId } = ctx;

  switch (toolName) {
    case "list_pending_sources": {
      const { data, error } = await userClient.from("content_sources")
        .select("id, source_kind, title, processing_status, created_at")
        .eq("client_id", clientId).in("processing_status", ["pending", "processing", "failed"])
        .order("created_at", { ascending: false }).limit(50);
      if (error) return fail(error.message);
      return ok(data);
    }

    case "list_content_items_needing_review": {
      const [organic, story] = await Promise.all([
        userClient.from("organic_master").select("id, ref, working_title, content_type").eq("client_id", clientId).eq("review_state", "needs_review").limit(50),
        userClient.from("story_master").select("id, ref, story_theme").eq("client_id", clientId).eq("review_state", "needs_review").limit(50),
      ]);
      if (organic.error) return fail(organic.error.message);
      if (story.error) return fail(story.error.message);
      return ok({ organic_master: organic.data, story_master: story.data });
    }

    case "list_production_briefs_needing_review": {
      const { data, error } = await userClient.from("client_production_briefs")
        .select("id, source_table, source_ref, asset_format, title, status")
        .eq("client_id", clientId).eq("status", "needs_review").limit(50);
      if (error) return fail(error.message);
      return ok(data);
    }

    case "list_asset_groups_needing_review": {
      const { data, error } = await userClient.from("client_assets")
        .select("asset_group_ref, source_ref, asset_format, status")
        .eq("client_id", clientId).eq("status", "needs_review").eq("is_current", true).limit(100);
      if (error) return fail(error.message);
      return ok(data);
    }

    case "add_manual_idea":
      return invokeFn(userClient, "ingest-content-source", {
        client_id: clientId, source_kind: "manual_idea",
        title: input.title, raw_content: input.body,
        summary: (input.notes as string | undefined)?.trim() || null,
        external_ref: (input.source_url as string | undefined)?.trim() || null,
      });

    case "add_proof":
      return invokeFn(userClient, "ingest-content-source", {
        client_id: clientId, source_kind: "proof_item",
        title: (input.claim as string).slice(0, 400), raw_content: input.detail,
        claim: input.claim, proof_kind: input.proof_kind,
        external_ref: (input.source_url as string | undefined)?.trim() || null,
      });

    case "run_ideation":
      return invokeFn(userClient, "run-ideation", {
        client_id: clientId, period_type: input.period_type,
        start_date: input.start_date, end_date: input.end_date, month: input.month,
        idempotency_key: crypto.randomUUID(),
      });

    case "score_ideation_candidates":
      return invokeFn(userClient, "score-ideation-candidates", {
        client_id: clientId, ideation_cycle_id: input.ideation_cycle_id,
      });

    case "run_intelligence_agent":
      return await driveIntelligenceAgent(userClient, clientId, input.domain as string);

    case "retry_intelligence_step":
      return invokeFn(userClient, `run-${(input.domain as string).replace(/_/g, "-")}`, {
        action: "retry_step", client_id: clientId,
        research_run_id: input.research_run_id, step_id: input.step_id,
      });

    case "approve_source":
      return invokeFn(userClient, "review-content-source", {
        client_id: clientId, content_source_id: input.content_source_id,
        action: "approve", asset_type: input.asset_type ?? null,
      });

    case "reject_source":
      return invokeFn(userClient, "review-content-source", {
        client_id: clientId, content_source_id: input.content_source_id,
        action: "reject", reason: input.reason ?? null,
      });

    case "approve_intelligence_release": {
      const { data, error } = await userClient.rpc("review_intelligence_release", {
        p_release_id: input.release_id, p_decision: input.decision, p_note: (input.note as string | undefined)?.trim() || null,
      });
      if (error) return fail(error.message);
      return ok(data);
    }

    case "distribute_to_calendar":
      return invokeFn(userClient, "distribute-content-items-to-calendar", {
        client_id: clientId, items: input.items, start_date: input.start_date, end_date: input.end_date,
      });

    case "generate_production_brief":
      if (!MASTER_TABLES.has(input.source_table as string)) return fail("source_table must be organic_master, story_master, or ads_master.");
      return invokeFn(userClient, "generate-production-brief", {
        client_id: clientId, execution_month: input.execution_month,
        source_table: input.source_table, source_row_id: input.source_row_id, source_ref: input.source_ref,
        production_mode: input.production_mode ?? undefined,
      });

    case "approve_production_brief": {
      const { data, error } = await userClient.from("client_production_briefs")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", input.production_brief_id).select("id, status").maybeSingle();
      if (error) return fail(error.message);
      if (!data) return fail("Production brief not found or not visible to this client.");
      return ok(data);
    }

    case "generate_ai_asset":
      return await generateAiAsset(userClient, clientId, input);

    case "regenerate_asset_frame":
      return invokeFn(userClient, "regenerate-asset-frame", { client_asset_id: input.client_asset_id });

    case "approve_asset_group": {
      const { error } = await userClient.rpc("review_asset_group", {
        p_client_id: clientId, p_asset_group_ref: input.asset_group_ref, p_status: "approved",
      });
      if (error) return fail(error.message);
      return ok({ asset_group_ref: input.asset_group_ref, status: "approved" });
    }

    case "reject_asset_group": {
      const { error } = await userClient.rpc("review_asset_group", {
        p_client_id: clientId, p_asset_group_ref: input.asset_group_ref, p_status: "rejected",
      });
      if (error) return fail(error.message);
      return ok({ asset_group_ref: input.asset_group_ref, status: "rejected" });
    }

    case "attach_asset_to_ad_creative":
      return invokeFn(userClient, "attach-asset-to-ad-creative", {
        client_id: clientId, asset_group_ref: input.asset_group_ref,
      });

    case "create_ad_opportunity":
      return invokeFn(userClient, "create-ad-opportunity", {
        client_id: clientId, title: input.title, origin: input.origin,
        core_claim: input.core_claim ?? undefined, offer_ref: input.offer_ref ?? undefined, notes: input.notes ?? undefined,
        generated_by: "ai",
      });

    case "create_ad_brief":
      return invokeFn(userClient, "manage-ad-brief", {
        client_id: clientId, action: "create",
        ad_opportunity_id: input.ad_opportunity_id, brief_body: input.brief_body,
      });

    case "review_ad_brief":
      return invokeFn(userClient, "manage-ad-brief", {
        client_id: clientId, action: input.action, ad_brief_id: input.ad_brief_id,
        proof_item_id: input.proof_item_id ?? undefined, feedback: input.feedback ?? undefined,
      });

    case "generate_ad_creative_variants":
      return invokeFn(userClient, "generate-ad-creative-variants", {
        client_id: clientId, ad_brief_id: input.ad_brief_id, formats: input.formats,
      });

    case "create_ad_campaign":
      return invokeFn(userClient, "create-ad-campaign", {
        client_id: clientId, ad_brief_id: input.ad_brief_id, name: input.name, objective: input.objective,
        budget_daily: input.budget_daily ?? undefined, budget_total: input.budget_total ?? undefined,
        selected_variant_ids: input.selected_variant_ids,
      });

    case "launch_ad_campaign":
      return invokeFn(userClient, "launch-ad-campaign", {
        client_id: clientId, ad_campaign_id: input.ad_campaign_id,
        requested_geographies: input.requested_geographies ?? [], requested_audience_flags: input.requested_audience_flags ?? [],
      });

    case "schedule_distribution": {
      const { data, error } = await userClient.rpc("schedule_distribution_record", {
        p_record_id: input.distribution_record_id, p_scheduled_at: input.scheduled_at,
        p_timezone: input.timezone ?? null, p_planned_date: null,
      });
      if (error) return fail(error.message);
      return ok(data);
    }

    case "publish_distribution_now":
      return invokeFn(userClient, "publish-instagram-asset", {
        distribution_record_id: input.distribution_record_id, mode: "publish_now", payload_overrides: {},
      });

    case "retry_distribution": {
      const { data, error } = await userClient.rpc("retry_distribution_record", {
        p_record_id: input.distribution_record_id, p_override_permanent: false,
      });
      if (error) return fail(error.message);
      return ok(data);
    }

    default:
      return fail(`Unknown tool: ${toolName}`);
  }
}

/** Prepares (or resumes) an Intelligence Agent run and drives its steps as far as a bounded sub-budget allows. */
async function driveIntelligenceAgent(userClient: SupabaseClient, clientId: string, domain: string): Promise<JarvisToolResult> {
  const fnName = `run-${domain.replace(/_/g, "-")}`;
  const prepared = await userClient.functions.invoke(fnName, { body: { action: "prepare", client_id: clientId } });
  if (prepared.error) return fail(`${fnName} prepare failed: ${prepared.error.message}`);
  const researchRunId = (prepared.data as { research_run_id?: string }).research_run_id;
  if (!researchRunId) return ok({ ...prepared.data, note: "No run to advance (likely blocked on missing approved context)." });

  const SUB_BUDGET_MS = 60_000;
  const startedAt = Date.now();
  let last: unknown = prepared.data;
  for (let guard = 0; guard < 30 && Date.now() - startedAt < SUB_BUDGET_MS; guard += 1) {
    const stepped = await userClient.functions.invoke(fnName, { body: { action: "step", client_id: clientId, research_run_id: researchRunId } });
    if (stepped.error) return fail(`${fnName} step failed: ${stepped.error.message}`);
    last = stepped.data;
    const data = stepped.data as { terminal?: boolean; progress?: { completed: number; failed: number; total: number } };
    if (data.terminal) {
      const finalized = await userClient.functions.invoke(fnName, { body: { action: "finalize", client_id: clientId, research_run_id: researchRunId } });
      if (finalized.error) return fail(`${fnName} finalize failed: ${finalized.error.message}`);
      return ok({ ...finalized.data, note: "Release created at needs_review — call approve_intelligence_release to move it forward." });
    }
  }
  return ok({ ...(last as Record<string, unknown>), continues: true, note: `${domain} is still running — call run_intelligence_agent again with the same domain to keep advancing it.` });
}

/** Dispatches to the correct AI production path by the brief's own asset_format. */
async function generateAiAsset(userClient: SupabaseClient, clientId: string, input: Record<string, unknown>): Promise<JarvisToolResult> {
  const briefId = input.production_brief_id as string;
  const { data: brief, error } = await userClient.from("client_production_briefs")
    .select("id, asset_format, status").eq("id", briefId).maybeSingle();
  if (error) return fail(error.message);
  if (!brief) return fail("Production brief not found.");
  if (brief.status !== "approved") return fail("The production brief must be approved before it can be produced.");

  if (brief.asset_format === "reel_video") {
    return fail("reel_video briefs are never AI-produced here — Reel Studio is human-directed. Ask a human to create the Reel Studio project.");
  }

  const visualBody = {
    production_brief_id: briefId,
    visual_mode: input.visual_mode ?? "text_only",
    visual_instructions: input.visual_instructions ?? undefined,
  };

  if (brief.asset_format === "feed_post") return invokeFn(userClient, "generate-feed-post-asset", visualBody);
  if (brief.asset_format === "ad_static") return invokeFn(userClient, "generate-ad-static-asset", visualBody);

  // carousel / story_sequence -- persisted job model, driven one slide at a time.
  let jobId = input.generation_job_id as string | undefined;
  if (!jobId) {
    const started = await userClient.functions.invoke("start-carousel-generation", { body: visualBody });
    if (started.error) return fail(`start-carousel-generation failed: ${started.error.message}`);
    jobId = (started.data as { job?: { id?: string } }).job?.id;
    if (!jobId) return fail("start-carousel-generation did not return a job id.");
  }

  const SUB_BUDGET_MS = 60_000;
  const startedAt = Date.now();
  let last: unknown = null;
  for (let guard = 0; guard < 30 && Date.now() - startedAt < SUB_BUDGET_MS; guard += 1) {
    const slide = await userClient.functions.invoke("generate-carousel-slide", { body: { generation_job_id: jobId } });
    if (slide.error) return fail(`generate-carousel-slide failed: ${slide.error.message}`);
    last = slide.data;
    const progress = slide.data as { terminal?: boolean };
    if (progress.terminal) return ok(progress);
  }
  return ok({ ...(last as Record<string, unknown>), generation_job_id: jobId, continues: true, note: "Still generating — call generate_ai_asset again with this generation_job_id to keep advancing it." });
}
