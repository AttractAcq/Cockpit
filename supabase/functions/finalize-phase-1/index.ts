// finalize-phase-1 — Attract Acquisition Cockpit
//
// Completion gate for split Phase 1 generation. Performs NO AI calls and
// writes NO content. Verifies all 21 canonical Client Context OS files exist
// for the client with acceptable statuses, then sets
// clients.stage1_status = complete + stage1_completed_at and logs
// phase_1_generated. If any file is missing, returns mode "blocked" with the
// missing file_numbers and changes nothing.

import { svc, json, cors } from "../_shared/aa.ts";

// Must stay in sync with CONTEXT_FILE_DEFS in src/types/phase.ts
const CANONICAL_FILES: Array<{ number: number; file_name: string }> = [
  { number: 0,  file_name: "00_Master_Client_Context.md" },
  { number: 1,  file_name: "01_Business_Context.md" },
  { number: 2,  file_name: "02_Avatar_And_Buyer_Psychology.md" },
  { number: 3,  file_name: "03_Offer_And_Sales_Context.md" },
  { number: 4,  file_name: "04_Proof_Bank.md" },
  { number: 5,  file_name: "05_Proof_Gap_Report.md" },
  { number: 6,  file_name: "06_Positioning_And_Angle_Map.md" },
  { number: 7,  file_name: "07_Brand_Voice_And_Style_Guide.md" },
  { number: 8,  file_name: "08_Profile_Funnel_Context.md" },
  { number: 9,  file_name: "09_Content_System.md" },
  { number: 10, file_name: "10_Story_System.md" },
  { number: 11, file_name: "11_Ad_System.md" },
  { number: 12, file_name: "12_Website_And_Landing_Page_Context.md" },
  { number: 13, file_name: "13_Distribution_System.md" },
  { number: 14, file_name: "14_Automation_And_AI_Instructions.md" },
  { number: 15, file_name: "15_Content_Calendar.md" },
  { number: 16, file_name: "16_Performance_Report.md" },
  { number: 17, file_name: "17_Iteration_Log.md" },
  { number: 18, file_name: "18_Client_Comms_And_Approval_Context.md" },
  { number: 19, file_name: "19_Sales_Enablement_Assets.md" },
  { number: 20, file_name: "20_Retention_Upsell_And_Expansion_Context.md" },
];

// approved is allowed here: finalize may run after a human has already
// approved some files. It never SETS approved.
const ACCEPTABLE_STATUS = new Set(["needs_review", "needs_client_input", "approved"]);

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
  if (error) console.error("[finalize-phase-1] activity_log:", error.message);
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
      .select("id, name, stage1_status")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr || !client) {
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: "Client not found.",
        warnings: [], missingInputs: [], error: clientErr?.message ?? "not found",
      }, 404);
    }

    // 2. Load all context files for the client
    const { data: files, error: filesErr } = await sb
      .from("client_context_files")
      .select("file_number, file_name, status")
      .eq("client_id", clientId);

    if (filesErr) {
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: "Failed to load context files.",
        warnings: [], missingInputs: [], error: filesErr.message,
      }, 500);
    }

    // 3. Verify all 21 canonical file_numbers exist with acceptable statuses
    const byNumber = new Map<number, { file_name: string; status: string }>();
    for (const f of files ?? []) {
      byNumber.set(f.file_number as number, {
        file_name: f.file_name as string,
        status: f.status as string,
      });
    }

    const missingFileNumbers: number[] = [];
    const badStatus: Array<{ file_number: number; status: string }> = [];
    for (const def of CANONICAL_FILES) {
      const row = byNumber.get(def.number);
      if (!row) {
        missingFileNumbers.push(def.number);
        continue;
      }
      if (!ACCEPTABLE_STATUS.has(row.status)) {
        badStatus.push({ file_number: def.number, status: row.status });
      }
    }

    if (missingFileNumbers.length > 0 || badStatus.length > 0) {
      const parts: string[] = [];
      if (missingFileNumbers.length > 0) parts.push(`missing file(s): ${missingFileNumbers.join(", ")}`);
      if (badStatus.length > 0) parts.push(`unacceptable status: ${badStatus.map((b) => `#${b.file_number}=${b.status}`).join(", ")}`);
      const msg = `Phase 1 cannot be finalized — ${parts.join("; ")}. stage1_status was NOT changed.`;
      return json({
        ok: false, mode: "blocked", client_id: clientId,
        message: msg,
        warnings: [], missingInputs: [],
        data: {
          files_present: byNumber.size,
          expected_files: CANONICAL_FILES.length,
          missing_file_numbers: missingFileNumbers,
          bad_status: badStatus,
        },
      });
    }

    // 4. All 21 present — mark Phase 1 complete
    const now = new Date().toISOString();
    const { error: updateErr } = await sb
      .from("clients")
      .update({ stage1_status: "complete", stage1_completed_at: now })
      .eq("id", clientId);

    if (updateErr) {
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: `Failed to update stage1_status: ${updateErr.message}`,
        warnings: [], missingInputs: [], error: updateErr.message,
      }, 500);
    }

    const needsClientInputCount =
      Array.from(byNumber.values()).filter((f) => f.status === "needs_client_input").length;

    await writeActivity(sb, clientId, "phase_1_generated",
      `Phase 1 complete for "${client.name}". ${CANONICAL_FILES.length} context files present.` +
      (needsClientInputCount > 0 ? ` ${needsClientInputCount} file(s) marked needs_client_input.` : ""),
      {
        files_written: CANONICAL_FILES.length,
        needs_client_input_count: needsClientInputCount,
      });

    return json({
      ok: true,
      mode: "generated",
      client_id: clientId,
      message: `Phase 1 complete. All ${CANONICAL_FILES.length} context files are present.` +
        (needsClientInputCount > 0 ? ` ${needsClientInputCount} file(s) need client input.` : ""),
      warnings: [],
      missingInputs: [],
      data: {
        files_written: CANONICAL_FILES.length,
        needs_client_input_count: needsClientInputCount,
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
