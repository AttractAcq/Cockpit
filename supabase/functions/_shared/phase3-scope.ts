// Shared logic for SCOPED Phase 3 generation (range + single-item).
//
// Keeps the month/batch generate-phase-3 engine untouched. Everything here is
// window-driven: a deterministic slot planner enumerates (date, format) slots in
// an inclusive window (cadence clipped to the window), a duplicate classifier
// assigns create/skip/conflict/replace per canonical slot, and one bounded AI
// call per slot produces exactly one master row + one calendar cell (needs_review,
// no brief, no asset). Ref allocation is the DB advisory-lock RPC — never max+1
// in edge code alone.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { callAnthropic } from "./anthropic.ts";
import { EXECUTION_FILE_COUNT } from "./execution-manifest.ts";
import { buildPhase3ContextFileExcerpt } from "./phase3-authority.ts";

const REQUIRED_CONTEXT_FILES = 21;

export type ScopedFormat = "feed_post" | "carousel" | "reel_video" | "story_sequence" | "ad_static";
export type TypeCode = "FP" | "CR" | "RL" | "ST" | "AD";
export type DuplicatePolicy = "skip_existing" | "fill_missing" | "replace_unapproved";
export type SlotAction = "create" | "skip" | "conflict" | "replace";

export const SCOPED_FORMATS: ScopedFormat[] = ["feed_post", "carousel", "reel_video", "story_sequence", "ad_static"];
export const FORMAT_TO_TYPE: Record<ScopedFormat, TypeCode> = {
  feed_post: "FP", carousel: "CR", reel_video: "RL", story_sequence: "ST", ad_static: "AD",
};
const TYPE_TO_MASTER: Record<TypeCode, "organic_master" | "story_master" | "ads_master"> = {
  FP: "organic_master", CR: "organic_master", RL: "organic_master", ST: "story_master", AD: "ads_master",
};
// System-default weekday cadence (0=Sun … 6=Sat), reused from the monthly engine.
const DEFAULT_WEEKDAYS: Record<Exclude<ScopedFormat, "ad_static">, number[]> = {
  reel_video: [1, 2, 4, 6], carousel: [3, 5], feed_post: [0, 3], story_sequence: [0, 1, 2, 3, 4, 5, 6],
};

export interface PlannedSlot {
  slot_key: string;
  planned_date: string;   // YYYY-MM-DD
  end_date: string | null; // ad stint end
  execution_month: string; // YYYY-MM from planned_date
  asset_format: ScopedFormat;
  type_code: TypeCode;
  lane?: string;
}

export interface ClassifiedSlot extends PlannedSlot {
  action: SlotAction;
  existing_ref?: string | null;
  conflict_reason?: string | null;
}

const MONTH_SHORT = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function monthOf(date: string): string { return date.slice(0, 7); }
export function dayPrefix(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) throw new Error(`Bad date ${date}`);
  return `${MONTH_SHORT[m - 1]}${String(d).padStart(2, "0")}`;
}

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime()) || cursor > last) throw new Error(`Invalid window ${start}..${end}`);
  // Guard against runaway windows.
  for (let i = 0; cursor <= last && i < 400; i += 1) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
function weekday(date: string): number { return new Date(`${date}T00:00:00Z`).getUTCDay(); }

