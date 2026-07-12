// generate-phase-1 — Attract Acquisition Cockpit
//
// PREPARATION ONLY. Validates the client and inputs, verifies the AI gate and
// Anthropic key, logs phase_1_generation_started, and returns the 21 canonical
// file definitions for the frontend to generate sequentially via
// generate-phase-1-file. It does NOT call Anthropic and does NOT write context
// files. finalize-phase-1 sets stage1_status = complete after all 21 exist.
//
// Split design rationale: Supabase edge functions enforce a hard ~150s
// wall-clock limit per invocation. Generating all 21 files in one model call
// exceeds it; one file per invocation completes well inside it.
//
// When AA_AI_GENERATION_ENABLED is absent/false: returns mode "contract_ready"
// (no writes, no AI call).
//
// Core law: never fabricate context, proof, strategy, or client facts.

import { svc, json, cors } from "../_shared/aa.ts";
import { isAiEnabled, hasAnthropicKey } from "../_shared/anthropic.ts";

// Must stay in sync with CONTEXT_FILE_DEFS in src/types/phase.ts and
// generate-phase-1-file/index.ts
const CONTEXT_FILE_DEFS = [
  { number: 0,  file_name: "00_Master_Client_Context.md",                 title: "Master Client Context" },
  { number: 1,  file_name: "01_Business_Context.md",                      title: "Business Context" },
  { number: 2,  file_name: "02_Avatar_And_Buyer_Psychology.md",            title: "Avatar & Buyer Psychology" },
  { number: 3,  file_name: "03_Offer_And_Sales_Context.md",                title: "Offer & Sales Context" },
  { number: 4,  file_name: "04_Proof_Bank.md",                             title: "Proof Bank" },
  { number: 5,  file_name: "05_Proof_Gap_Report.md",                       title: "Proof Gap Report" },
  { number: 6,  file_name: "06_Positioning_And_Angle_Map.md",              title: "Positioning & Angle Map" },
  { number: 7,  file_name: "07_Brand_Voice_And_Style_Guide.md",            title: "Brand Voice & Style Guide" },
  { number: 8,  file_name: "08_Profile_Funnel_Context.md",                 title: "Profile Funnel Context" },
  { number: 9,  file_name: "09_Content_System.md",                         title: "Content System" },
  { number: 10, file_name: "10_Story_System.md",                           title: "Story System" },
  { number: 11, file_name: "11_Ad_System.md",                              title: "Ad System" },
  { number: 12, file_name: "12_Website_And_Landing_Page_Context.md",       title: "Website & Landing Page Context" },
  { number: 13, file_name: "13_Distribution_System.md",                    title: "Distribution System" },
  { number: 14, file_name: "14_Automation_And_AI_Instructions.md",         title: "Automation & AI Instructions" },
  { number: 15, file_name: "15_Content_Calendar.md",                       title: "Content Calendar" },
  { number: 16, file_name: "16_Performance_Report.md",                     title: "Performance Report" },
  { number: 17, file_name: "17_Iteration_Log.md",                          title: "Iteration Log" },
  { number: 18, file_name: "18_Client_Comms_And_Approval_Context.md",      title: "Client Comms & Approval Context" },
  { number: 19, file_name: "19_Sales_Enablement_Assets.md",                title: "Sales Enablement Assets" },
  { number: 20, file_name: "20_Retention_Upsell_And_Expansion_Context.md", title: "Retention, Upsell & Expansion Context" },
] as const;

