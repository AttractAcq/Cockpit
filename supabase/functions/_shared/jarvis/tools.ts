// Master AI ("Jarvis") — the bounded v1 tool surface.
//
// Every tool falls into exactly one gate tier, checked by the dispatcher
// before execution, never by the model itself:
//
//   'free'   — read-only, or an internal action with no real-world/financial
//              consequence (ingest, run an agent, generate a brief/asset).
//   'toggle' — an internal review-gate action (approve/reject a Source,
//              Brief, asset group, Ad Opportunity/Brief/Campaign draft).
//              Executes immediately only when the run's autonomous_mode
//              snapshot is true; otherwise becomes a pending action.
//   'floor'  — a real-world-facing action (launching a paid ad campaign,
//              publishing or scheduling a real post). ALWAYS a pending
//              action, regardless of autonomous_mode. This tier is not
//              configurable by any settings row — it is this hardcoded list.
//
// Deliberately out of scope for v1 (noted here, not silently omitted):
// promoting an approved ORGANIC asset group to Distribution has no edge-
// function wrapper today (it's a multi-call client-side orchestration in
// src/lib/api.ts) — Jarvis can approve an asset group, but a human still
// promotes it via the Assets tab afterward. The PAID equivalent
// (attach_asset_to_ad_creative) is a real edge function and is included.

export type JarvisToolGate = "free" | "toggle" | "floor";

export const JARVIS_TOOL_GATES: Record<string, JarvisToolGate> = {
  list_pending_sources: "free",
  list_content_items_needing_review: "free",
  list_production_briefs_needing_review: "free",
  list_asset_groups_needing_review: "free",
  // Cockpit v3 Step 5 — cross-department reads (Sales, Finance, Opportunity
  // OS), all read-only, so all 'free' like every other list_* tool above.
  // No write/execution tool for any of these three departments yet —
  // deliberately: this step's own text defers gated execution until
  // read/recommend has real usage first.
  list_sales_pipeline: "free",
  list_finance_periods: "free",
  list_opportunity_findings: "free",
  add_manual_idea: "free",
  add_proof: "free",
  run_ideation: "free",
  score_ideation_candidates: "free",
  run_intelligence_agent: "free",
  retry_intelligence_step: "free",
  generate_production_brief: "free",
  generate_ai_asset: "free",
  regenerate_asset_frame: "free",

  approve_source: "toggle",
  reject_source: "toggle",
  approve_intelligence_release: "toggle",
  approve_production_brief: "toggle",
  distribute_to_calendar: "toggle",
  approve_asset_group: "toggle",
  reject_asset_group: "toggle",
  attach_asset_to_ad_creative: "toggle",
  create_ad_opportunity: "toggle",
  create_ad_brief: "toggle",
  review_ad_brief: "toggle",
  generate_ad_creative_variants: "toggle",
  create_ad_campaign: "toggle",

  launch_ad_campaign: "floor",
  schedule_distribution: "floor",
  publish_distribution_now: "floor",
  retry_distribution: "floor",
};

