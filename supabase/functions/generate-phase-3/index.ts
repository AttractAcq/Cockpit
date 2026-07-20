// generate-phase-3 — approved execution files to masters + calendar
//
// Split contract:
//   action=prepare  -> validate Phase 1 + approved Phase 2 files; clear only masters/calendar
//   action=section  -> generate one bounded master group or the deterministic calendar
//   action=finalize -> validate the Phase 3 masters/calendar pack
//
// Approved Phase 1 context files are the authority. All generated rows remain
// needs_review. No output is published, scheduled, or approved automatically.

import { svc, json, cors } from "../_shared/aa.ts";
import { callAnthropic, hasAnthropicKey, isAiEnabled } from "../_shared/anthropic.ts";
import { EXECUTION_FILE_COUNT, EXECUTION_FILE_MANIFEST } from "../_shared/execution-manifest.ts";
import { canonicalAdRanges, expectedCalendarCellCount, PHASE3_EXPECTED_COUNTS } from "../_shared/phase3-contract.ts";
import { buildPhase3ContextFileExcerpt, type Phase3AuthorityFormat } from "../_shared/phase3-authority.ts";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EXPECTED_CONTEXT_FILES = 21;
const SECTIONS = [
  "organic_reels_1",
  "organic_reels_2",
  "organic_reels_3",
  "organic_reels_4",
  "organic_carousels_1",
  "organic_carousels_2",
  "organic_feed_posts_1",
  "organic_feed_posts_2",
  "stories_education_1",
  "stories_education_2",
  "stories_conversion_1",
  "stories_conversion_2",
  "ads",
  "calendar",
] as const;
type Section = typeof SECTIONS[number];

const EXPECTED_EXECUTION_FILES = EXECUTION_FILE_COUNT;

const CONTEXT_BY_SECTION: Record<Section, number[]> = {
  organic_reels_1: [0, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15],
  organic_reels_2: [0, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15],
  organic_reels_3: [0, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15],
  organic_reels_4: [0, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15],
  organic_carousels_1: [0, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15],
  organic_carousels_2: [0, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15],
  organic_feed_posts_1: [0, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15],
  organic_feed_posts_2: [0, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15],
  stories_education_1: [0, 2, 4, 5, 7, 10, 13, 14, 15],
  stories_education_2: [0, 2, 4, 5, 7, 10, 13, 14, 15],
  stories_conversion_1: [0, 2, 4, 5, 7, 10, 13, 14, 15],
  stories_conversion_2: [0, 2, 4, 5, 7, 10, 13, 14, 15],
  ads: [0, 2, 3, 4, 5, 6, 7, 11, 14],
  calendar: [13, 15],
};

// Keep each provider call well below the Edge Function timeout. Phase 1 files
// can be long; each bounded Phase 2 group needs the relevant authority, not
// every paragraph verbatim. Execution documents also receive the generated
// master rows, so their per-file authority excerpt can be smaller.
const CONTEXT_CHARS_PER_FILE: Record<Section, number> = {
  organic_reels_1: 700,
  organic_reels_2: 700,
  organic_reels_3: 700,
  organic_reels_4: 700,
  organic_carousels_1: 700,
  organic_carousels_2: 700,
  organic_feed_posts_1: 700,
  organic_feed_posts_2: 700,
  stories_education_1: 800,
  stories_education_2: 800,
  stories_conversion_1: 800,
  stories_conversion_2: 800,
  ads: 1200,
  calendar: 700,
};

interface ContextFile {
  file_number: number;
  file_name: string;
  content_md: string | null;
  status: string;
}

interface ExecutionFile {
  file_number: number | null;
  file_name: string;
  content_md: string | null;
  review_state: string;
}

interface ModelResult {
  ok: boolean;
  value?: Record<string, unknown>;
  error?: string;
  retried?: boolean;
}

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
  if (error) console.error("[generate-phase-3] activity_log:", error.message);
}

function failure(
  status: number,
  stage: string,
  error: string,
  options: {
    clientId?: string;
    executionMonth?: string;
    section?: string;
    details?: string | string[];
    data?: Record<string, unknown>;
  } = {},
): Response {
  return json({
    ok: false,
    mode: status === 409 ? "blocked" : "error",
    function: "generate-phase-3",
    stage,
    section: options.section,
    client_id: options.clientId,
    execution_month: options.executionMonth,
    error,
    details: options.details,
    message: options.section
      ? `generate-phase-3 failed for ${options.section}: ${error}`
      : error,
    warnings: [],
    missingContextFiles: [],
    data: options.data,
  }, status);
}

function cleanAuthorityText(value: string): string {
  return value
    .replace(/Proof Brand Lite/gi, "[deprecated legacy offer removed]")
    .replace(/Proof Engine Buildout/gi, "[deprecated legacy offer removed]")
    .replace(/Authority Brand/gi, "[deprecated legacy offer removed]")
    .replace(/\bZAR\b/gi, "South African Rand")
    .replace(/\bR\d{1,3}(?:,\d{3})+\b/g, "[legacy South African Rand amount removed]")
    .replace(/\bR\d{4,}\b/g, "[legacy South African Rand amount removed]");
}

