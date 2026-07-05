// Phase G1 — one approved-authority production brief per master asset.
import { svc, json, cors } from "../_shared/aa.ts";
import { callAnthropic, hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";
import { EXECUTION_FILE_COUNT } from "../_shared/execution-manifest.ts";
import {
  missingBriefSections,
  PRODUCTION_BRIEF_CONTRACTS,
  resolveAssetFormat,
  type AssetFormat,
  type ProductionSourceTable,
} from "../_shared/production-brief-contract.ts";

const FUNCTION_NAME = "generate-production-brief";
const SOURCE_TABLES = new Set<ProductionSourceTable>(["organic_master", "story_master", "ads_master"]);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);

function failure(status: number, stage: string, error: string, details?: unknown): Response {
  return json({ ok: false, function: FUNCTION_NAME, stage, error, details, message: `${FUNCTION_NAME} failed at ${stage}: ${error}` }, status);
}

function compact(value: string | null, chars: number): string {
  return (value ?? "[EMPTY]").trim().slice(0, chars);
}

function titleFor(row: Record<string, unknown>, ref: string): string {
  for (const key of ["working_title", "story_theme", "stint_name"]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `${ref} Production Brief`;
}

function proofViolations(markdown: string, proofRestricted: boolean): string[] {
  const violations: string[] = [];
  if (/guaranteed (?:leads|results|revenue|roi)/i.test(markdown)) violations.push("guaranteed outcome claim");
  if (/\b(?:roi of|\d+(?:\.\d+)?x roi|\d+(?:\.\d+)?% roi)\b/i.test(markdown)) violations.push("unsupported ROI claim");
  if (proofRestricted && /our clients (?:achieved|generated|saw|increased|grew)|trusted by (?:hundreds|thousands|leading|top)/i.test(markdown)) violations.push("external client outcome claim for a proof-restricted client");
  return violations;
}

async function generateMarkdown(system: string, user: string, maxTokens = 5200) {
  const result = await callAnthropic({
    system,
    user,
    model: Deno.env.get("AA_PRODUCTION_BRIEF_AI_MODEL") ?? Deno.env.get("AA_PHASE2_AI_MODEL") ?? "claude-sonnet-4-6",
    maxTokens,
    timeoutMs: 120_000,
  });
  if (!result.ok) throw new Error(result.error);
  return result.text.replace(/^```(?:markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return failure(405, "request", "POST only");
  const sb = svc();
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return failure(401, "authorization", "Not authenticated.");
    const { data: operator, error: operatorError } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (operatorError) return failure(500, "authorization", "Could not load operator role.", operatorError.message);
    if (!operator || !STAFF_ROLES.has(operator.role)) return failure(403, "authorization", "Admin, account manager, or editor access is required.");

    const body = await req.json() as {
      client_id?: string; execution_month?: string; source_table?: string; source_row_id?: string; source_ref?: string;
    };
    const clientId = body.client_id?.trim() ?? "";
    const month = body.execution_month?.trim() ?? "";
    const sourceTable = body.source_table as ProductionSourceTable;
    const sourceRowId = body.source_row_id?.trim() ?? "";
    const sourceRef = body.source_ref?.trim() ?? "";
    if (!clientId || !MONTH_RE.test(month) || !SOURCE_TABLES.has(sourceTable) || !sourceRowId || !sourceRef) {
      return failure(400, "request", "client_id, execution_month, valid source_table, source_row_id, and source_ref are required.");
    }
    if (!isAiEnabled() || !hasAnthropicKey()) return failure(500, "configuration", "Server-side AI generation is not configured.");

    const [clientResult, rowResult, contextResult, executionResult, calendarResult] = await Promise.all([
      sb.from("clients").select("id, name, stage1_status, stage2_status").eq("id", clientId).maybeSingle(),
      sb.from(sourceTable).select("*").eq("id", sourceRowId).eq("client_id", clientId).eq("month", month).eq("ref", sourceRef).maybeSingle(),
      sb.from("client_context_files").select("file_number, file_name, content_md, status").eq("client_id", clientId).eq("status", "approved").order("file_number"),
      sb.from("client_execution_files").select("file_number, file_name, content_md, review_state").eq("client_id", clientId).eq("month", month).eq("review_state", "approved").order("file_number"),
      sb.from("calendar_cells").select("date, row_type, review_state").eq("client_id", clientId).eq("month", month).eq("ref", sourceRef).order("date"),
    ]);
    if (clientResult.error || !clientResult.data) return failure(404, "load_client", "Client not found.", clientResult.error?.message);
    if (rowResult.error || !rowResult.data) return failure(404, "load_master", "The selected master row was not found or did not match the supplied reference.", rowResult.error?.message);
    if (contextResult.error || executionResult.error || calendarResult.error) return failure(500, "load_authority", "Could not load approved production authority.", contextResult.error?.message ?? executionResult.error?.message ?? calendarResult.error?.message);
    const contexts = contextResult.data ?? [];
    const executions = executionResult.data ?? [];
    if (clientResult.data.stage1_status !== "complete" || contexts.length !== 21) return failure(409, "gate", `Production briefs require 21 approved Context Files; found ${contexts.length}.`);
    if (clientResult.data.stage2_status !== "complete" || executions.length !== EXECUTION_FILE_COUNT) return failure(409, "gate", `Production briefs require all ${EXECUTION_FILE_COUNT} approved Execution Files; found ${executions.length}.`);

    let assetFormat: AssetFormat;
    try { assetFormat = resolveAssetFormat(sourceTable, rowResult.data as Record<string, unknown>); }
    catch (error) { return failure(422, "resolve_format", error instanceof Error ? error.message : String(error)); }
    const contract = PRODUCTION_BRIEF_CONTRACTS[assetFormat];
    const contextAuthority = contexts.map((file) => `\n### ${file.file_name}\n${compact(file.content_md, 900)}`).join("\n");
    const executionAuthority = executions.map((file) => {
      const limit = file.file_number === 10 || file.file_number === 11 ? 2200 : 700;
      return `\n### ${file.file_name}\n${compact(file.content_md, limit)}`;
    }).join("\n");
    const authorityText = `${contextAuthority}\n${executionAuthority}`;
    const proofRestricted = /pre[- ]launch|external client proof (?:is )?absent|no external client proof/i.test(authorityText);
    const requiredHeadings = contract.requiredSections.map((section) => `## ${section}`).join("\n");
    const system = `You create one self-contained production brief for an Instagram-first content production workflow. Use only the approved authority supplied. Never invent client proof, testimonials, case studies, outcomes, ROI, leads, metrics, logos, scarcity, or consent. Verified proof may be used only when explicitly supported by the approved Proof Bank and Proof Master Plan. Return markdown only.`;
    const userPrompt = `Create a production-ready markdown instruction document for a human contractor or a later asset-generation function. This task creates instructions only, never the final asset.

CLIENT: ${clientResult.data.name}
SOURCE TABLE: ${sourceTable}
SOURCE REF: ${sourceRef}
FORMAT: ${contract.label}
ASPECT RATIO: ${contract.aspectRatio}
OUTPUT: ${contract.output}
HUMAN ONLY: ${contract.humanOnly ? "Yes — do not suggest AI video generation" : "No production mode selected yet"}
CALENDAR: ${JSON.stringify(calendarResult.data ?? [])}

MASTER ROW:
${JSON.stringify(rowResult.data, null, 2)}

REQUIRED HEADINGS — use each heading exactly once:
${requiredHeadings}

Under those headings include source ref, objective, copy direction, brand styling, format specifications, proof boundaries, what not to claim, CTA, and a concrete checklist. Keep the brief specific to this row. For carousels and stories specify every slide/frame. For reels specify duration, shot list, script/voiceover, B-roll, subtitles, and editing rhythm. For static ads specify lane, audience, offer, headline, primary text direction, compliance, and a 4:5 visual concept unless authority overrides it.

APPROVED CONTEXT FILES:
${contextAuthority}

APPROVED EXECUTION FILES, INCLUDING E10 PROOF AND E11 GOVERNANCE:
${executionAuthority}`;

    let markdown = await generateMarkdown(system, userPrompt);
    let missing = missingBriefSections(markdown, assetFormat);
    if (missing.length) {
      markdown = await generateMarkdown(`${system}\nFORMAT RETRY: The previous response omitted required headings. Return a complete replacement document using every heading exactly.`, userPrompt);
      missing = missingBriefSections(markdown, assetFormat);
    }
    if (missing.length) return failure(502, "validate_markdown", "Provider output omitted required brief sections after retry.", { missing_sections: missing });
    const proofErrors = proofViolations(markdown, proofRestricted);
    if (proofErrors.length) return failure(422, "validate_proof", "Generated brief violated proof or claim boundaries.", proofErrors);

    const { data: existing, error: existingError } = await sb.from("client_production_briefs").select("id, version").eq("client_id", clientId).eq("execution_month", month).eq("source_ref", sourceRef).eq("asset_format", assetFormat).maybeSingle();
    if (existingError) return failure(500, "load_existing", "Could not check for an existing production brief.", existingError.message);
    const payload = {
      client_id: clientId, execution_month: month, source_table: sourceTable, source_row_id: sourceRowId, source_ref: sourceRef,
      asset_format: assetFormat, title: `${sourceRef} — ${titleFor(rowResult.data, sourceRef)}`, content_md: markdown,
      status: "needs_review", production_mode: contract.humanOnly ? "human" : null, production_status: "brief",
      version: (existing?.version ?? 0) + 1, generated_by_function: FUNCTION_NAME,
      metadata: { calendar: calendarResult.data ?? [], aspect_ratio: contract.aspectRatio, output: contract.output, human_only: contract.humanOnly, context_file_count: contexts.length, execution_file_count: executions.length },
      updated_at: new Date().toISOString(),
    };
    const write = existing
      ? sb.from("client_production_briefs").update(payload).eq("id", existing.id).select("*").single()
      : sb.from("client_production_briefs").insert(payload).select("*").single();
    const { data: brief, error: writeError } = await write;
    if (writeError || !brief) return failure(500, "save_brief", "Could not save the production brief.", writeError?.message);
    await sb.from("activity_log").insert({ client_id: clientId, event_type: existing ? "production_brief_regenerated" : "production_brief_generated", plain_english_message: `${sourceRef} production brief ${existing ? "regenerated" : "generated"}.`, object_type: "client_production_brief", object_id: brief.id, metadata: { source_ref: sourceRef, asset_format: assetFormat, version: brief.version } });
    return json({ ok: true, function: FUNCTION_NAME, stage: "complete", brief });
  } catch (error) {
    return failure(error instanceof Error && error.message.includes("timed out") ? 504 : 500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