export const JARVIS_TOOLS: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> = [
  {
    name: "list_pending_sources",
    description: "List content_sources rows awaiting review in Content Supply (pending/processing/failed). Use before approving or rejecting Sources.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_content_items_needing_review",
    description: "List organic_master/story_master rows at status needs_review — Content Items awaiting review before a brief is generated.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_production_briefs_needing_review",
    description: "List client_production_briefs rows at status needs_review, awaiting approval before production.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_asset_groups_needing_review",
    description: "List produced client_assets groups at status needs_review, awaiting approval.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "add_manual_idea",
    description: "Add a manually-typed content idea to Sources. Does not generate or schedule anything by itself.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short name for the idea, 1-400 chars." },
        body: { type: "string", description: "The idea itself, captured verbatim." },
        notes: { type: "string" },
        source_url: { type: "string" },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "add_proof",
    description: "Add a proof/evidence item (testimonial, result, case study, metric, credential, artefact) to Sources. Enters unverified with no consent recorded.",
    input_schema: {
      type: "object",
      properties: {
        claim: { type: "string", description: "What this proof demonstrates." },
        proof_kind: { type: "string", enum: ["testimonial", "result", "case_study", "metric", "credential", "artefact"] },
        detail: { type: "string", description: "What happened, who for, what changed." },
        source_url: { type: "string" },
      },
      required: ["claim", "proof_kind", "detail"],
      additionalProperties: false,
    },
  },
  {
    name: "run_ideation",
    description: "Run the AI ideation cycle (7 research techniques) for a period. Scored candidates land in Sources automatically once scoring completes separately.",
    input_schema: {
      type: "object",
      properties: {
        period_type: { type: "string", enum: ["one_day", "one_week", "date_range", "one_month"] },
        start_date: { type: "string", description: "YYYY-MM-DD, required for one_day/one_week/date_range." },
        end_date: { type: "string", description: "YYYY-MM-DD, required for date_range." },
        month: { type: "string", description: "YYYY-MM, required for one_month." },
      },
      required: ["period_type"],
      additionalProperties: false,
    },
  },
  {
    name: "score_ideation_candidates",
    description: "Score and rank the candidates from an ideation cycle. Scored candidates automatically enter Sources for review.",
    input_schema: {
      type: "object",
      properties: { ideation_cycle_id: { type: "string" } },
      required: ["ideation_cycle_id"],
      additionalProperties: false,
    },
  },
  {
    name: "run_intelligence_agent",
    description: "Advance an Intelligence Agent run (Market OS, Avatar OS, or Competitor OS) as far as fits in one call — prepares a run if none is open, then drives it through its research steps. Call again with the same domain to keep advancing a long-running build across multiple turns; it resumes rather than restarting. Never auto-approves the resulting release — that always needs approve_intelligence_release.",
    input_schema: {
      type: "object",
      properties: { domain: { type: "string", enum: ["market_os", "avatar_os", "competitor_os"] } },
      required: ["domain"],
      additionalProperties: false,
    },
  },
  {
    name: "retry_intelligence_step",
    description: "Retry one failed step of an Intelligence Agent run.",
    input_schema: {
      type: "object",
      properties: {
        domain: { type: "string", enum: ["market_os", "avatar_os", "competitor_os"] },
        research_run_id: { type: "string" },
        step_id: { type: "string" },
      },
      required: ["domain", "research_run_id", "step_id"],
      additionalProperties: false,
    },
  },
  {
    name: "approve_source",
    description: "Approve a Content Supply Source (manual idea, proof, or scored ideation candidate) into an unscheduled Content Items row.",
    input_schema: {
      type: "object",
      properties: {
        content_source_id: { type: "string" },
        asset_type: { type: "string", enum: ["reel", "carousel", "static", "story"], description: "Required for manual_idea/proof_item sources; ignored for scored ideation candidates." },
      },
      required: ["content_source_id"],
      additionalProperties: false,
    },
  },
  {
    name: "reject_source",
    description: "Disapprove a Content Supply Source. It will not enter Content Items.",
    input_schema: {
      type: "object",
      properties: { content_source_id: { type: "string" }, reason: { type: "string" } },
      required: ["content_source_id"],
      additionalProperties: false,
    },
  },
  {
    name: "approve_intelligence_release",
    description: "Review an Intelligence Agent release: approve, request changes, or reject.",
    input_schema: {
      type: "object",
      properties: {
        release_id: { type: "string" },
        decision: { type: "string", enum: ["approved", "changes_requested", "rejected"] },
        note: { type: "string" },
      },
      required: ["release_id", "decision"],
      additionalProperties: false,
    },
  },
  {
    name: "distribute_to_calendar",
    description: "Auto-schedule selected, approved, unscheduled Content Items onto the Calendar using the Execution Files quantity contract.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { table: { type: "string", enum: ["organic_master", "story_master"] }, ref: { type: "string" } },
            required: ["table", "ref"],
            additionalProperties: false,
          },
        },
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["items", "start_date", "end_date"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_production_brief",
    description: "Generate (or regenerate) a production brief for a Content Item.",
    input_schema: {
      type: "object",
      properties: {
        source_table: { type: "string", enum: ["organic_master", "story_master", "ads_master"] },
        source_row_id: { type: "string" },
        source_ref: { type: "string" },
        execution_month: { type: "string", description: "YYYY-MM" },
        production_mode: { type: "string" },
      },
      required: ["source_table", "source_row_id", "source_ref", "execution_month"],
      additionalProperties: false,
    },
  },
  {
    name: "approve_production_brief",
    description: "Approve a production brief so it can be produced.",
    input_schema: {
      type: "object",
      properties: { production_brief_id: { type: "string" } },
      required: ["production_brief_id"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_ai_asset",
    description: "Produce an approved production brief with AI (single-shot for feed_post/ad_static, or starts the persisted job for carousel/story_sequence — call again with the returned job to keep driving it). Never available for reel_video (Reel Studio only, human-directed).",
    input_schema: {
      type: "object",
      properties: {
        production_brief_id: { type: "string" },
        visual_mode: { type: "string", enum: ["text_only", "uploaded_background", "uploaded_insert"] },
        visual_instructions: { type: "string" },
        generation_job_id: { type: "string", description: "Set when continuing an in-progress carousel/story job." },
      },
      required: ["production_brief_id"],
      additionalProperties: false,
    },
  },
  {
    name: "regenerate_asset_frame",
    description: "Regenerate one asset frame from its stored prompt (creates a new version).",
    input_schema: {
      type: "object",
      properties: { client_asset_id: { type: "string" } },
      required: ["client_asset_id"],
      additionalProperties: false,
    },
  },
  {
    name: "approve_asset_group",
    description: "Approve a produced asset group. Does not itself promote it to Distribution or Ad Studio — for a paid (ads_master-origin) group, follow with attach_asset_to_ad_creative; an organic group still needs a human to promote it from the Assets tab.",
    input_schema: {
      type: "object",
      properties: { asset_group_ref: { type: "string" } },
      required: ["asset_group_ref"],
      additionalProperties: false,
    },
  },
  {
    name: "reject_asset_group",
    description: "Reject a produced asset group.",
    input_schema: {
      type: "object",
      properties: { asset_group_ref: { type: "string" } },
      required: ["asset_group_ref"],
      additionalProperties: false,
    },
  },
  {
    name: "attach_asset_to_ad_creative",
    description: "Attach an approved paid (ads_master-origin) asset group into Ad Studio as a real image creative, finding or creating the Ad Opportunity + Brief for its Calendar ref. The resulting Brief always starts at draft.",
    input_schema: {
      type: "object",
      properties: { asset_group_ref: { type: "string" } },
      required: ["asset_group_ref"],
      additionalProperties: false,
    },
  },
  {
    name: "create_ad_opportunity",
    description: "Create a new Ad Opportunity in Ad Studio.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        origin: { type: "string", enum: ["manual_idea", "proof", "research", "campaign_requirement", "organic_winner", "performance_insight", "offer_launch", "seasonal_trigger"] },
        core_claim: { type: "string" },
        offer_ref: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "origin"],
      additionalProperties: false,
    },
  },
  {
    name: "create_ad_brief",
    description: "Create a draft Ad Brief for an Ad Opportunity. brief_body must be complete: campaign_objective, awareness_stage, audience, offer, landing_page, primary_claim, proof_required, hook_variants (>=1), visual_variants (>=1), copy_variants (>=1), cta_variants (>=1), placement (>=1), testing_role, attribution_requirements {pixel_id, conversion_event}. Use \"needs_client_input\" for any field with no real answer yet rather than inventing one.",
    input_schema: {
      type: "object",
      properties: {
        ad_opportunity_id: { type: "string" },
        brief_body: { type: "object", description: "AdBriefBody — see tool description for required shape." },
      },
      required: ["ad_opportunity_id", "brief_body"],
      additionalProperties: false,
    },
  },
  {
    name: "review_ad_brief",
    description: "Move an Ad Brief through its review lifecycle: submit_for_review, approve, or request_changes.",
    input_schema: {
      type: "object",
      properties: {
        ad_brief_id: { type: "string" },
        action: { type: "string", enum: ["submit_for_review", "approve", "request_changes"] },
        proof_item_id: { type: "string", description: "Required to approve a brief that self-flags proof_required." },
        feedback: { type: "string", description: "Required (>=8 chars) for request_changes." },
      },
      required: ["ad_brief_id", "action"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_ad_creative_variants",
    description: "Generate the Hooks x Visuals x Copy x CTA x Format creative matrix for an approved Ad Brief.",
    input_schema: {
      type: "object",
      properties: {
        ad_brief_id: { type: "string" },
        formats: { type: "array", items: { type: "string" } },
      },
      required: ["ad_brief_id", "formats"],
      additionalProperties: false,
    },
  },
  {
    name: "create_ad_campaign",
    description: "Create a draft Ad Campaign from approved creative variants. Never calls Meta or spends money — everything starts at status draft. Launching is a separate, always-human-confirmed action.",
    input_schema: {
      type: "object",
      properties: {
        ad_brief_id: { type: "string" },
        name: { type: "string" },
        objective: { type: "string" },
        budget_daily: { type: "number" },
        budget_total: { type: "number" },
        selected_variant_ids: { type: "array", items: { type: "string" } },
      },
      required: ["ad_brief_id", "name", "objective", "selected_variant_ids"],
      additionalProperties: false,
    },
  },
  {
    name: "launch_ad_campaign",
    description: "Launch a draft Ad Campaign to Meta with real budget. ALWAYS requires human confirmation regardless of any setting — calling this creates a pending action and stops; it never launches immediately.",
    input_schema: {
      type: "object",
      properties: { ad_campaign_id: { type: "string" } },
      required: ["ad_campaign_id"],
      additionalProperties: false,
    },
  },
  {
    name: "schedule_distribution",
    description: "Schedule a distribution record to publish automatically at a future time. ALWAYS requires human confirmation regardless of any setting, since it hands off to the publishing worker with no further human click.",
    input_schema: {
      type: "object",
      properties: { distribution_record_id: { type: "string" }, scheduled_at: { type: "string" }, timezone: { type: "string" } },
      required: ["distribution_record_id", "scheduled_at"],
      additionalProperties: false,
    },
  },
  {
    name: "publish_distribution_now",
    description: "Publish a distribution record to Instagram immediately. ALWAYS requires human confirmation regardless of any setting.",
    input_schema: {
      type: "object",
      properties: { distribution_record_id: { type: "string" } },
      required: ["distribution_record_id"],
      additionalProperties: false,
    },
  },
  {
    name: "retry_distribution",
    description: "Retry a failed distribution record. ALWAYS requires human confirmation regardless of any setting, since a retry can result in a real publish.",
    input_schema: {
      type: "object",
      properties: { distribution_record_id: { type: "string" } },
      required: ["distribution_record_id"],
      additionalProperties: false,
    },
  },

  // Cockpit v3 Step 5 — cross-department reads. Each returns raw rows, same
  // convention as list_pending_sources/list_content_items_needing_review
  // above: no server-side pre-summarization, the model reasons over the
  // real rows itself.
  {
    name: "list_sales_pipeline",
    description: "List sales_leads for the business linked to this client (Sales is business-scoped, not client-scoped — resolved via the businesses table). Returns an empty list with a note if this client has no linked business, which is the common case.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_finance_periods",
    description: "List this client's client_finance_periods — both open and reconciled. Reconciled periods carry a permanent actual_revenue/total_cost/margin snapshot; open periods do not yet.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_opportunity_findings",
    description: "List this client's opportunity_os_findings (margin_risk/stalled_lead/underperforming_channel), most recent first, including their review status.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];