const FORBIDDEN_OUTPUT: Array<{ label: string; pattern: RegExp }> = [
  { label: "deprecated legacy offer", pattern: /Proof Brand Lite|Proof Engine Buildout|Authority Brand/i },
  { label: "legacy currency token", pattern: /\bZAR\b|\bR\d{4,}|\bR\d{1,3}(?:,\d{3})+/i },
  { label: "guaranteed outcome claim", pattern: /guaranteed (?:leads|results|revenue|roi)/i },
  { label: "invented client outcome framing", pattern: /our clients (?:achieved|generated|saw|increased|grew)/i },
  { label: "invented trust claim", pattern: /trusted by (?:hundreds|thousands|leading|top)/i },
  { label: "invented ROI claim", pattern: /\b(?:roi of|\d+(?:\.\d+)?x roi|\d+(?:\.\d+)?% roi)\b/i },
  { label: "invented testimonial framing", pattern: /\b(?:client )?testimonial:\s*(?!not provided|none|absent|unavailable)/i },
  { label: "invented case-study framing", pattern: /\bcase stud(?:y|ies):\s*(?!not provided|none|absent|unavailable)/i },
];

function validateHonesty(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  // Generated QA/constraint sections must be allowed to name prohibited claims.
  // Remove only a sentence that contains both a forbidden pattern and an
  // explicit prohibition marker; affirmative sentences remain scannable.
  const prohibition = /\b(?:do not|never|must not|cannot|avoid|forbidden|not claim|not use|not invent|not guaranteed|no guarantees?|without guarantees?|no testimonials?|no case stud(?:y|ies)|no fabricated|no guaranteed)\b/i;
  const scannable = text.split(/(?<=[.!?\n])/).map((sentence) => {
    const namesForbiddenClaim = FORBIDDEN_OUTPUT.some(({ pattern }) => pattern.test(sentence));
    return namesForbiddenClaim && prohibition.test(sentence) ? "[explicit proof-honesty constraint]" : sentence;
  }).join("");
  return FORBIDDEN_OUTPUT.filter(({ pattern }) => pattern.test(scannable)).map(({ label }) => label);
}

function extractJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text.trim()) as Record<string, unknown>; } catch { /* continue */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) {
    try { return JSON.parse(fenced[1]) as Record<string, unknown>; } catch { /* continue */ }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { /* continue */ }
  }
  return null;
}

async function callStructuredModel(
  system: string,
  user: string,
  maxTokens: number,
): Promise<ModelResult> {
  const modelName = Deno.env.get("AA_PHASE2_AI_MODEL") ?? "claude-sonnet-4-6";
  const first = await callAnthropic({
    system,
    user,
    model: modelName,
    maxTokens,
    timeoutMs: 120_000,
  });
  if (!first.ok) return { ok: false, error: first.error };
  const parsed = extractJson(first.text);
  if (parsed) return { ok: true, value: parsed };

  const retry = await callAnthropic({
    system: `${system}\n\nFORMAT RETRY: Return one compact valid JSON object only. Escape newlines inside JSON strings as \\n. No markdown fences or surrounding text.`,
    user,
    model: modelName,
    maxTokens,
    timeoutMs: 120_000,
  });
  if (!retry.ok) return { ok: false, error: retry.error, retried: true };
  const retryParsed = extractJson(retry.text);
  return retryParsed
    ? { ok: true, value: retryParsed, retried: true }
    : { ok: false, error: "AI provider returned invalid JSON after one format retry.", retried: true };
}

async function loadAuthority(sb: ReturnType<typeof svc>, clientId: string, executionMonth: string) {
  const [clientRes, filesRes, executionRes] = await Promise.all([
    sb.from("clients").select("id, name, package_tier, stage1_status, stage2_status").eq("id", clientId).maybeSingle(),
    sb.from("client_context_files").select("file_number, file_name, content_md, status").eq("client_id", clientId).order("file_number"),
    sb.from("client_execution_files").select("file_number, file_name, content_md, review_state").eq("client_id", clientId).eq("month", executionMonth).order("file_number"),
  ]);
  if (clientRes.error || !clientRes.data) {
    return { ok: false as const, status: 404, error: clientRes.error?.message ?? "Client not found." };
  }
  if (filesRes.error || executionRes.error) return { ok: false as const, status: 500, error: filesRes.error?.message ?? executionRes.error?.message ?? "Authority query failed." };
  const files = (filesRes.data ?? []) as ContextFile[];
  const executionFiles = (executionRes.data ?? []) as ExecutionFile[];
  const approved = files.filter((file) => file.status === "approved");
  const numbers = new Set(files.map((file) => file.file_number));
  const missing = Array.from({ length: EXPECTED_CONTEXT_FILES }, (_, number) => number)
    .filter((number) => !numbers.has(number));
  const needsReview = files.filter((file) => file.status === "needs_review").length;
  const needsClientInput = files.filter((file) => file.status === "needs_client_input").length;
  const approvedExecution = executionFiles.filter((file) => file.review_state === "approved");
  const missingExecution = EXECUTION_FILE_MANIFEST.filter((definition) => !executionFiles.some((file) =>
    file.file_number === definition.fileNumber && file.file_name === definition.fileName
  ));
  if (
    clientRes.data.stage1_status !== "complete" ||
    files.length !== EXPECTED_CONTEXT_FILES ||
    approved.length !== EXPECTED_CONTEXT_FILES ||
    missing.length > 0 ||
    clientRes.data.stage2_status !== "complete" ||
    executionFiles.length !== EXPECTED_EXECUTION_FILES ||
    approvedExecution.length !== EXPECTED_EXECUTION_FILES ||
    missingExecution.length > 0
  ) {
    return {
      ok: false as const,
      status: 409,
      error: "Phase 3 requires Phase 1 complete, all 21 context files approved, Phase 2 complete, and all 11 canonical execution files approved.",
      counts: {
        total: files.length,
        approved: approved.length,
        needs_review: needsReview,
        needs_client_input: needsClientInput,
        missing: missing.length,
        missing_file_numbers: missing,
        execution_total: executionFiles.length,
        execution_approved: approvedExecution.length,
        execution_needs_review: executionFiles.filter((file) => file.review_state === "needs_review").length,
        execution_missing: missingExecution.map((definition) => definition.code),
      },
    };
  }
  return { ok: true as const, client: clientRes.data, files, executionFiles };
}

