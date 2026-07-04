// generate-phase-1-file — Attract Acquisition Cockpit
//
// Generates EXACTLY ONE Client Context OS file per invocation.
// Called sequentially by the frontend (file_number 0–20) after
// generate-phase-1 returns mode "generation_started". Each single-file model
// call completes well inside the Supabase ~150s edge-function wall-clock cap.
//
// Reads client_inputs → calls Anthropic once for the requested file →
// validates → upserts one client_context_files row (never approved).
// finalize-phase-1 sets stage1_status = complete once all 21 exist.
//
// Core law: never fabricate context, proof, strategy, or client facts.
// The AI must mark missing information honestly — never fill gaps with invented content.

import { svc, json, cors } from "../_shared/aa.ts";
import { isAiEnabled, hasAnthropicKey, callAnthropic } from "../_shared/anthropic.ts";

// Must stay in sync with CONTEXT_FILE_DEFS in src/types/phase.ts and
// generate-phase-1/index.ts. `guidance` is the per-file generation brief.
const CONTEXT_FILE_DEFS: Array<{ number: number; file_name: string; title: string; guidance: string }> = [
  { number: 0,  file_name: "00_Master_Client_Context.md",                 title: "Master Client Context",
    guidance: "Executive summary of the full client OS. Overview of the 21-file Client Context OS structure, key inputs present/missing, confidence per domain, quick-reference index." },
  { number: 1,  file_name: "01_Business_Context.md",                      title: "Business Context",
    guidance: "Full business description, niche, geography, platforms used, operational model, team/founder context if provided." },
  { number: 2,  file_name: "02_Avatar_And_Buyer_Psychology.md",            title: "Avatar & Buyer Psychology",
    guidance: "Detailed target customer profile: demographics, psychographics, core pain points, desires, fears, decision triggers, objections, and what moves them to act." },
  { number: 3,  file_name: "03_Offer_And_Sales_Context.md",                title: "Offer & Sales Context",
    guidance: "Offer details, delivery model, value stack, pricing tier reference (AA package only — no invented pricing), sales process, conversion path, common objections and responses." },
  { number: 4,  file_name: "04_Proof_Bank.md",                             title: "Proof Bank",
    guidance: "All available proof assets from inputs: testimonials, reviews, case studies, before/afters, outcome evidence. If absent, state clearly. No invented proof." },
  { number: 5,  file_name: "05_Proof_Gap_Report.md",                       title: "Proof Gap Report",
    guidance: "What proof is missing and why it matters. Priority gaps ranked by impact. Capture instructions. Specific proof types needed per content format." },
  { number: 6,  file_name: "06_Positioning_And_Angle_Map.md",              title: "Positioning & Angle Map",
    guidance: "Market positioning relative to competitors, core differentiation angles, unique mechanism, hooks map, positioning statements." },
  { number: 7,  file_name: "07_Brand_Voice_And_Style_Guide.md",            title: "Brand Voice & Style Guide",
    guidance: "Tone, vocabulary preferences, language rules, what NOT to say, content persona, example phrases, platform-specific adjustments." },
  { number: 8,  file_name: "08_Profile_Funnel_Context.md",                 title: "Profile Funnel Context",
    guidance: "Social profile strategy, bio direction, profile-as-funnel architecture, follower journey from cold → warm → DM → book." },
  { number: 9,  file_name: "09_Content_System.md",                         title: "Content System",
    guidance: "Content pillars (derive from business/avatar/offer), archetypes, formats (Reels, Feed Posts, Carousels only — NOT Stories/Ads), weekly cadence guidance aligned to Proof Brand default (4 Reels, 2 Carousels, 2 Static Feed Posts per week), content-to-conversion path." },
  { number: 10, file_name: "10_Story_System.md",                           title: "Story System",
    guidance: "Story-specific instructions: story types (daily, sequence, proof, offer, BTS, FAQ, poll, DM prompt), daily story rhythm (7 stories/week default), story-specific tone rules, DM prompt strategy." },
  { number: 11, file_name: "11_Ad_System.md",                              title: "Ad System",
    guidance: "Ad lanes (Ad 1 / Ad 2 / Ad 3), funnel stage per lane, meta objectives, creative strategy context, audience direction, proof-based ad angle recommendations. No invented ad performance data." },
  { number: 12, file_name: "12_Website_And_Landing_Page_Context.md",       title: "Website & Landing Page Context",
    guidance: "Website strategy direction, key page requirements, headline/messaging direction, CTAs, landing page requirements, claims that can and cannot be made." },
  { number: 13, file_name: "13_Distribution_System.md",                    title: "Distribution System",
    guidance: "Publishing strategy, platform priority order, content format routing (what goes where), weekly posting schedule context, distribution rules and constraints." },
  { number: 14, file_name: "14_Automation_And_AI_Instructions.md",         title: "Automation & AI Instructions",
    guidance: "How AI and automation tools should handle this client. Tone rules for AI-generated content. What AI must never say, invent, or claim for this specific client. When writing prohibition rules, describe banned terms without reproducing them literally — e.g. write 'no South African Rand pricing' rather than the currency code or Rand-formatted amounts, and refer to 'deprecated legacy offers' rather than naming them." },
  { number: 15, file_name: "15_Content_Calendar.md",                       title: "Content Calendar",
    guidance: "Monthly content planning context and rhythm guidance. This is the PLANNING CONTEXT file — not calendar cells. Includes cadence rules, slot allocation guidance, and monthly structure." },
  { number: 16, file_name: "16_Performance_Report.md",                     title: "Performance Report",
    guidance: "Initial setup document. No performance data exists yet. Define: what to track, KPIs, success benchmarks, reporting cadence. Mark clearly as initial setup with no live data." },
  { number: 17, file_name: "17_Iteration_Log.md",                          title: "Iteration Log",
    guidance: "Initial document. No history yet. Structure for logging future iterations, decisions, and learnings. Mark clearly as initial with no prior iterations." },
  { number: 18, file_name: "18_Client_Comms_And_Approval_Context.md",      title: "Client Comms & Approval Context",
    guidance: "Communication style with this specific client, approval workflow preferences, sign-off requirements, review cadence, constraints and sensitivities." },
  { number: 19, file_name: "19_Sales_Enablement_Assets.md",                title: "Sales Enablement Assets",
    guidance: "DM script direction, lead magnet context, objection handling scripts, sales asset requirements, conversion support materials needed." },
  { number: 20, file_name: "20_Retention_Upsell_And_Expansion_Context.md", title: "Retention, Upsell & Expansion Context",
    guidance: "Retention strategy for this client, expansion opportunities, upsell context aligned to AA tier ladder (Sprint → Brand → Brand Scale), long-term relationship direction." },
];