// Canonical ad lanes for a month, clipped to the window (Part 7). Each overlapping
// lane becomes one ad_static slot with a deterministic lane-based slot_key.
function adLaneSlots(windowStart: string, windowEnd: string): PlannedSlot[] {
  const months = new Set<string>();
  for (const d of eachDate(windowStart, windowEnd)) months.add(monthOf(d));
  const slots: PlannedSlot[] = [];
  for (const month of months) {
    const [y, m] = month.split("-").map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lanes = [
      { lane: "Ad 1", startDay: 1, endDay: Math.min(14, days), key: "lane-1" },
      { lane: "Ad 2", startDay: Math.min(8, days), endDay: Math.min(21, days), key: "lane-2" },
      { lane: "Ad 3", startDay: Math.min(15, days), endDay: days, key: "lane-3" },
      { lane: "Ad 1", startDay: Math.min(22, days), endDay: days, key: "lane-4" },
    ];
    for (const l of lanes) {
      const laneStart = `${month}-${String(l.startDay).padStart(2, "0")}`;
      const laneEnd = `${month}-${String(l.endDay).padStart(2, "0")}`;
      const clipStart = laneStart < windowStart ? windowStart : laneStart;
      const clipEnd = laneEnd > windowEnd ? windowEnd : laneEnd;
      if (clipStart > clipEnd) continue; // lane outside the window
      slots.push({
        slot_key: `${clipStart}:ad_static:${l.key}`, planned_date: clipStart, end_date: clipEnd,
        execution_month: month, asset_format: "ad_static", type_code: "AD", lane: l.lane,
      });
    }
  }
  return slots;
}

/**
 * Plan deterministic slots for an inclusive window. Cadence priority is resolved
 * by the caller; here we place per-date formats on their cadence weekdays clipped
 * to the window, and ads on clipped canonical lanes. Slot keys are stable and
 * support multiple slots of one format per date in future (…:format:N).
 */
export function planWindowSlots(
  startDate: string, endDate: string, weekdays: Record<Exclude<ScopedFormat, "ad_static">, number[]>,
  formatFilter?: ScopedFormat[],
): PlannedSlot[] {
  const allow = (f: ScopedFormat) => !formatFilter || formatFilter.length === 0 || formatFilter.includes(f);
  const slots: PlannedSlot[] = [];
  for (const date of eachDate(startDate, endDate)) {
    for (const format of ["feed_post", "carousel", "reel_video", "story_sequence"] as const) {
      if (!allow(format)) continue;
      if (!weekdays[format].includes(weekday(date))) continue;
      slots.push({
        slot_key: `${date}:${format}:1`, planned_date: date, end_date: null,
        execution_month: monthOf(date), asset_format: format, type_code: FORMAT_TO_TYPE[format],
      });
    }
  }
  if (allow("ad_static")) slots.push(...adLaneSlots(startDate, endDate));
  slots.sort((a, b) => a.planned_date < b.planned_date ? -1 : a.planned_date > b.planned_date ? 1 : a.slot_key.localeCompare(b.slot_key));
  return slots;
}

/**
 * Single-item planning bypasses cadence entirely: the operator explicitly chose a
 * date + format, so we emit exactly ONE slot for it regardless of weekday. Cadence
 * remains for range mode only. slot_key stays deterministic: {date}:{format}:1.
 */
export function planSingleSlot(plannedDate: string, assetFormat: ScopedFormat): PlannedSlot {
  return {
    slot_key: `${plannedDate}:${assetFormat}:1`,
    planned_date: plannedDate,
    end_date: null, // single-item ad is a single-day stint
    execution_month: monthOf(plannedDate),
    asset_format: assetFormat,
    type_code: FORMAT_TO_TYPE[assetFormat],
    lane: assetFormat === "ad_static" ? "Ad 1" : undefined,
  };
}

/**
 * Resolve cadence weekdays. v1 priority: client-specific approved cadence config
 * (none exists yet → skipped), then the system weekday defaults. Extension point
 * documented for the approved Phase-2 schedule.
 */
export async function resolveCadence(
  _sb: SupabaseClient, _clientId: string,
): Promise<Record<Exclude<ScopedFormat, "ad_static">, number[]>> {
  // No client-specific cadence table exists yet; fall back to system defaults.
  return { ...DEFAULT_WEEKDAYS };
}

// ── Duplicate classification ─────────────────────────────────────────────────
interface ExistingRow { ref: string; review_state: string }