function contextFor(files: ContextFile[], section: Section): string {
  const wanted = new Set(CONTEXT_BY_SECTION[section]);
  const maxChars = CONTEXT_CHARS_PER_FILE[section];
  const format: Phase3AuthorityFormat | null = section.startsWith("organic_feed_posts") ? "feed_post"
    : section.startsWith("organic_carousels") ? "carousel"
    : section.startsWith("organic_reels") ? "reel_video"
    : section.startsWith("stories_") ? "story_sequence"
    : section === "ads" ? "ad_static"
    : null;
  return files
    .filter((file) => wanted.has(file.file_number))
    .map((file) => `\n===== APPROVED ${file.file_name} =====\n${buildPhase3ContextFileExcerpt(
      { ...file, content_md: cleanAuthorityText(file.content_md ?? "[EMPTY APPROVED FILE]") },
      format,
      maxChars,
    )}`)
    .join("\n");
}

function executionAuthority(files: ExecutionFile[], section: Section): string {
  const relevant = section.startsWith("organic_") ? new Set([1, 2, 5, 6, 7, 8, 9, 10, 11])
    : section.startsWith("stories_") ? new Set([1, 4, 5, 6, 7, 8, 9, 10, 11])
    : section === "ads" ? new Set([1, 3, 5, 6, 7, 8, 9, 10, 11])
    : new Set(EXECUTION_FILE_MANIFEST.map((definition) => definition.fileNumber));
  return files.filter((file) => relevant.has(file.file_number ?? -1)).map((file) =>
    `\n===== APPROVED PHASE 2 ${file.file_name} =====\n${cleanAuthorityText(file.content_md ?? "[EMPTY APPROVED EXECUTION FILE]").slice(0, 900)}`
  ).join("\n");
}

function systemPrompt(section: Section): string {
  return `You generate the ${section} section of an Attract Acquisition Phase 3 master pack from APPROVED Phase 1 context files and APPROVED Phase 2 execution files.

SOURCE AUTHORITY:
- Approved context files are authoritative. Do not contradict or embellish them.
- The business is pre-launch unless approved context explicitly says otherwise.
- External client proof is absent. Founder/infrastructure proof is not external client outcome proof.
- Instagram is primary. Do not resolve an undecided secondary platform.
- Website deployment and social handles remain unverified unless approved context says otherwise.

COMMERCIAL AUTHORITY:
- Active ladder only: Proof Sprint, Proof Brand, Proof Brand Scale.
- Proof Sprint is the lower-risk diagnostic entry point.
- Proof Brand is the core system.
- Proof Brand Scale is a capacity/distribution upgrade, not a separate method.
- Never name deprecated legacy offers. Never include legacy South African Rand pricing.

PROOF HONESTY — ABSOLUTE:
- Never invent testimonials, case studies, client logos, external client results, revenue, leads, ROI, conversion data, or performance metrics.
- Never imply prior AA client outcomes. Never claim "our clients achieved" or "trusted by".
- Never guarantee leads, revenue, ROI, or results. Never create fake scarcity.
- Proof gaps must remain explicit. Use founder/infrastructure proof only with accurate attribution.

OUTPUT:
- Return exactly one valid JSON object matching the requested schema.
- No markdown fences or prose outside JSON.
- Every generated database row is a needs_review draft, never approved or live.`;
}

function rows(value: Record<string, unknown>, key: string): Array<Record<string, unknown>> | null {
  const candidate = value[key];
  return Array.isArray(candidate) && candidate.every((row) => row && typeof row === "object")
    ? candidate as Array<Record<string, unknown>>
    : null;
}

function stringValue(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Ref prefix is MONTHDAY of the row's own scheduled/distribution date, e.g.
// "2026-07-01" -> "JUL01". (Superseded the month-year prefix like "JUL26"; old
// month-year refs remain valid because nothing parses the prefix — type is read
// from the -AD-/-ST-/-CR- segment and rows are matched by the full ref string.)
function dayPrefix(date: string): string {
  const [year, monthNumber, day] = date.split("-").map(Number);
  if (!year || !monthNumber || !day) throw new Error(`Cannot derive ref prefix from date "${date}".`);
  const label = new Date(Date.UTC(year, monthNumber - 1, day))
    .toLocaleString("en", { month: "short", timeZone: "UTC" }).toUpperCase();
  return `${label}${String(day).padStart(2, "0")}`;
}

function datesForWeekdays(month: string, weekdays: number[], count: number): string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const matches: string[] = [];
  for (let day = 1; day <= days && matches.length < count; day += 1) {
    if (weekdays.includes(new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDay())) {
      matches.push(`${month}-${String(day).padStart(2, "0")}`);
    }
  }
  if (matches.length !== count) throw new Error(`Could not schedule ${count} assets in ${month} for weekdays ${weekdays.join(",")}.`);
  return matches;
}