// The three fields whose absence hard-blocks Phase 1 generation.
const REQUIRED_FIELDS: Array<{ field: string; label: string }> = [
  { field: "business_description", label: "Business Overview" },
  { field: "offer_details",        label: "Offer / Services" },
  { field: "target_customer",      label: "Ideal Customer" },
];

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
  if (error) console.error("[generate-phase-1] activity_log:", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ ok: false, mode: "error", message: "POST only", warnings: [], missingInputs: [] }, 405);
  }

  try {
    const body = await req.json() as { client_id?: string };
    const clientId = body?.client_id;
    if (!clientId || typeof clientId !== "string") {
      return json({ ok: false, mode: "error", message: "client_id required", warnings: [], missingInputs: [] }, 400);
    }

    const sb = svc();

    // 1. Validate client exists
    const { data: client, error: clientErr } = await sb
      .from("clients")
      .select("id, name, package_tier, stage1_status")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr || !client) {
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: "Client not found.",
        warnings: [], missingInputs: [], error: clientErr?.message ?? "not found",
      }, 404);
    }

    await writeActivity(sb, clientId, "phase_1_requested", `Phase 1 requested for "${client.name}".`);

    // 2. Load client_inputs
    const { data: inputs, error: inputsErr } = await sb
      .from("client_inputs")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle();

    if (inputsErr) {
      await writeActivity(sb, clientId, "phase_1_error",
        `Phase 1 error loading client inputs: ${inputsErr.message}`);
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: "Failed to load client inputs.",
        warnings: [], missingInputs: [], error: inputsErr.message,
      }, 500);
    }

    // 3. Determine required input completeness
    const missingInputs: string[] = [];
    for (const { field, label } of REQUIRED_FIELDS) {
      const val = (inputs as Record<string, unknown> | null)?.[field];
      if (!val || (typeof val === "string" && val.trim() === "")) {
        missingInputs.push(label);
      }
    }

    // 4. Block if required inputs are missing
    if (missingInputs.length > 0) {
      const msg = `Phase 1 blocked: required inputs missing (${missingInputs.join(", ")}). Complete the Context Inputs section first.`;
      await writeActivity(sb, clientId, "phase_1_blocked_missing_inputs", msg, { missing_inputs: missingInputs });
      return json({
        ok: false, mode: "blocked", client_id: clientId,
        message: msg, warnings: [], missingInputs,
      });
    }

    // 5. Check AI generation gate
    if (!isAiEnabled()) {
      const msg = "Phase 1 server contract is ready. Required inputs are present. AI generation is not enabled in this build — set AA_AI_GENERATION_ENABLED=true and ANTHROPIC_API_KEY to produce the 21 context files.";
      await writeActivity(sb, clientId, "phase_1_contract_ready", msg);
      return json({
        ok: true, mode: "contract_ready", client_id: clientId,
        message: msg,
        warnings: [
          "AA_AI_GENERATION_ENABLED is not true. No context files have been created.",
          "stage1_status has NOT been set to complete. It will only be set after real generation succeeds.",
        ],
        missingInputs: [],
        data: {
          required_inputs_present: true,
          expected_files: CONTEXT_FILE_DEFS.length,
          ai_enabled: false,
          note: "No context files written. No fake content generated.",
        },
      });
    }

    // 6. Check API key — fail closed
    if (!hasAnthropicKey()) {
      const msg = "AA_AI_GENERATION_ENABLED is true but ANTHROPIC_API_KEY is not set. Cannot generate context files. Add the secret to the function environment.";
      await writeActivity(sb, clientId, "phase_1_error", msg);
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: msg, warnings: [], missingInputs: [],
        error: "ANTHROPIC_API_KEY missing",
      }, 500);
    }

    // 7. Preparation complete — hand off to sequential per-file generation.
    //    stage1_status is intentionally left unchanged here: the frontend
    //    orchestrates the 21 generate-phase-1-file calls, and finalize-phase-1
    //    sets `complete`. Leaving it out of "running" keeps a mid-run failure
    //    recoverable (the Run Phase 1 button stays enabled for a retry).
    await writeActivity(sb, clientId, "phase_1_generation_started",
      `Phase 1 generation prepared for "${client.name}". ${CONTEXT_FILE_DEFS.length} files will be generated sequentially.`,
      { total_files: CONTEXT_FILE_DEFS.length });

    return json({
      ok: true,
      mode: "generation_started",
      client_id: clientId,
      message: "Phase 1 generation prepared. Generate files sequentially.",
      warnings: [],
      missingInputs: [],
      data: {
        total_files: CONTEXT_FILE_DEFS.length,
        files: CONTEXT_FILE_DEFS.map((d) => ({ file_number: d.number, file_name: d.file_name })),
      },
    });

  } catch (e) {
    return json({
      ok: false, mode: "error",
      message: `Unexpected server error: ${String(e)}`,
      warnings: [], missingInputs: [], error: String(e),
    }, 500);
  }
});