async function existingAtSlot(sb: SupabaseClient, clientId: string, slot: PlannedSlot): Promise<ExistingRow | null> {
  if (slot.type_code === "AD") {
    const { data } = await sb.from("ads_master").select("ref, review_state, lane, start_date")
      .eq("client_id", clientId).eq("month", slot.execution_month).eq("lane", slot.lane ?? "").limit(1);
    const row = (data ?? [])[0];
    return row ? { ref: row.ref as string, review_state: row.review_state as string } : null;
  }
  const table = TYPE_TO_MASTER[slot.type_code];
  let query = sb.from(table).select("ref, review_state").eq("client_id", clientId).eq("month", slot.execution_month).eq("distribution_date", slot.planned_date);
  if (table === "organic_master") query = query.eq("content_type", slot.type_code);
  const { data } = await query.limit(1);
  const row = (data ?? [])[0];
  return row ? { ref: row.ref as string, review_state: row.review_state as string } : null;
}

async function hasDownstream(sb: SupabaseClient, clientId: string, ref: string): Promise<boolean> {
  for (const table of ["client_production_briefs", "client_assets", "client_distribution_records", "client_analytics_records", "client_asset_archive_snapshots"]) {
    const { count } = await sb.from(table).select("id", { count: "exact", head: true }).eq("client_id", clientId).eq("source_ref", ref);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

/** Classify each slot under the duplicate policy. Preview-time (best-effort); the
 *  replace path re-verifies transactionally at execution. */
export async function classifySlots(
  sb: SupabaseClient, clientId: string, slots: PlannedSlot[], policy: DuplicatePolicy,
): Promise<ClassifiedSlot[]> {
  const out: ClassifiedSlot[] = [];
  for (const slot of slots) {
    const existing = await existingAtSlot(sb, clientId, slot);
    if (!existing) { out.push({ ...slot, action: "create" }); continue; }
    if (policy === "skip_existing" || policy === "fill_missing") {
      out.push({ ...slot, action: "skip", existing_ref: existing.ref, conflict_reason: "slot already has a record" });
      continue;
    }
    // replace_unapproved: replace only a needs_review master with no downstream.
    if (existing.review_state !== "needs_review") {
      out.push({ ...slot, action: "conflict", existing_ref: existing.ref, conflict_reason: `existing record is ${existing.review_state}` });
      continue;
    }
    if (await hasDownstream(sb, clientId, existing.ref)) {
      out.push({ ...slot, action: "conflict", existing_ref: existing.ref, conflict_reason: "existing record has downstream brief/asset/distribution/analytics/archive" });
      continue;
    }
    out.push({ ...slot, action: "replace", existing_ref: existing.ref });
  }
  return out;
}

// ── One bounded AI item ──────────────────────────────────────────────────────
const HONESTY: Array<{ label: string; re: RegExp }> = [
  { label: "guaranteed outcome", re: /guaranteed (?:leads|results|revenue|roi)/i },
  { label: "invented client outcome", re: /our clients (?:achieved|generated|saw|increased|grew)/i },
  { label: "invented trust claim", re: /trusted by (?:hundreds|thousands|leading|top)/i },
  { label: "legacy offer", re: /Proof Brand Lite|Proof Engine Buildout|Authority Brand/i },
  { label: "legacy currency", re: /\bZAR\b|\bR\d{4,}/i },
];
function honestyErrors(value: unknown): string[] {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return HONESTY.filter(({ re }) => re.test(text)).map(({ label }) => label);
}
function extractJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text.trim()); } catch { /* */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* */ } }
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch { /* */ } }
  return null;
}
function str(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export interface AuthorityFile { file_number: number; file_name: string; content_md: string | null; status?: string; review_state?: string }

export interface AuthorityCounts { approved_context: number; required_context: number; approved_execution: number; required_execution: number }
export interface ScopedAuthority { ok: boolean; error?: string; counts?: AuthorityCounts; context: AuthorityFile[]; execution: AuthorityFile[] }

/**
 * Load + gate approved authority for a month. Matches the monthly Phase 3 gate:
 * requires ALL 21 approved Phase 1 context files AND ALL 11 approved Phase 2
 * execution files for that month. Blocked responses carry the exact counts.
 * Scoped generation is never permitted when either phase is incomplete.
 */
export async function loadAuthorityForMonth(sb: SupabaseClient, clientId: string, month: string): Promise<ScopedAuthority> {
  const [ctxRes, exeRes] = await Promise.all([
    sb.from("client_context_files").select("file_number, file_name, content_md, status").eq("client_id", clientId).eq("status", "approved").order("file_number"),
    sb.from("client_execution_files").select("file_number, file_name, content_md, review_state").eq("client_id", clientId).eq("month", month).eq("review_state", "approved").order("file_number"),
  ]);
  if (ctxRes.error || exeRes.error) return { ok: false, error: ctxRes.error?.message ?? exeRes.error?.message, context: [], execution: [] };
  const context = (ctxRes.data ?? []) as AuthorityFile[];
  const execution = (exeRes.data ?? []) as AuthorityFile[];
  const counts: AuthorityCounts = { approved_context: context.length, required_context: REQUIRED_CONTEXT_FILES, approved_execution: execution.length, required_execution: EXECUTION_FILE_COUNT };
  if (context.length !== REQUIRED_CONTEXT_FILES) return { ok: false, error: `Phase 1 incomplete: ${context.length}/${REQUIRED_CONTEXT_FILES} approved Context Files.`, counts, context, execution };
  if (execution.length !== EXECUTION_FILE_COUNT) return { ok: false, error: `Phase 2 incomplete for ${month}: ${execution.length}/${EXECUTION_FILE_COUNT} approved Execution Files.`, counts, context, execution };
  return { ok: true, counts, context, execution };
}

const SYSTEM = `You generate ONE Attract Acquisition Phase 3 master row from APPROVED context and execution authority. Pre-launch unless approved context says otherwise. External client proof is absent. Never invent testimonials, case studies, client logos, results, revenue, leads, ROI, or metrics; never guarantee outcomes; never name deprecated offers or legacy South African Rand pricing. Return exactly one valid JSON object, no prose or fences. Every row is a needs_review draft.`;

function authorityText(context: AuthorityFile[], execution: AuthorityFile[], format: ScopedFormat): string {
  const ctx = context.slice(0, 21).map((f) => `\n== ${f.file_name} ==\n${buildPhase3ContextFileExcerpt(f, format, 500)}`).join("");
  const exe = execution.map((f) => `\n== PHASE2 ${f.file_name} ==\n${(f.content_md ?? "").slice(0, 500)}`).join("");
  return `${ctx}\n${exe}`;
}

async function generateRow(format: ScopedFormat, authority: string): Promise<Record<string, unknown>> {
  const schemas: Record<ScopedFormat, string> = {
    feed_post: `{"content_type":"FP","archetype":"","pillar":"","working_title":"","the_one_person":"","one_belief_to_change":"","hook":"","core_message":"","cta":"","storyboard_outline":"","caption_script":"","source_origin":"","distribution_channel":"Instagram","production_brief":"","psychological_angle":"","notes":""}`,
    carousel: `{"content_type":"CR","archetype":"","pillar":"","working_title":"","the_one_person":"","one_belief_to_change":"","hook":"","core_message":"","cta":"","storyboard_outline":"","caption_script":"","source_origin":"","distribution_channel":"Instagram","production_brief":"","psychological_angle":"","notes":""}`,
    reel_video: `{"content_type":"RL","archetype":"","pillar":"","working_title":"","the_one_person":"","one_belief_to_change":"","hook":"","core_message":"","cta":"","storyboard_outline":"","caption_script":"","source_origin":"","distribution_channel":"Instagram","production_brief":"","psychological_angle":"","notes":""}`,
    story_sequence: `{"story_type":"daily","story_theme":"","pillar":"","frame_1":"","frame_2":"","frame_3":"","frame_4_optional":null,"cta_engagement_prompt":"","proof_used":"","source_origin":"","what_not_to_claim":"","notes":""}`,
    ad_static: `{"stint_name":"","objective":"","funnel_stage":"awareness","budget_split":"","primary_goal":"","conversion_action":"","meta_objective":"","audience":"","creative_source":"","hook_angle":"","kpi_watch":"","feeds_into":"","notes":""}`,
  };
  const user = `${authority}\n\nGenerate exactly ONE ${format} row. Keep each string under 180 characters. Return one JSON object exactly matching:\n${schemas[format]}`;
  const model = Deno.env.get("AA_PHASE2_AI_MODEL") ?? "claude-sonnet-4-6";
  let res = await callAnthropic({ system: SYSTEM, user, model, maxTokens: 1400, timeoutMs: 110_000 });
  let parsed = res.ok ? extractJson(res.text) : null;
  if (!parsed) {
    res = await callAnthropic({ system: `${SYSTEM}\nFORMAT RETRY: one compact valid JSON object only.`, user, model, maxTokens: 1400, timeoutMs: 110_000 });
    parsed = res.ok ? extractJson(res.text) : null;
  }
  if (!res.ok) throw new Error(res.error ?? "AI call failed.");
  if (!parsed) throw new Error("AI returned invalid JSON after one retry.");
  const errs = honestyErrors(parsed);
  if (errs.length) throw new Error(`Honesty validation failed: ${errs.join(", ")}.`);
  return parsed;
}

export interface GenerateItemResult { ref: string; master_table: string; master_id: string; calendar_cell_id: string }

/**
 * Generate exactly ONE Phase 3 master row + one matching calendar cell for a slot.
 * Allocates the ref via the DB advisory-lock RPC (with UNIQUE-constraint retry),
 * inserts needs_review, and creates NO brief/asset. For a 'replace' slot the target
 * is re-verified transactionally (replace_phase3_master_if_safe) at execution time.
 */
export async function generateOnePhase3Item(
  sb: SupabaseClient, clientId: string, slot: ClassifiedSlot, context: AuthorityFile[], execution: AuthorityFile[],
): Promise<GenerateItemResult> {
  const month = slot.execution_month;
  const table = TYPE_TO_MASTER[slot.type_code];

  // Replace path: re-check safety NOW; downgrade to a thrown conflict if unsafe.
  if (slot.action === "replace" && slot.existing_ref) {
    const { data: safe, error } = await sb.rpc("replace_phase3_master_if_safe", { p_client_id: clientId, p_master_table: table, p_ref: slot.existing_ref });
    if (error) throw new Error(`Replace safety check failed: ${error.message}`);
    if (safe !== true) throw new Error(`CONFLICT: ${slot.existing_ref} is no longer safe to replace (approved or has downstream records).`);
  }

  const row = await generateRow(slot.asset_format, authorityText(context, execution, slot.asset_format));

  // Allocate a ref + insert the master row, retrying on the rare UNIQUE(client_id,ref) race.
  let ref = "";
  let masterId = "";
  for (let attempt = 0; attempt < 5 && !masterId; attempt += 1) {
    const { data: allocated, error: allocErr } = await sb.rpc("allocate_phase3_ref", { p_client_id: clientId, p_planned_date: slot.planned_date, p_type_code: slot.type_code });
    if (allocErr || !allocated) throw new Error(`Ref allocation failed: ${allocErr?.message ?? "no ref"}`);
    ref = allocated as string;
    const payload = buildMasterPayload(clientId, month, ref, slot, row);
    const { data: inserted, error: insErr } = await sb.from(table).insert(payload).select("id").single();
    if (insErr) {
      if (insErr.code === "23505") continue; // ref race → re-allocate
      throw new Error(`${table} insert failed: ${insErr.message}`);
    }
    masterId = inserted!.id as string;
  }
  if (!masterId) throw new Error("Could not allocate a unique ref after retries.");

  const cellPayloads = buildCalendarCells(clientId, ref, slot);
  const { data: cells, error: cellErr } = await sb.from("calendar_cells").insert(cellPayloads).select("id");
  if (cellErr) throw new Error(`calendar_cells insert failed: ${cellErr.message}`);

  await sb.from("activity_log").insert({
    client_id: clientId, event_type: "phase3_scoped_item_created",
    plain_english_message: `Scoped Phase 3 item ${ref} created for ${slot.planned_date}.`,
    metadata: { ref, asset_format: slot.asset_format, planned_date: slot.planned_date, action: slot.action },
  }).select("id").maybeSingle();

  return { ref, master_table: table, master_id: masterId, calendar_cell_id: (cells ?? [])[0]?.id as string };
}

const ORGANIC_ROW_TYPE: Record<string, string> = { RL: "reel", FP: "feed_posts", CR: "carousels" };

function buildMasterPayload(clientId: string, month: string, ref: string, slot: ClassifiedSlot, row: Record<string, unknown>): Record<string, unknown> {
  if (slot.type_code === "ST") {
    return {
      client_id: clientId, month, ref, review_state: "needs_review", status: "idea",
      story_type: str(row, "story_type") ?? "daily", story_theme: str(row, "story_theme"), pillar: str(row, "pillar"),
      frame_1: str(row, "frame_1"), frame_2: str(row, "frame_2"), frame_3: str(row, "frame_3"), frame_4_optional: str(row, "frame_4_optional"),
      cta_engagement_prompt: str(row, "cta_engagement_prompt"), proof_used: str(row, "proof_used"), source_origin: str(row, "source_origin"),
      distribution_date: slot.planned_date, what_not_to_claim: str(row, "what_not_to_claim"), notes: str(row, "notes"),
    };
  }
  if (slot.type_code === "AD") {
    const days = Math.round((Date.parse(`${slot.end_date ?? slot.planned_date}T00:00:00Z`) - Date.parse(`${slot.planned_date}T00:00:00Z`)) / 86400000) + 1;
    return {
      client_id: clientId, month, ref, review_state: "needs_review", status: "planned",
      lane: slot.lane ?? "Ad 1", stint_name: str(row, "stint_name"), objective: str(row, "objective"), funnel_stage: str(row, "funnel_stage"),
      start_date: slot.planned_date, end_date: slot.end_date ?? slot.planned_date, days,
      budget_split: str(row, "budget_split"), primary_goal: str(row, "primary_goal"), conversion_action: str(row, "conversion_action"),
      meta_objective: str(row, "meta_objective"), audience: str(row, "audience"), creative_source: str(row, "creative_source"),
      hook_angle: str(row, "hook_angle"), kpi_watch: str(row, "kpi_watch"), feeds_into: str(row, "feeds_into"), notes: str(row, "notes"),
    };
  }
  // organic (RL/CR/FP)
  return {
    client_id: clientId, month, ref, review_state: "needs_review", status: "idea",
    content_type: slot.type_code, archetype: str(row, "archetype"), pillar: str(row, "pillar"), working_title: str(row, "working_title"),
    the_one_person: str(row, "the_one_person"), one_belief_to_change: str(row, "one_belief_to_change"), hook: str(row, "hook"),
    core_message: str(row, "core_message"), cta: str(row, "cta"), storyboard_outline: str(row, "storyboard_outline"), caption_script: str(row, "caption_script"),
    source_origin: str(row, "source_origin"), distribution_date: slot.planned_date, distribution_channel: str(row, "distribution_channel") ?? "Instagram",
    production_brief: str(row, "production_brief"), psychological_angle: str(row, "psychological_angle"), format_proven: false, notes: str(row, "notes"),
  };
}

function buildCalendarCells(clientId: string, ref: string, slot: ClassifiedSlot): Array<Record<string, unknown>> {
  if (slot.type_code === "AD") {
    // One cell per active day of the clipped stint (matches the monthly engine).
    const rowType = (slot.lane ?? "ad 1").toLowerCase().replace(" ", "");
    return eachDate(slot.planned_date, slot.end_date ?? slot.planned_date).map((date) => ({
      client_id: clientId, month: monthOf(date), date, row_type: rowType, ref, review_state: "needs_review",
    }));
  }
  const rowType = slot.type_code === "ST" ? "stories" : ORGANIC_ROW_TYPE[slot.type_code];
  return [{ client_id: clientId, month: slot.execution_month, date: slot.planned_date, row_type: rowType, ref, review_state: "needs_review" }];
}