function dailyDates(month: string, startDay: number, count: number): string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  if (startDay + count - 1 > days) throw new Error(`Daily schedule exceeds ${month}.`);
  return Array.from({ length: count }, (_, index) => `${month}-${String(startDay + index).padStart(2, "0")}`);
}

async function markFailed(sb: ReturnType<typeof svc>, clientId: string, stage: string, details: unknown) {
  await writeActivity(sb, clientId, "phase3_failed", `Phase 3 failed at ${stage}.`, { stage, details });
}

async function generateOrganic(
  sb: ReturnType<typeof svc>, clientId: string, month: string, files: ContextFile[], executionFiles: ExecutionFile[],
  section: Extract<Section, `organic_${string}`>,
): Promise<{ count: number; retried: boolean }> {
  const spec = {
    organic_reels_1: { contentType: "RL", count: 4, offset: 0, label: "Instagram Reels (batch 1)", weekdays: [1, 2, 4, 6], dateOffset: 0 },
    organic_reels_2: { contentType: "RL", count: 4, offset: 4, label: "Instagram Reels (batch 2)", weekdays: [1, 2, 4, 6], dateOffset: 4 },
    organic_reels_3: { contentType: "RL", count: 4, offset: 8, label: "Instagram Reels (batch 3)", weekdays: [1, 2, 4, 6], dateOffset: 8 },
    organic_reels_4: { contentType: "RL", count: 4, offset: 12, label: "Instagram Reels (batch 4)", weekdays: [1, 2, 4, 6], dateOffset: 12 },
    organic_carousels_1: { contentType: "CR", count: 4, offset: 0, label: "Instagram Carousels (batch 1)", weekdays: [3, 5], dateOffset: 0 },
    organic_carousels_2: { contentType: "CR", count: 4, offset: 4, label: "Instagram Carousels (batch 2)", weekdays: [3, 5], dateOffset: 4 },
    organic_feed_posts_1: { contentType: "FP", count: 4, offset: 0, label: "Instagram Static Feed Posts (batch 1)", weekdays: [0, 3], dateOffset: 0 },
    organic_feed_posts_2: { contentType: "FP", count: 4, offset: 4, label: "Instagram Static Feed Posts (batch 2)", weekdays: [0, 3], dateOffset: 4 },
  }[section];
  const prompt = `${contextFor(files, section)}
${executionAuthority(executionFiles, section)}

Generate exactly ${spec.count} row-level ${spec.label} asset plans. Follow E02 quantities/schema, E05 calendar rules, E07 distribution rules, E08 approvals, E10 proof constraints and E11 governance. Every row must use content_type "${spec.contentType}". Each row must be specific enough for downstream production, not a vague pillar. Keep each string under 180 characters so the JSON completes.
Themes should include proof visibility, hidden competence, market trust, authority positioning, proof-led demand, generic-agency failure, AI-without-positioning noise, repeated proof visibility, and the active offer ladder.

JSON schema:
{"organic":[{"content_type":"${spec.contentType}","archetype":"string","pillar":"string","working_title":"specific asset idea/title","the_one_person":"specific audience","one_belief_to_change":"string","hook":"string","core_message":"string","cta":"string","storyboard_outline":"concise shot/slide direction","caption_script":"caption direction or concise draft","source_origin":"approved C/E file refs","distribution_channel":"Instagram","production_brief":"generation/production prompt","psychological_angle":"objective and offer alignment","notes":"proof source/constraint; approval/distribution state"}]}`;
  const model = await callStructuredModel(systemPrompt(section), prompt, 3200);
  if (!model.ok || !model.value) throw new Error(model.error ?? "Organic generation failed.");
  const generated = rows(model.value, "organic");
  if (!generated || generated.length !== spec.count) throw new Error(`${section} output must contain exactly ${spec.count} rows.`);
  const types = generated.map((row) => stringValue(row, "content_type"));
  if (types.some((type) => type !== spec.contentType)) throw new Error(`${section} must use content_type ${spec.contentType}.`);
  const honesty = validateHonesty(generated);
  if (honesty.length) throw new Error(`Organic validation failed: ${honesty.join(", ")}.`);

  const allDates = datesForWeekdays(month, spec.weekdays, spec.count + spec.dateOffset);
  const dates = allDates.slice(spec.dateOffset, spec.dateOffset + spec.count);
  const payload = generated.map((row, index) => {
    const contentType = stringValue(row, "content_type")!;
    return {
      client_id: clientId,
      month,
      // Prefix = this row's distribution date (MONTHDAY); sequence stays per-type.
      ref: `${dayPrefix(dates[index])}-${contentType}-${String(spec.offset + index + 1).padStart(3, "0")}`,
      review_state: "needs_review",
      status: "idea",
      content_type: contentType,
      archetype: stringValue(row, "archetype"),
      pillar: stringValue(row, "pillar"),
      working_title: stringValue(row, "working_title"),
      the_one_person: stringValue(row, "the_one_person"),
      one_belief_to_change: stringValue(row, "one_belief_to_change"),
      hook: stringValue(row, "hook"),
      core_message: stringValue(row, "core_message"),
      cta: stringValue(row, "cta"),
      storyboard_outline: stringValue(row, "storyboard_outline"),
      caption_script: stringValue(row, "caption_script"),
      source_origin: stringValue(row, "source_origin"),
      distribution_date: dates[index],
      distribution_channel: stringValue(row, "distribution_channel") ?? "Instagram",
      production_brief: stringValue(row, "production_brief"),
      psychological_angle: stringValue(row, "psychological_angle"),
      format_proven: false,
      notes: stringValue(row, "notes"),
    };
  });
  const { error } = await sb.from("organic_master").insert(payload);
  if (error) throw new Error(`organic_master insert failed: ${error.message} (${error.code})`);
  return { count: payload.length, retried: model.retried ?? false };
}

