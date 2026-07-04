// generate-phase-2 — Attract Acquisition Cockpit
//
// Real final behaviour:
//   21 approved/generated client_context_files → full Stage 2 execution pack as
//   needs_review draft rows across organic_master, story_master, ads_master,
//   proof_master, asset_brief_index, calendar_cells, and client_execution_files.
//
// Batch C safe behaviour: full server-side contract and validation envelope.
// AI generation requires AA_AI_GENERATION_ENABLED=true (NOT set by default).
// When disabled, returns mode: "contract_ready" and writes nothing.
//
// Approval law: ALL generated rows must land as review_state = needs_review.
// Nothing becomes Scheduled / Live / Published / automation-eligible without
// explicit human approval. This function never bypasses that gate.
//
// Core law: never fabricate strategy, organic plans, ad stints, proof, or
// calendar items. If context files are absent or AI is disabled, fail safely.

import { svc, json, cors } from "../_shared/aa.ts";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Minimum number of context files that must be in a usable state before Phase 2 can run.
// "Usable" = status is not "not_started" (anything generated/in_review/approved qualifies).
const MIN_CONTEXT_FILES_REQUIRED = 5;

const USABLE_STATUSES = new Set(["generated", "needs_review", "approved", "needs_client_input"]);

async function writeActivity(
  sb: ReturnType<typeof svc>,
  clientId: string,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await sb.from("activity_log").insert({
    client_id: clientId,
    event_type: eventType,
    plain_english_message: message,
    metadata,
  });
  if (error) console.error("[generate-phase-2] activity_log:", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, mode: "error", message: "POST only", warnings: [], missingContextFiles: [] }, 405);

  try {
    const body = await req.json() as { client_id?: string; execution_month?: string };
    const clientId = body?.client_id;
    const executionMonth = body?.execution_month;

    if (!clientId || typeof clientId !== "string") {
      return json({ ok: false, mode: "error", message: "client_id required", warnings: [], missingContextFiles: [] }, 400);
    }
    if (!executionMonth || !MONTH_RE.test(executionMonth)) {
      return json({ ok: false, mode: "error", client_id: clientId, message: "execution_month required in YYYY-MM format", warnings: [], missingContextFiles: [] }, 400);
    }

    const sb = svc();

    // 1. Validate client exists
    const { data: client, error: clientErr } = await sb
      .from("clients")
      .select("id, name, stage1_status, stage2_status")
      .eq("id", clientId)
      .maybeSingle();
    if (clientErr || !client) {
      return json({ ok: false, mode: "error", client_id: clientId, message: "Client not found.", warnings: [], missingContextFiles: [], error: clientErr?.message ?? "not found" }, 404);
    }

    await writeActivity(sb, clientId, "phase_2_requested", `Phase 2 requested for "${client.name}" — month ${executionMonth}.`);

    // 2. Load context files
    const { data: contextFiles, error: ctxErr } = await sb
      .from("client_context_files")
      .select("file_number, file_name, status")
      .eq("client_id", clientId)
      .order("file_number");
    if (ctxErr) {
      await writeActivity(sb, clientId, "phase_2_error", `Phase 2 error loading context files: ${ctxErr.message}`);
      return json({ ok: false, mode: "error", client_id: clientId, message: "Failed to load context files.", warnings: [], missingContextFiles: [], error: ctxErr.message }, 500);
    }

    // 3. Determine context file readiness
    const usable = (contextFiles ?? []).filter(
      (f: { status: string }) => USABLE_STATUSES.has(f.status),
    );
    const missingContextFiles = (contextFiles ?? [])
      .filter((f: { status: string }) => !USABLE_STATUSES.has(f.status))
      .map((f: { file_name: string }) => f.file_name);

    const hasEnoughContext =
      client.stage1_status === "complete" || usable.length >= MIN_CONTEXT_FILES_REQUIRED;

    // 4. Block if insufficient context exists
    if (!hasEnoughContext) {
      const msg = `Phase 2 blocked: only ${usable.length} of 21 context files are generated or reviewed (minimum ${MIN_CONTEXT_FILES_REQUIRED} required). Complete Phase 1 first.`;
      await writeActivity(sb, clientId, "phase_2_blocked_missing_context", msg, {
        usable_count: usable.length,
        missing_files: missingContextFiles,
      });
      return json({
        ok: false,
        mode: "blocked",
        client_id: clientId,
        execution_month: executionMonth,
        message: msg,
        warnings: [],
        missingContextFiles,
      });
    }

    // 5. Check AI generation flag
    const aiEnabled = (Deno.env.get("AA_AI_GENERATION_ENABLED") ?? "false").toLowerCase() === "true";

    if (!aiEnabled) {
      const msg = `Phase 2 server contract is ready for ${executionMonth}. ${usable.length} context files are available. AI generation is not enabled in this build — set AA_AI_GENERATION_ENABLED=true and implement the AI generation path to write draft Stage 2 rows.`;
      await writeActivity(sb, clientId, "phase_2_contract_ready", msg, {
        execution_month: executionMonth,
        usable_context_files: usable.length,
      });

      const warnings: string[] = [
        "AA_AI_GENERATION_ENABLED is not true. No Stage 2 rows have been written.",
        "stage2_status has NOT been set to complete. It will only be set after real generation succeeds.",
      ];
      if (usable.length < 21) {
        warnings.push(`${21 - usable.length} context files are still in not_started state — they will be treated as gaps in Phase 2 generation.`);
      }

      return json({
        ok: true,
        mode: "contract_ready",
        client_id: clientId,
        execution_month: executionMonth,
        message: msg,
        warnings,
        missingContextFiles,
        data: {
          usable_context_files: usable.length,
          expected_context_files: 21,
          ai_enabled: false,
          stage1_status: client.stage1_status,
          note: "No Stage 2 rows written. No fake content generated.",
        },
      });
    }

    // 6. AI generation path — TODO: implement in Batch D+
    //
    // When AA_AI_GENERATION_ENABLED=true:
    //   a. Run validate-execution-pack first. Block on hard validation failures.
    //   b. Load: authority files, Phase 2 templates, Phase 2 examples, context files,
    //      prior pipeline_metrics_daily, prior client_execution_files (if any).
    //   c. Generate the Stage 2 execution pack:
    //      - client_execution_files: narrative docs (status = "needs_review")
    //      - organic_master rows:   review_state = "needs_review", status = "Idea"
    //      - story_master rows:     review_state = "needs_review", status = "Idea"
    //      - ads_master rows:       review_state = "needs_review", status = "Planned"
    //      - proof_master rows:     review_state = "needs_review", status = "Requested"
    //      - asset_brief_index rows: status (review_state) = "needs_review"
    //      - calendar_cells:         review_state = "needs_review"
    //   d. Generate app-level ref codes via generate-ref (atomic, server-side).
    //   e. Re-run validate-execution-pack after writes. Rollback if hard failures.
    //   f. Update clients.stage2_status = "complete" ONLY after all rows pass validation.
    //   g. Log phase_2_generated with counts.
    //
    // APPROVAL LAW: no generated row may be Scheduled/Live/Published/automation-eligible.
    // All rows start as review_state = needs_review. Human approval is required for each.
    await writeActivity(sb, clientId, "phase_2_error", "Phase 2 AI generation path reached but not yet implemented (Batch D+).");
    return json({
      ok: false,
      mode: "error",
      client_id: clientId,
      execution_month: executionMonth,
      message: "AI generation is enabled but the generation path is not yet implemented. Implement generate-phase-2 AI logic in Batch D+.",
      warnings: ["AI generation path requires Batch D+ implementation."],
      missingContextFiles: [],
    }, 501);

  } catch (e) {
    return json({ ok: false, mode: "error", message: `Unexpected server error: ${String(e)}`, warnings: [], missingContextFiles: [], error: String(e) }, 500);
  }
});