// The three fields whose absence hard-blocks Phase 1 generation.
const REQUIRED_FIELDS: Array<{ field: string; label: string }> = [
  { field: "business_description", label: "Business Overview" },
  { field: "offer_details",        label: "Offer / Services" },
  { field: "target_customer",      label: "Ideal Customer" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientRecord {
  id: string;
  name: string;
  package_tier: string;
  geography: string | null;
  primary_platform: string | null;
  secondary_platform: string | null;
}

interface ClientInputsRow {
  business_description: string | null;
  website_url: string | null;
  social_links: Record<string, string> | null;
  offer_details: string | null;
  target_customer: string | null;
  geography: string | null;
  proof_notes: string | null;
  testimonials_notes: string | null;
  reviews_notes: string | null;
  case_studies_notes: string | null;
  before_after_notes: string | null;
  founder_team_notes: string | null;
  current_problems: string | null;
  uploaded_file_refs: string[] | null;
  sales_process: string | null;
  current_marketing: string | null;
  brand_voice: string | null;
  competitors: string | null;
  constraints_approval_rules: string | null;
  raw_notes: string | null;
}

interface ModelFile {
  file_number: number;
  file_name: string;
  title: string;
  content: string;
  status: string;
  confidence_level: string;
  source_summary: string;
  warnings: string[];
  missing_inputs: string[];
  proof_gaps: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  if (error) console.error("[generate-phase-1-file] activity_log:", error.message);
}

function str(v: unknown): string {
  return v && typeof v === "string" && v.trim().length > 0 ? v.trim() : "[NOT PROVIDED]";
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildSystemPrompt(def: typeof CONTEXT_FILE_DEFS[number]): string {
  return `You are the Attract Acquisition Client Context OS Generator.

Your task: generate EXACTLY ONE Client Context OS markdown file for a specific client, based solely on the input data provided. This file is one of 21 in the Client Context OS; the others are generated separately.

THE FILE TO GENERATE:
${String(def.number).padStart(2, "0")} | ${def.file_name} | ${def.title}
→ ${def.guidance}

CRITICAL OUTPUT INSTRUCTION:
Return ONLY a single valid JSON object. No markdown code fences. No explanatory text before or after the JSON. Begin your response with { and end with }.

REQUIRED JSON SHAPE:
{
  "file_number": ${def.number},
  "file_name": "${def.file_name}",
  "title": "${def.title}",
  "content": "# ${def.title}\\n\\n## Status / Confidence\\n- **Confidence:** medium\\n- **Status:** needs_review\\n\\n...",
  "status": "needs_review",
  "confidence_level": "low|medium|high",
  "source_summary": "Generated from business_description, offer_details, and target_customer.",
  "warnings": [],
  "missing_inputs": [],
  "proof_gaps": []
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PROOF HONESTY RULES — ABSOLUTE AND NON-NEGOTIABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. NEVER invent testimonials, client results, case studies, metrics, or business facts.
2. NEVER invent revenue figures, ad performance, ROI claims, or conversion rates.
3. NEVER invent customer names, quotes, or before/after outcomes.
4. NEVER fabricate proof to fill gaps — gaps must be stated honestly.
5. If proof is absent: write "Not provided — [NEEDS CLIENT INPUT]"
6. If testimonials absent: write "No testimonials provided — [NEEDS CLIENT INPUT]"
7. If case studies absent: write "No case studies provided — [NEEDS CLIENT INPUT]"
8. If performance data absent: write "No performance data — [NEEDS CLIENT INPUT]"
9. The file MUST contain a "## Status / Confidence" section.
10. The file MUST contain a "## Missing Information" section (write "None identified." if nothing is missing).
11. confidence_level must reflect reality: "low" = few relevant inputs, "medium" = some relevant inputs, "high" = comprehensive inputs.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AA COMMERCIAL AUTHORITY — DO NOT DEVIATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACTIVE OFFER TIERS (reference only these three):
  - Proof Sprint
  - Proof Brand
  - Proof Brand Scale (this is a capacity/capability upgrade of Proof Brand — NOT a different system)

COMMERCIAL AUTHORITY: Europe / EUR. Never mention ZAR pricing or South African Rand amounts.
This applies EVEN WHEN STATING PROHIBITIONS: never reproduce the literal currency code "ZAR" or Rand-formatted amounts (e.g. R7,500) anywhere in the content — describe them instead ("South African Rand pricing"). Output containing those literal tokens is rejected automatically.

DEPRECATED — never present as active:
  - Proof Brand Lite
  - Proof Engine Buildout

PRIVATE INTERNAL TOOLS — never present as client-facing:
  - Proof Leak Scorecard
  - Proof Authority Maintenance

When referencing the client's AA package, use only the package_tier value provided.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STATUS RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Use "needs_review" if the file has meaningful generated content.
- Use "needs_client_input" if almost no source input was available for this file (e.g. Proof Bank when zero proof was supplied).
- NEVER set status to "approved" — all files require human review.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTENT QUALITY RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Write structured, operational markdown — use bullet points and concise sections, not prose essays.
- Target 150–250 words. Substance over length. Do not pad with repetition.
- Derive ALL content from the provided client inputs only — do not invent business facts.
- Where reasonable inference is possible from inputs, state it and append [INFERRED — confirm with client].
- No lorem ipsum. No [Your Business Name] or similar template placeholders.
- The file must be self-contained and operationally useful for content generation.`;
}

function buildUserMessage(
  client: ClientRecord,
  inputs: ClientInputsRow,
  def: typeof CONTEXT_FILE_DEFS[number],
): string {
  const tierLabel: Record<string, string> = {
    proof_sprint: "Proof Sprint",
    proof_brand: "Proof Brand",
    proof_brand_scale: "Proof Brand Scale",
  };

  const uploadedRefs = (inputs.uploaded_file_refs ?? []).length > 0
    ? "Files uploaded to Storage — review separately via asset management"
    : "[NONE]";

  const socialLinks = inputs.social_links && Object.keys(inputs.social_links).length > 0
    ? JSON.stringify(inputs.social_links)
    : "[NOT PROVIDED]";

  return `Generate Client Context OS file "${def.file_name}" (${def.title}) for the following client.

━━ CLIENT RECORD ━━
Name: ${client.name}
AA Package Tier: ${tierLabel[client.package_tier] ?? client.package_tier}
Geography: ${str(client.geography)}
Primary Platform: ${str(client.primary_platform)}
Secondary Platform: ${str(client.secondary_platform)}

━━ CLIENT INPUTS ━━
Business Description:
${str(inputs.business_description)}

Offer Details:
${str(inputs.offer_details)}

Target Customer:
${str(inputs.target_customer)}

Website URL: ${str(inputs.website_url)}
Social Links: ${socialLinks}
Geography: ${str(inputs.geography)}

Proof Notes:
${str(inputs.proof_notes)}

Testimonials Notes:
${str(inputs.testimonials_notes)}

Reviews Notes:
${str(inputs.reviews_notes)}

Case Studies Notes:
${str(inputs.case_studies_notes)}

Before/After Notes:
${str(inputs.before_after_notes)}

Founder / Team Notes:
${str(inputs.founder_team_notes)}

Current Problems:
${str(inputs.current_problems)}

Sales Process:
${str(inputs.sales_process)}

Current Marketing:
${str(inputs.current_marketing)}

Brand Voice:
${str(inputs.brand_voice)}

Competitors:
${str(inputs.competitors)}

Constraints / Approval Rules:
${str(inputs.constraints_approval_rules)}

Raw Notes:
${str(inputs.raw_notes)}

Uploaded File Refs: ${uploadedRefs}

━━ INSTRUCTION ━━
Generate ONLY "${def.file_name}" now for "${client.name}".
Apply all proof honesty rules. Apply AA commercial authority exactly.
Return ONLY the JSON object. Start with { and end with }.`;
}

// ─── JSON extraction ──────────────────────────────────────────────────────────

function extractJson(text: string): ModelFile | null {
  // 1. Direct parse
  try { return JSON.parse(text.trim()) as ModelFile; } catch { /* fall through */ }

  // 2. Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]) as ModelFile; } catch { /* fall through */ }
  }

  // 3. Extract first {...} block
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) as ModelFile; } catch { /* fall through */ }
  }

  return null;
}