async function generateStories(
  sb: ReturnType<typeof svc>, clientId: string, month: string, files: ContextFile[], executionFiles: ExecutionFile[],
  section: Extract<Section, `stories_${string}`>,
): Promise<{ count: number; retried: boolean }> {
  const isEducation = section.includes("education");
  const secondBatch = section.endsWith("_2");
  const count = 7;
  const offset = isEducation ? (secondBatch ? 7 : 0) : (secondBatch ? 21 : 14);
  const direction = isEducation
    ? "proof-led education, founder/infrastructure proof with attribution, behind-the-build context, and polls"
    : "objection handling, offer education, FAQ, and honest DM prompts";
  const prompt = `${contextFor(files, section)}
${executionAuthority(executionFiles, section)}

Generate exactly ${count} row-level Instagram story sequences focused on ${direction}. Follow E04 sequence/frame rules, E05 dates, E07 distribution, E08 approvals, E10 proof restrictions and E11 governance. These are distinct daily sequences, not generic themes. Do not imply external client outcomes. Keep each string under 160 characters so the JSON completes.

JSON schema:
{"stories":[{"story_type":"daily|sequence|poll|dm_prompt|proof|offer|bts|faq","story_theme":"string","pillar":"string","frame_1":"string","frame_2":"string","frame_3":"string","frame_4_optional":"string or null","cta_engagement_prompt":"string","proof_used":"string or explicit no external proof","source_origin":"approved context file names","what_not_to_claim":"string","notes":"string"}]}`;
  const model = await callStructuredModel(systemPrompt(section), prompt, 4200);
  if (!model.ok || !model.value) throw new Error(model.error ?? "Story generation failed.");
  const generated = rows(model.value, "stories");
  if (!generated || generated.length !== count) throw new Error(`${section} output must contain exactly ${count} rows.`);
  const allowed = new Set(["daily", "sequence", "poll", "dm_prompt", "proof", "offer", "bts", "faq"]);
  if (generated.some((row) => !allowed.has(stringValue(row, "story_type") ?? ""))) throw new Error("Story output contains an invalid story_type.");
  const honesty = validateHonesty(generated);
  if (honesty.length) throw new Error(`Story validation failed: ${honesty.join(", ")}.`);
  const dates = dailyDates(month, offset + 1, generated.length);
  const payload = generated.map((row, index) => ({
    client_id: clientId,
    month,
    // Prefix = this story's distribution date (MONTHDAY); sequence stays per-type.
    ref: `${dayPrefix(dates[index])}-ST-${String(offset + index + 1).padStart(3, "0")}`,
    review_state: "needs_review",
    status: "idea",
    story_type: stringValue(row, "story_type"),
    story_theme: stringValue(row, "story_theme"),
    pillar: stringValue(row, "pillar"),
    frame_1: stringValue(row, "frame_1"),
    frame_2: stringValue(row, "frame_2"),
    frame_3: stringValue(row, "frame_3"),
    frame_4_optional: stringValue(row, "frame_4_optional"),
    cta_engagement_prompt: stringValue(row, "cta_engagement_prompt"),
    proof_used: stringValue(row, "proof_used"),
    source_origin: stringValue(row, "source_origin"),
    distribution_date: dates[index],
    what_not_to_claim: stringValue(row, "what_not_to_claim"),
    notes: stringValue(row, "notes"),
  }));
  const { error } = await sb.from("story_master").insert(payload);
  if (error) throw new Error(`story_master insert failed: ${error.message} (${error.code})`);
  return { count: payload.length, retried: model.retried ?? false };
}

