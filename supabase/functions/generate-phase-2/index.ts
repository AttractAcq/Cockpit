// generate-phase-2 — approved Phase 1 context files → execution markdown files only.
//
// Split contract:
//   action=prepare  validates the 21 approved context files and clears only execution files
//   action=section  generates one execution markdown document
//   action=finalize validates the 11 canonical documents and marks Stage 2 complete

import { svc, json, cors } from "../_shared/aa.ts";
import { callAnthropic, hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";
import { EXECUTION_FILE_COUNT, EXECUTION_FILE_MANIFEST, executionDefinitionByCode, type ExecutionFileCode } from "../_shared/execution-manifest.ts";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EXPECTED_CONTEXT_FILES = 21;
const SECTIONS = EXECUTION_FILE_MANIFEST.map((definition) => definition.code);
type Section = ExecutionFileCode;

interface ContextFile {
  file_number: number;
  file_name: string;
  content_md: string | null;
  status: string;
}

const FORBIDDEN: Array<{ label: string; pattern: RegExp }> = [
  { label: "deprecated offer", pattern: /Proof Brand Lite|Proof Engine Buildout|Authority Brand/i },
  { label: "legacy pricing", pattern: /\bZAR\b|\bR\d{4,}|\bR\d{1,3}(?:,\d{3})+/i },
  { label: "guaranteed outcome", pattern: /guaranteed (?:leads|results|revenue|roi)/i },
  { label: "invented client outcome", pattern: /our clients (?:achieved|generated|saw|increased|grew)/i },
  { label: "invented trust claim", pattern: /trusted by (?:hundreds|thousands|leading|top)/i },
  { label: "invented ROI", pattern: /\b(?:roi of|\d+(?:\.\d+)?x roi|\d+(?:\.\d+)?% roi)\b/i },
  { label: "invented testimonial", pattern: /\b(?:client )?testimonial:\s*(?!not provided|none|absent|unavailable)/i },
  { label: "invented case study", pattern: /\bcase stud(?:y|ies):\s*(?!not provided|none|absent|unavailable)/i },
];

function honestyErrors(text: string): string[] {
  const prohibition = /\b(?:do not|never|must not|cannot|avoid|forbidden|not claim|not use|not invent|not guaranteed|no guarantees?|without guarantees?|no testimonials?|no case stud(?:y|ies)|no fabricated|no guaranteed)\b/i;
  const scannable = text.split(/(?<=[.!?\n])/).map((sentence) => {
    const namesForbidden = FORBIDDEN.some(({ pattern }) => pattern.test(sentence));
    return namesForbidden && prohibition.test(sentence) ? "[explicit honesty constraint]" : sentence;
  }).join("");
  return FORBIDDEN.filter(({ pattern }) => pattern.test(scannable)).map(({ label }) => label);
}

function clean(value: string): string {
  return value
    .replace(/Proof Brand Lite|Proof Engine Buildout|Authority Brand/gi, "[deprecated legacy offer removed]")
    .replace(/\bZAR\b|\bR\d{4,}|\bR\d{1,3}(?:,\d{3})+/gi, "[legacy price removed]");
}

function failure(status: number, stage: string, error: string, extra: Record<string, unknown> = {}) {
  return json({
    ok: false,
    mode: status === 409 ? "blocked" : "error",
    function: "generate-phase-2",
    stage,
    error,
    message: error,
    warnings: [],
    missingContextFiles: [],
    ...extra,
  }, status);
}

async function activity(sb: ReturnType<typeof svc>, clientId: string, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await sb.from("activity_log").insert({
    client_id: clientId,
    event_type: eventType,
    plain_english_message: message,
    metadata,
  });
  if (error) console.error("[generate-phase-2] activity:", error.message);
}

async function loadAuthority(sb: ReturnType<typeof svc>, clientId: string) {
  const [clientResult, filesResult] = await Promise.all([
    sb.from("clients").select("id, name, stage1_status, stage2_status").eq("id", clientId).maybeSingle(),
    sb.from("client_context_files").select("file_number, file_name, content_md, status").eq("client_id", clientId).order("file_number"),
  ]);
  if (clientResult.error || !clientResult.data) return { ok: false as const, status: 404, error: clientResult.error?.message ?? "Client not found." };
  if (filesResult.error) return { ok: false as const, status: 500, error: filesResult.error.message };
  const files = (filesResult.data ?? []) as ContextFile[];
  const approved = files.filter((file) => file.status === "approved");
  const present = new Set(files.map((file) => file.file_number));
  const missing = Array.from({ length: EXPECTED_CONTEXT_FILES }, (_, number) => number).filter((number) => !present.has(number));
  if (clientResult.data.stage1_status !== "complete" || approved.length !== EXPECTED_CONTEXT_FILES || missing.length > 0) {
    return {
      ok: false as const,
      status: 409,
      error: "Phase 2 requires Phase 1 complete and all 21 context files approved.",
      counts: {
        context_total: files.length,
        context_approved: approved.length,
        context_needs_review: files.filter((file) => file.status === "needs_review").length,
        context_needs_client_input: files.filter((file) => file.status === "needs_client_input").length,
        context_missing: missing.length,
        missing_file_numbers: missing,
      },
    };
  }
  return { ok: true as const, client: clientResult.data, files };
}

function authorityFor(files: ContextFile[], section: Section): string {
  const definition = executionDefinitionByCode(section)!;
  const wanted = new Set<number>(definition.contextFileNumbers);
  const perFile = section === "E11" ? 900 : 1500;
  return files.filter((file) => wanted.has(file.file_number)).map((file) =>
    `\n===== APPROVED ${file.file_name} =====\n${clean(file.content_md ?? "[EMPTY APPROVED FILE]").slice(0, perFile)}`
  ).join("\n");
}

function promptFor(clientName: string, files: ContextFile[], section: Section): { system: string; user: string } {
  const definition = executionDefinitionByCode(section)!;
  const system = `You create one Phase 2 execution-system markdown document for ${clientName} from approved Phase 1 context files.

Approved context files are authoritative. The business is pre-launch unless the approved context says otherwise. External client proof is absent. Founder and infrastructure proof must never be presented as external client outcome proof.

Active offers only: Proof Sprint, Proof Brand, Proof Brand Scale. Never name deprecated legacy offers or legacy South African Rand pricing. Never invent testimonials, case studies, logos, client results, leads, revenue, ROI, conversion data, scarcity, or guarantees.

Return raw markdown only. Do not use a code fence. Do not quote examples of prohibited claim language; describe proof-honesty rules generically.`;
  const user = `${authorityFor(files, section)}

Create ${definition.fileName}: ${definition.title}.

CANONICAL METADATA:
- Code: ${definition.code}
- Group: ${definition.group}
- Phase: ${definition.phase}
- Status baseline: ${definition.statusBaseline}
- Confidence: ${definition.confidence}
- Canonical: yes
- Purpose: ${definition.description}
${definition.note ? `- Note: ${definition.note}` : ""}

DIRECT INPUTS:
${definition.directInputs.map((item) => `- ${item}`).join("\n")}

DOWNSTREAM CONSUMERS:
${definition.directOutputs.map((item) => `- ${item}`).join("\n")}

${definition.instruction}

The markdown must include: title, purpose, canonical metadata table, source inputs, downstream consumers, monthly execution rules, client-specific execution plan, required downstream Phase 3 fields/schema, proof and claim boundaries where relevant, status and confidence, needs-founder-input/needs-verification sections, and a human review checklist.

Make it operational and client-specific. Do not create finished Phase 3 content rows.`;
  return { system, user };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return failure(405, "validate_request", "POST only");

  const sb = svc();
  let clientId = "";
  let executionMonth = "";
  let action = "prepare";
  let section = "";

  try {
    const body = await req.json() as { client_id?: string; execution_month?: string; action?: string; section?: string };
    clientId = body.client_id ?? "";
    executionMonth = body.execution_month ?? "";
    action = body.action ?? "prepare";
    section = body.section ?? "";
    if (!clientId) return failure(400, "validate_request", "client_id required");
    if (!MONTH_RE.test(executionMonth)) return failure(400, "validate_request", "execution_month required in YYYY-MM format");
    if (!new Set(["prepare", "section", "finalize"]).has(action)) return failure(400, "validate_request", "action must be prepare, section, or finalize");

    const authority = await loadAuthority(sb, clientId);
    if (!authority.ok) {
      const counts = "counts" in authority ? authority.counts : undefined;
      return failure(authority.status, "validate_approved_context", authority.error, {
        data: counts,
        ...(counts ?? {}),
      });
    }

    if (action === "prepare") {
      if (!isAiEnabled() || !hasAnthropicKey()) return failure(500, "validate_ai_configuration", "AI generation is not configured.");
      const { error: clearError } = await sb.from("client_execution_files").delete().eq("client_id", clientId).eq("month", executionMonth);
      if (clearError) return failure(500, "clear_execution_files", `Could not clear previous execution files: ${clearError.message}`);
      const { error: statusError } = await sb.from("clients").update({ stage2_status: "running", stage2_completed_at: null }).eq("id", clientId);
      if (statusError) return failure(500, "mark_running", statusError.message);
      await activity(sb, clientId, "phase2_started", `Phase 2 execution-file generation started for ${executionMonth}.`, { sections: SECTIONS });
      return json({
        ok: true,
        mode: "generation_started",
        client_id: clientId,
        execution_month: executionMonth,
        message: "Phase 2 prepared. 11 canonical execution files will generate sequentially.",
        missingContextFiles: [],
        data: { sections: SECTIONS.map((name, index) => ({ name, position: index + 1 })) },
      });
    }

    if (action === "section") {
      if (!SECTIONS.includes(section as Section)) return failure(400, "validate_section", `Unknown Phase 2 section \"${section}\".`);
      if (!isAiEnabled() || !hasAnthropicKey()) return failure(500, "validate_ai_configuration", "AI generation is not configured.");
      const sectionName = section as Section;
      const definition = executionDefinitionByCode(sectionName)!;
      const prompt = promptFor(authority.client.name, authority.files, sectionName);
      const result = await callAnthropic({
        ...prompt,
        model: Deno.env.get("AA_PHASE2_AI_MODEL") ?? "claude-sonnet-4-6",
        maxTokens: 3500,
        timeoutMs: 120_000,
      });
      if (!result.ok) throw new Error(result.error);
      const content = result.text.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/, "").trim();
      if (content.length < 500) throw new Error(`${definition.fileName} is empty or too short.`);
      const forbidden = honestyErrors(content);
      if (forbidden.length) throw new Error(`${definition.fileName} failed proof/offer validation: ${forbidden.join(", ")}.`);

      const { data: existing, error: existingError } = await sb.from("client_execution_files")
        .select("id, version").eq("client_id", clientId).eq("month", executionMonth).eq("file_name", definition.fileName).maybeSingle();
      if (existingError) throw new Error(`Could not load ${definition.fileName} version: ${existingError.message}`);
      const { error: conflictingNumberError } = await sb.from("client_execution_files").delete()
        .eq("client_id", clientId).eq("month", executionMonth).eq("file_number", definition.fileNumber).neq("file_name", definition.fileName);
      if (conflictingNumberError) throw new Error(`Could not clear conflicting file number ${definition.fileNumber}: ${conflictingNumberError.message}`);

      // A section request is intentionally idempotent. This protects the run from
      // browser retries or rapid duplicate clicks without creating duplicate files.
      const { error: insertError } = await sb.from("client_execution_files").upsert({
        client_id: clientId,
        month: executionMonth,
        file_name: definition.fileName,
        file_number: definition.fileNumber,
        file_type: "markdown",
        content_md: content,
        status: "draft",
        version: (existing?.version ?? 0) + 1,
        generated_by_agent: Deno.env.get("AA_PHASE2_AI_MODEL") ?? "claude-sonnet-4-6",
        generated_by_function: "generate-phase-2",
        review_state: "needs_review",
      }, { onConflict: "client_id,month,file_name" });
      if (insertError) throw new Error(`client_execution_files insert failed: ${insertError.message} (${insertError.code})`);
      await activity(sb, clientId, "phase2_file_generated", `${definition.fileName} generated.`, { execution_month: executionMonth, section: sectionName, file_number: definition.fileNumber });
      return json({
        ok: true,
        mode: "section_generated",
        client_id: clientId,
        execution_month: executionMonth,
        message: `${definition.fileName} generated.`,
        warnings: [],
        missingContextFiles: [],
        data: { section: sectionName, row_count: 1, file_number: definition.fileNumber, file_name: definition.fileName },
      });
    }

    const { data: files, error: filesError } = await sb.from("client_execution_files")
      .select("file_number, file_name, content_md, review_state").eq("client_id", clientId).eq("month", executionMonth).order("file_number");
    if (filesError) throw new Error(filesError.message);
    const errors: string[] = [];
    if ((files ?? []).length !== EXECUTION_FILE_COUNT) errors.push(`expected ${EXECUTION_FILE_COUNT} execution files, found ${(files ?? []).length}`);
    for (const definition of EXECUTION_FILE_MANIFEST) {
      const file = (files ?? []).find((candidate) => candidate.file_number === definition.fileNumber && candidate.file_name === definition.fileName);
      if (!file) errors.push(`missing ${definition.fileName}`);
      else errors.push(...honestyErrors(file.content_md ?? "").map((error) => `${definition.fileName}: ${error}`));
    }
    if (errors.length) return failure(422, "finalize_execution_files", "Execution files failed validation.", { details: errors });

    const { data: validation, error: validationError } = await sb.functions.invoke("validate-execution-pack", {
      body: { client_id: clientId, execution_month: executionMonth, validation_mode: "execution_files" },
    });
    if (validationError || !validation?.ok) return failure(422, "validate_execution_files", "validate-execution-pack rejected Phase 2.", { details: validation?.errors ?? validationError?.message });
    const completedAt = new Date().toISOString();
    const { error: completeError } = await sb.from("clients").update({ stage2_status: "complete", stage2_completed_at: completedAt }).eq("id", clientId);
    if (completeError) throw new Error(completeError.message);
    await activity(sb, clientId, "phase2_completed", `Phase 2 completed with ${SECTIONS.length} execution files.`, { execution_month: executionMonth, execution_files: SECTIONS.length });
    return json({
      ok: true,
      mode: "generated",
      stage: "phase2",
      client_id: clientId,
      execution_month: executionMonth,
      message: `Phase 2 complete. ${SECTIONS.length} execution files generated.`,
      warnings: validation.warnings ?? [],
      missingContextFiles: [],
      execution_file_count: SECTIONS.length,
      file_names: EXECUTION_FILE_MANIFEST.map((file) => file.fileName),
      validation: { ok: true, errors: [], warnings: validation.warnings ?? [] },
      data: { client_execution_files: SECTIONS.length, validation_errors: [], validation_warnings: validation.warnings ?? [] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (clientId) {
      await sb.from("clients").update({ stage2_status: "error" }).eq("id", clientId);
      await activity(sb, clientId, "phase2_failed", `Phase 2 failed at ${action}${section ? `:${section}` : ""}.`, { error: message }).catch(() => undefined);
    }
    return failure(message.includes("timed out") ? 504 : 500, `${action}${section ? `:${section}` : ""}`, "Phase 2 execution-file generation failed.", { details: message });
  }
});