// ─── Validation ───────────────────────────────────────────────────────────────

// ZAR/Rand patterns — catch R7,500 / R32,500 / R115,000 / ZAR
const ZAR_PATTERNS: RegExp[] = [
  /\bZAR\b/i,
  /\bR\d{1,3}(?:,\d{3})+\b/,
  /\bR\d{4,}\b/,
];

const DEPRECATED_OFFERS = ["Proof Brand Lite", "Proof Engine Buildout"];

const FAKE_CONTENT_PATTERNS: RegExp[] = [
  /lorem ipsum/i,
  /\[Your (?:Business )?Name(?: Here)?\]/i,
  /\[Client Name\]/i,
  /\[insert \w+\]/i,
  /\[sample \w+\]/i,
  /\[PLACEHOLDER\]/i,
];

const ALLOWED_STATUS = new Set(["needs_review", "needs_client_input"]);
const ALLOWED_CONFIDENCE = new Set(["low", "medium", "high"]);

function validateFile(
  f: ModelFile,
  def: typeof CONTEXT_FILE_DEFS[number],
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tag = `[${def.file_name}]`;

  if (f.file_number !== def.number) {
    errors.push(`${tag} model returned file_number ${f.file_number}, expected ${def.number}.`);
  }
  if (f.file_name !== def.file_name) {
    errors.push(`${tag} model returned file_name "${f.file_name}", expected "${def.file_name}".`);
  }
  if (!f.content || f.content.trim().length < 20) {
    errors.push(`${tag} content is empty or too short.`);
  }
  if (!ALLOWED_STATUS.has(f.status)) {
    errors.push(`${tag} invalid status "${f.status}" — must be needs_review or needs_client_input.`);
  }
  if (!ALLOWED_CONFIDENCE.has(f.confidence_level)) {
    errors.push(`${tag} invalid confidence_level "${f.confidence_level}" — must be low, medium, or high.`);
  }
  if (!f.title || f.title.trim().length === 0) {
    errors.push(`${tag} has empty title.`);
  }

  const content = f.content ?? "";

  // ZAR pricing
  for (const re of ZAR_PATTERNS) {
    if (re.test(content)) {
      errors.push(`${tag} contains ZAR/Rand pricing. Remove all South African Rand references.`);
      break;
    }
  }

  // Deprecated offers
  const lc = content.toLowerCase();
  for (const offer of DEPRECATED_OFFERS) {
    if (lc.includes(offer.toLowerCase())) {
      warnings.push(`${tag} mentions "${offer}" — confirm it is not presented as an active offer.`);
    }
  }

  // Fake/placeholder content
  for (const re of FAKE_CONTENT_PATTERNS) {
    if (re.test(content)) {
      errors.push(`${tag} contains placeholder/fabricated content (pattern: ${re.toString().slice(0, 40)}).`);
      break;
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return json({ ok: false, mode: "error", message: "POST only", warnings: [], missingInputs: [] }, 405);
  }

  try {
    const body = await req.json() as { client_id?: string; file_number?: number };
    const clientId = body?.client_id;
    const fileNumber = body?.file_number;

    if (!clientId || typeof clientId !== "string") {
      return json({ ok: false, mode: "error", message: "client_id required", warnings: [], missingInputs: [] }, 400);
    }
    if (typeof fileNumber !== "number" || !Number.isInteger(fileNumber) || fileNumber < 0 || fileNumber > 20) {
      return json({ ok: false, mode: "error", client_id: clientId, message: "file_number must be an integer 0–20.", warnings: [], missingInputs: [] }, 400);
    }

    const def = CONTEXT_FILE_DEFS.find((d) => d.number === fileNumber);
    if (!def) {
      return json({ ok: false, mode: "error", client_id: clientId, message: `No canonical file definition for file_number ${fileNumber}.`, warnings: [], missingInputs: [] }, 400);
    }

    const sb = svc();

    // 1. Validate client exists
    const { data: client, error: clientErr } = await sb
      .from("clients")
      .select("id, name, package_tier, geography, primary_platform, secondary_platform")
      .eq("id", clientId)
      .maybeSingle();

    if (clientErr || !client) {
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: "Client not found.",
        warnings: [], missingInputs: [], error: clientErr?.message ?? "not found",
      }, 404);
    }

    // 2. Load client_inputs
    const { data: inputs, error: inputsErr } = await sb
      .from("client_inputs")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle();

    if (inputsErr) {
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: "Failed to load client inputs.",
        warnings: [], missingInputs: [], error: inputsErr.message,
      }, 500);
    }

    // 3. Required inputs must still be present
    const missingInputs: string[] = [];
    for (const { field, label } of REQUIRED_FIELDS) {
      const val = (inputs as Record<string, unknown> | null)?.[field];
      if (!val || (typeof val === "string" && val.trim() === "")) {
        missingInputs.push(label);
      }
    }
    if (missingInputs.length > 0) {
      return json({
        ok: false, mode: "blocked", client_id: clientId,
        message: `File generation blocked: required inputs missing (${missingInputs.join(", ")}).`,
        warnings: [], missingInputs,
      });
    }

    // 4. AI gate — fail closed
    if (!isAiEnabled()) {
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: "AA_AI_GENERATION_ENABLED is not true. Cannot generate.",
        warnings: [], missingInputs: [], error: "AI generation disabled",
      }, 500);
    }
    if (!hasAnthropicKey()) {
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: "ANTHROPIC_API_KEY is not set. Cannot generate.",
        warnings: [], missingInputs: [], error: "ANTHROPIC_API_KEY missing",
      }, 500);
    }

    await writeActivity(sb, clientId, "phase_1_file_generation_started",
      `Generating Phase 1 file ${def.file_name} for "${client.name}".`,
      { file_number: def.number, file_name: def.file_name });

    // 5. One model call for one file — comfortably inside the 150s cap
    const aiResult = await callAnthropic({
      system: buildSystemPrompt(def),
      user: buildUserMessage(
        client as unknown as ClientRecord,
        (inputs ?? {}) as unknown as ClientInputsRow,
        def,
      ),
      model: Deno.env.get("AA_AI_MODEL") ?? "claude-opus-4-8",
      maxTokens: 3000,
      timeoutMs: 120_000,
    });

    if (!aiResult.ok) {
      await writeActivity(sb, clientId, "phase_1_file_error",
        `Phase 1 file ${def.file_name} AI call failed: ${aiResult.error}`,
        { file_number: def.number, error: aiResult.error });
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: `AI call failed for ${def.file_name}: ${aiResult.error}`,
        warnings: [], missingInputs: [], error: aiResult.error,
      }, 500);
    }

    const parsed = extractJson(aiResult.text);
    if (!parsed) {
      await writeActivity(sb, clientId, "phase_1_file_error",
        `Phase 1 file ${def.file_name} failed: model did not return valid JSON.`,
        { file_number: def.number, error: "JSON parse failure" });
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: `Model did not return valid JSON for ${def.file_name}.`,
        warnings: [], missingInputs: [], error: "JSON parse failure",
      }, 500);
    }

    const validation = validateFile(parsed, def);
    if (!validation.ok) {
      await writeActivity(sb, clientId, "phase_1_file_validation_failed",
        `Phase 1 file ${def.file_name} failed validation: ${validation.errors.slice(0, 3).join("; ")}`,
        { file_number: def.number, validation_errors: validation.errors });
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: `Validation failed for ${def.file_name}. The file was not written.`,
        warnings: validation.warnings, missingInputs: [],
        error: "Validation failed",
        data: { file_number: def.number, validation_errors: validation.errors },
      }, 422);
    }

    // 6. Upsert exactly one row — canonical name/number from the definition,
    //    never from the model. Status is never approved (enforced above).
    const now = new Date().toISOString();
    const { error: upsertErr } = await sb
      .from("client_context_files")
      .upsert({
        client_id: clientId,
        file_number: def.number,
        file_name: def.file_name,
        content_md: parsed.content,
        status: parsed.status,
        confidence_level: parsed.confidence_level,
        generated_by_function: "generate-phase-1-file",
        updated_at: now,
      }, { onConflict: "client_id,file_number" });

    if (upsertErr) {
      await writeActivity(sb, clientId, "phase_1_file_error",
        `Phase 1 file ${def.file_name} DB write failed: ${upsertErr.message}`,
        { file_number: def.number, error: upsertErr.message });
      return json({
        ok: false, mode: "error", client_id: clientId,
        message: `DB write failed for ${def.file_name}: ${upsertErr.message}`,
        warnings: [], missingInputs: [], error: upsertErr.message,
      }, 500);
    }

    const allWarnings = [...validation.warnings, ...(parsed.warnings ?? [])];

    await writeActivity(sb, clientId, "phase_1_file_generated",
      `Phase 1 file ${def.file_name} generated for "${client.name}" (status: ${parsed.status}).`,
      {
        file_number: def.number,
        file_name: def.file_name,
        status: parsed.status,
        confidence_level: parsed.confidence_level,
        warnings: allWarnings,
        missing_inputs: parsed.missing_inputs ?? [],
        proof_gaps: parsed.proof_gaps ?? [],
      });

    return json({
      ok: true,
      mode: "file_generated",
      client_id: clientId,
      message: `${def.file_name} generated (status: ${parsed.status}).`,
      warnings: allWarnings,
      missingInputs: parsed.missing_inputs ?? [],
      data: {
        file_number: def.number,
        file_name: def.file_name,
        status: parsed.status,
        confidence_level: parsed.confidence_level,
        warnings: allWarnings,
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