async function generateAds(
  sb: ReturnType<typeof svc>, clientId: string, month: string, files: ContextFile[], executionFiles: ExecutionFile[],
): Promise<{ count: number; retried: boolean }> {
  const prompt = `${contextFor(files, "ads")}
${executionAuthority(executionFiles, "ads")}

Generate exactly 4 Meta campaign-stint plans governed by E03, E05, E07, E08, E09, E10 and E11: diagnostic awareness, Proof Sprint consideration, Proof Brand qualification, and an honest retargeting/capacity stint aligned to the approved ladder. Each row is a multi-day campaign stint, not a one-day post. No outcome guarantees, invented metrics, fake proof, or fabricated case studies.

JSON schema:
{"ads":[{"stint_name":"string","objective":"string","funnel_stage":"awareness|consideration|qualification","budget_split":"qualitative only; no invented amount","primary_goal":"string","conversion_action":"string","meta_objective":"string","audience":"string","creative_source":"approved context / founder infrastructure proof / proof gap","hook_angle":"string","kpi_watch":"what to measure once live; no fabricated baseline","feeds_into":"string","notes":"proof constraint"}]}`;
  const model = await callStructuredModel(systemPrompt("ads"), prompt, 2400);
  if (!model.ok || !model.value) throw new Error(model.error ?? "Ads generation failed.");
  const generated = rows(model.value, "ads");
  if (!generated || generated.length !== PHASE3_EXPECTED_COUNTS.ads) throw new Error(`Ads output must contain exactly ${PHASE3_EXPECTED_COUNTS.ads} rows.`);
  const honesty = validateHonesty(generated);
  if (honesty.length) throw new Error(`Ads validation failed: ${honesty.join(", ")}.`);
  const ranges = canonicalAdRanges(month);
  const payload = generated.map((row, index) => {
    const startDate = `${month}-${String(ranges[index].startDay).padStart(2, "0")}`;
    return {
    client_id: clientId,
    month,
    // Prefix = this campaign stint's start date (MONTHDAY); sequence stays per-type.
    ref: `${dayPrefix(startDate)}-AD-${String(index + 1).padStart(3, "0")}`,
    review_state: "needs_review",
    status: "planned",
    lane: ranges[index].lane,
    stint_name: stringValue(row, "stint_name"),
    objective: stringValue(row, "objective"),
    funnel_stage: stringValue(row, "funnel_stage"),
    start_date: startDate,
    end_date: `${month}-${String(ranges[index].endDay).padStart(2, "0")}`,
    days: ranges[index].endDay - ranges[index].startDay + 1,
    budget_split: stringValue(row, "budget_split"),
    primary_goal: stringValue(row, "primary_goal"),
    conversion_action: stringValue(row, "conversion_action"),
    meta_objective: stringValue(row, "meta_objective"),
    audience: stringValue(row, "audience"),
    creative_source: stringValue(row, "creative_source"),
    hook_angle: stringValue(row, "hook_angle"),
    kpi_watch: stringValue(row, "kpi_watch"),
    feeds_into: stringValue(row, "feeds_into"),
    notes: stringValue(row, "notes"),
    };
  });
  const { error } = await sb.from("ads_master").insert(payload);
  if (error) throw new Error(`ads_master insert failed: ${error.message} (${error.code})`);
  return { count: payload.length, retried: model.retried ?? false };
}

async function generateCalendar(
  sb: ReturnType<typeof svc>, clientId: string, month: string,
): Promise<{ count: number; retried: boolean }> {
  const [organicRes, storyRes, adsRes] = await Promise.all([
    sb.from("organic_master").select("ref, content_type, distribution_date").eq("client_id", clientId).eq("month", month),
    sb.from("story_master").select("ref, distribution_date").eq("client_id", clientId).eq("month", month),
    sb.from("ads_master").select("ref, lane, start_date, end_date").eq("client_id", clientId).eq("month", month),
  ]);
  if (organicRes.error || storyRes.error || adsRes.error) throw new Error("Calendar source rows could not be loaded.");
  const organic = organicRes.data ?? [];
  const stories = storyRes.data ?? [];
  const ads = adsRes.data ?? [];
  if (organic.length !== PHASE3_EXPECTED_COUNTS.organic || stories.length !== PHASE3_EXPECTED_COUNTS.story || ads.length !== PHASE3_EXPECTED_COUNTS.ads) {
    throw new Error(`Calendar requires completed masters; found organic=${organic.length}, stories=${stories.length}, ads=${ads.length}.`);
  }
  function inclusiveDates(start: string | null, end: string | null): string[] {
    if (!start || !end || !start.startsWith(`${month}-`) || !end.startsWith(`${month}-`)) throw new Error(`Ad range ${start ?? "missing"} to ${end ?? "missing"} is invalid for ${month}.`);
    const first = new Date(`${start}T00:00:00Z`); const last = new Date(`${end}T00:00:00Z`);
    if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime()) || first > last) throw new Error(`Invalid ad date range ${start} to ${end}.`);
    const dates: string[] = [];
    for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
    return dates;
  }
  const organicType: Record<string, string> = { RL: "reel", FP: "feed_posts", CR: "carousels" };
  const payload = [
    ...organic.map((row) => ({
      client_id: clientId, month, date: row.distribution_date,
      row_type: organicType[row.content_type], ref: row.ref, review_state: "needs_review",
    })),
    ...stories.map((row) => ({
      client_id: clientId, month, date: row.distribution_date,
      row_type: "stories", ref: row.ref, review_state: "needs_review",
    })),
    ...ads.flatMap((row) => inclusiveDates(row.start_date, row.end_date).map((date) => ({
      client_id: clientId, month, date,
      row_type: String(row.lane).toLowerCase().replace(" ", ""), ref: row.ref, review_state: "needs_review",
    }))),
  ];
  const expected = expectedCalendarCellCount(month);
  if (payload.length !== expected) throw new Error(`Calendar expected ${expected} deterministic cells, built ${payload.length}.`);
  if (payload.some((row) => !row.date || !row.row_type || !row.ref)) throw new Error("Calendar source row is missing date, type, or ref.");
  const { error } = await sb.from("calendar_cells").insert(payload);
  if (error) throw new Error(`calendar_cells insert failed: ${error.message} (${error.code})`);
  return { count: payload.length, retried: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return failure(405, "validate_request", "POST only");

  let clientId = "";
  let executionMonth = "";
  let action = "prepare";
  let section = "";
  const sb = svc();

  try {
    const body = await req.json() as { client_id?: string; execution_month?: string; action?: string; section?: string };
    clientId = body.client_id ?? "";
    executionMonth = body.execution_month ?? "";
    action = body.action ?? "prepare";
    section = body.section ?? "";

    if (!clientId) return failure(400, "validate_request", "client_id required");
    if (!MONTH_RE.test(executionMonth)) return failure(400, "validate_request", "execution_month required in YYYY-MM format", { clientId });
    if (!new Set(["prepare", "section", "finalize"]).has(action)) return failure(400, "validate_request", "action must be prepare, section, or finalize", { clientId, executionMonth });

    const authority = await loadAuthority(sb, clientId, executionMonth);
    if (!authority.ok) {
      return failure(authority.status, "validate_approved_context", authority.error, {
        clientId,
        executionMonth,
        data: "counts" in authority ? authority.counts : undefined,
      });
    }

    if (action === "prepare") {
      if (!isAiEnabled() || !hasAnthropicKey()) {
        return failure(500, "validate_ai_configuration", "AI generation is not configured.", {
          clientId, executionMonth, details: "Server-side AI gate or provider secret is unavailable.",
        });
      }
      const deletions = await Promise.all([
        sb.from("calendar_cells").delete().eq("client_id", clientId).eq("month", executionMonth),
        sb.from("organic_master").delete().eq("client_id", clientId).eq("month", executionMonth),
        sb.from("story_master").delete().eq("client_id", clientId).eq("month", executionMonth),
        sb.from("ads_master").delete().eq("client_id", clientId).eq("month", executionMonth),
      ]);
      const deleteError = deletions.find((result) => result.error)?.error;
      if (deleteError) return failure(500, "clear_previous_pack", "Could not clear the previous Phase 3 masters/calendar pack.", { clientId, executionMonth, details: deleteError.message });
      await writeActivity(sb, clientId, "phase3_started", `Phase 3 generation started for ${executionMonth}.`, {
        execution_month: executionMonth,
        approved_context_files: authority.files.length,
        approved_execution_files: authority.executionFiles.length,
        sections: SECTIONS,
      });
      return json({
        ok: true,
        mode: "generation_started",
        client_id: clientId,
        execution_month: executionMonth,
        message: `Phase 3 prepared. ${SECTIONS.length} master/calendar sections will generate sequentially.`,
        warnings: [],
        missingContextFiles: [],
        data: { sections: SECTIONS.map((name, index) => ({ name, position: index + 1 })), approved_context_files: 21 },
      });
    }

    if (action === "section") {
      if (!SECTIONS.includes(section as Section)) return failure(400, "validate_section", `Unknown section "${section}".`, { clientId, executionMonth, section });
      if (!isAiEnabled() || !hasAnthropicKey()) return failure(500, "validate_ai_configuration", "AI generation is not configured.", { clientId, executionMonth, section });
      const sectionName = section as Section;
      let clearQuery;
      // Re-running a section clears just that batch's rows first. Match by the
      // ref's stable {TYPE}-{SEQUENCE} suffix (unique per type within a month) so
      // it is independent of the date prefix — this deletes both new MONTHDAY refs
      // and any legacy MONTHYEAR refs for the batch.
      if (sectionName.startsWith("organic_")) {
        const batch = Number(sectionName.at(-1));
        const type = sectionName.includes("reels") ? "RL" : sectionName.includes("carousels") ? "CR" : "FP";
        const start = (batch - 1) * 4 + 1;
        const numbers = Array.from({ length: 4 }, (_, index) => start + index);
        const orFilter = numbers.map((number) => `ref.like.*-${type}-${String(number).padStart(3, "0")}`).join(",");
        clearQuery = sb.from("organic_master").delete().eq("client_id", clientId).eq("month", executionMonth).or(orFilter);
      } else if (sectionName.startsWith("stories_")) {
        const education = sectionName.includes("education");
        const secondBatch = sectionName.endsWith("_2");
        const start = education ? (secondBatch ? 8 : 1) : (secondBatch ? 22 : 15);
        const orFilter = Array.from({ length: 7 }, (_, index) => `ref.like.*-ST-${String(start + index).padStart(3, "0")}`).join(",");
        clearQuery = sb.from("story_master").delete().eq("client_id", clientId).eq("month", executionMonth).or(orFilter);
      } else if (sectionName === "ads") {
        clearQuery = sb.from("ads_master").delete().eq("client_id", clientId).eq("month", executionMonth);
      } else {
        clearQuery = sb.from("calendar_cells").delete().eq("client_id", clientId).eq("month", executionMonth);
      }
      const { error: clearError } = await clearQuery;
      if (clearError) throw new Error(`Could not clear output for ${sectionName}: ${clearError.message}`);

      await writeActivity(sb, clientId, "phase3_section_started", `Generating Phase 3 section ${sectionName}.`, { execution_month: executionMonth, section: sectionName });
      let result: { count: number; retried: boolean };
      if (sectionName.startsWith("organic_")) result = await generateOrganic(
        sb, clientId, executionMonth, authority.files, authority.executionFiles,
        sectionName as Extract<Section, `organic_${string}`>,
      );
      else if (sectionName.startsWith("stories_")) result = await generateStories(
        sb, clientId, executionMonth, authority.files, authority.executionFiles,
        sectionName as Extract<Section, `stories_${string}`>,
      );
      else if (sectionName === "ads") result = await generateAds(sb, clientId, executionMonth, authority.files, authority.executionFiles);
      else result = await generateCalendar(sb, clientId, executionMonth);

      await writeActivity(sb, clientId, "phase3_section_completed", `Phase 3 section ${sectionName} generated ${result.count} row(s).`, {
        execution_month: executionMonth, section: sectionName, row_count: result.count, format_retry_used: result.retried,
      });
      return json({
        ok: true,
        mode: "section_generated",
        client_id: clientId,
        execution_month: executionMonth,
        message: `${sectionName} generated (${result.count} row(s)).`,
        warnings: [], missingContextFiles: [],
        data: { section: sectionName, row_count: result.count, format_retry_used: result.retried },
      });
    }

    // Finalize: deterministic count/integrity gate, then the existing validator.
    const [organicRes, storyRes, adsRes, cellsRes] = await Promise.all([
      sb.from("organic_master").select("*").eq("client_id", clientId).eq("month", executionMonth),
      sb.from("story_master").select("*").eq("client_id", clientId).eq("month", executionMonth),
      sb.from("ads_master").select("*").eq("client_id", clientId).eq("month", executionMonth),
      sb.from("calendar_cells").select("*").eq("client_id", clientId).eq("month", executionMonth),
    ]);
    const queryError = [organicRes, storyRes, adsRes, cellsRes].find((result) => result.error)?.error;
    if (queryError) throw new Error(`Finalize query failed: ${queryError.message}`);
    const counts = {
      organic_master: organicRes.data?.length ?? 0,
      story_master: storyRes.data?.length ?? 0,
      ads_master: adsRes.data?.length ?? 0,
      calendar_cells: cellsRes.data?.length ?? 0,
    };
    const countErrors: string[] = [];
    if (counts.organic_master !== PHASE3_EXPECTED_COUNTS.organic) countErrors.push(`organic_master expected ${PHASE3_EXPECTED_COUNTS.organic}, found ${counts.organic_master}`);
    if (counts.story_master !== PHASE3_EXPECTED_COUNTS.story) countErrors.push(`story_master expected ${PHASE3_EXPECTED_COUNTS.story}, found ${counts.story_master}`);
    if (counts.ads_master !== PHASE3_EXPECTED_COUNTS.ads) countErrors.push(`ads_master expected ${PHASE3_EXPECTED_COUNTS.ads}, found ${counts.ads_master}`);
    const expectedCells = expectedCalendarCellCount(executionMonth);
    if (counts.calendar_cells !== expectedCells) countErrors.push(`calendar_cells expected ${expectedCells}, found ${counts.calendar_cells}`);
    const honestyErrors = validateHonesty({
      organic: organicRes.data, stories: storyRes.data, ads: adsRes.data,
    });
    if (honestyErrors.length) countErrors.push(`forbidden output: ${honestyErrors.join(", ")}`);
    if (countErrors.length) {
      await markFailed(sb, clientId, "finalize_pack", countErrors);
      return failure(422, "finalize_pack", "Phase 3 masters/calendar pack failed deterministic validation.", {
        clientId, executionMonth, details: countErrors, data: counts,
      });
    }

    const { data: validation, error: validationError } = await sb.functions.invoke("validate-execution-pack", {
      body: { client_id: clientId, execution_month: executionMonth, validation_mode: "masters" },
    });
    if (validationError || !validation?.ok) {
      const details = validation?.errors ?? validationError?.message ?? "Validator rejected the Phase 3 pack.";
      await markFailed(sb, clientId, "validate_masters_pack", details);
      return failure(422, "validate_masters_pack", "validate-execution-pack rejected the Phase 3 masters/calendar output.", {
        clientId, executionMonth, details, data: counts,
      });
    }

    await writeActivity(sb, clientId, "phase3_completed", `Phase 3 complete for ${executionMonth}.`, {
      execution_month: executionMonth, counts, validation_warnings: validation.warnings ?? [],
    });
    return json({
      ok: true,
      mode: "generated",
      client_id: clientId,
      execution_month: executionMonth,
      message: `Phase 3 complete. ${counts.organic_master} organic, ${counts.story_master} story, ${counts.ads_master} ad, and ${counts.calendar_cells} calendar rows generated.`,
      warnings: validation.warnings ?? [],
      missingContextFiles: [],
      data: { ...counts, validation_errors: validation.errors ?? [], validation_warnings: validation.warnings ?? [] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (clientId) await markFailed(sb, clientId, `${action}${section ? `:${section}` : ""}`, message).catch(() => {});
    return failure(message.includes("timed out") ? 504 : 500, `${action}${section ? `:${section}` : ""}`, "Phase 3 generation failed.", {
      clientId: clientId || undefined,
      executionMonth: executionMonth || undefined,
      section: section || undefined,
      details: message,
    });
  }
});
