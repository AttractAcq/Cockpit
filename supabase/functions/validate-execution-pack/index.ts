// validate-execution-pack — Attract Acquisition Cockpit
//
// Deterministic validation with two explicit scopes:
//   validation_mode=execution_files validates Phase 2 markdown documents.
//   validation_mode=masters validates Phase 3 master rows and calendar refs.

import { svc, json, cors } from "../_shared/aa.ts";
import { EXECUTION_FILE_COUNT, EXECUTION_FILE_MANIFEST } from "../_shared/execution-manifest.ts";
import { expectedCalendarCellCount, PHASE3_EXPECTED_COUNTS } from "../_shared/phase3-contract.ts";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const ALLOWED_ROW_TYPES = new Set(["ad1", "ad2", "ad3", "reel", "stories", "feed_posts", "carousels"]);
const ALLOWED_REVIEW_STATES = new Set(["needs_review", "approved", "rejected", "archived"]);
const ALLOWED_EXECUTION_STATUSES = new Set(["draft", "ready", "approved", "archived"]);
const EXPECTED_COUNTS = {
  organic_master: PHASE3_EXPECTED_COUNTS.organic,
  story_master: PHASE3_EXPECTED_COUNTS.story,
  ads_master: PHASE3_EXPECTED_COUNTS.ads,
  client_execution_files: EXECUTION_FILE_COUNT,
} as const;

const FORBIDDEN_OUTPUT: Array<{ label: string; pattern: RegExp }> = [
  { label: "deprecated legacy offer", pattern: /Proof Brand Lite|Proof Engine Buildout|Authority Brand/i },
  { label: "legacy currency or pricing", pattern: /\bZAR\b|\bR\d{4,}|\bR\d{1,3}(?:,\d{3})+/i },
  { label: "guaranteed outcome claim", pattern: /guaranteed (?:leads|results|revenue|roi)/i },
  { label: "invented client outcome framing", pattern: /our clients (?:achieved|generated|saw|increased|grew)/i },
  { label: "invented trust claim", pattern: /trusted by (?:hundreds|thousands|leading|top)/i },
  { label: "invented ROI claim", pattern: /\b(?:roi of|\d+(?:\.\d+)?x roi|\d+(?:\.\d+)?% roi)\b/i },
  { label: "invented testimonial framing", pattern: /\b(?:client )?testimonial:\s*(?!not provided|none|absent|unavailable)/i },
  { label: "invented case-study framing", pattern: /\bcase stud(?:y|ies):\s*(?!not provided|none|absent|unavailable)/i },
];

// ref → master table routing for calendar cell validation
const ROW_TYPE_TABLE: Record<string, string> = {
  reel:        "organic_master",
  feed_posts:  "organic_master",
  carousels:   "organic_master",
  stories:     "story_master",
  ad1:         "ads_master",
  ad2:         "ads_master",
  ad3:         "ads_master",
};

// source_ref_type → master table routing for asset_brief_index validation
const SOURCE_REF_TYPE_TABLE: Record<string, string> = {
  organic:      "organic_master",
  story:        "story_master",
  ad:           "ads_master",
  // lead_magnet, website, sales, design: not validated against simple master tables yet
};

interface ValidationResult {
  ok: boolean;
  mode: "contract_ready";
  client_id: string;
  execution_month: string;
  validation_mode: "execution_files" | "masters";
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
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
  if (error) console.error("[validate-execution-pack] activity_log:", error.message);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, mode: "error", message: "POST only" }, 405);

  try {
    const body = await req.json() as { client_id?: string; execution_month?: string; validation_mode?: "execution_files" | "masters" };
    const clientId = body?.client_id;
    const executionMonth = body?.execution_month;
    const validationMode = body.validation_mode ?? "masters";

    if (!clientId || typeof clientId !== "string") {
      return json({ ok: false, mode: "error", message: "client_id required" }, 400);
    }
    if (!executionMonth || !MONTH_RE.test(executionMonth)) {
      return json({ ok: false, mode: "error", client_id: clientId, message: "execution_month required in YYYY-MM format" }, 400);
    }
    if (!new Set(["execution_files", "masters"]).has(validationMode)) {
      return json({ ok: false, mode: "error", client_id: clientId, message: "validation_mode must be execution_files or masters" }, 400);
    }

    const sb = svc();
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Load all relevant data in parallel
    const [organicRes, storyRes, adsRes, proofRes, briefsRes, cellsRes, executionFilesRes] = await Promise.all([
      sb.from("organic_master").select("id, ref, review_state, status, working_title, content_type, distribution_date, hook, core_message, caption_script, notes").eq("client_id", clientId).eq("month", executionMonth),
      sb.from("story_master").select("id, ref, review_state, status, story_theme, frame_1, frame_2, frame_3, frame_4_optional, proof_used, what_not_to_claim, distribution_date, notes").eq("client_id", clientId).eq("month", executionMonth),
      sb.from("ads_master").select("id, ref, review_state, status, stint_name, lane, objective, audience, hook_angle, creative_source, start_date, end_date, days, notes").eq("client_id", clientId).eq("month", executionMonth),
      sb.from("proof_master").select("id, ref, review_state, status, proof_asset_name").eq("client_id", clientId),
      sb.from("asset_brief_index").select("id, brief_id, source_ref, source_ref_type, status, production_status").eq("client_id", clientId).eq("execution_month", executionMonth),
      sb.from("calendar_cells").select("id, ref, row_type, review_state, date").eq("client_id", clientId).eq("month", executionMonth),
      sb.from("client_execution_files").select("id, file_number, file_name, review_state, status, content_md").eq("client_id", clientId).eq("month", executionMonth),
    ]);

    const queryError = [organicRes, storyRes, adsRes, proofRes, briefsRes, cellsRes, executionFilesRes]
      .find((result) => result.error)?.error;
    if (queryError) {
      return json({ ok: false, mode: "error", client_id: clientId, execution_month: executionMonth, message: `Could not load execution pack: ${queryError.message}` }, 500);
    }

    const organic = organicRes.data ?? [];
    const story   = storyRes.data ?? [];
    const ads     = adsRes.data ?? [];
    const proof   = proofRes.data ?? [];
    const briefs  = briefsRes.data ?? [];
    const cells   = cellsRes.data ?? [];
    const executionFiles = executionFilesRes.data ?? [];

    const actualCounts = {
      organic_master: organic.length,
      story_master: story.length,
      ads_master: ads.length,
      calendar_cells: cells.length,
      client_execution_files: executionFiles.length,
    };
    const expectedCounts = validationMode === "execution_files"
      ? { client_execution_files: EXPECTED_COUNTS.client_execution_files }
      : {
        organic_master: EXPECTED_COUNTS.organic_master,
        story_master: EXPECTED_COUNTS.story_master,
        ads_master: EXPECTED_COUNTS.ads_master,
      };
    for (const [table, expected] of Object.entries(expectedCounts)) {
      const actual = actualCounts[table as keyof typeof actualCounts];
      if (actual !== expected) errors.push(`${table} expected ${expected} row(s), found ${actual}.`);
    }
    if (validationMode === "masters") {
      const expectedCells = expectedCalendarCellCount(executionMonth);
      if (cells.length !== expectedCells) errors.push(`calendar_cells expected ${expectedCells} row(s), found ${cells.length}.`);
    }

    if (validationMode === "execution_files") {
      const names = new Set(executionFiles.map((file: { file_name: string }) => file.file_name));
      const numbers = new Set(executionFiles.map((file: { file_number: number }) => file.file_number));
      if (names.size !== executionFiles.length) errors.push("client_execution_files contains duplicate filenames.");
      if (numbers.size !== executionFiles.length) errors.push("client_execution_files contains duplicate file_numbers.");
      for (const definition of EXECUTION_FILE_MANIFEST) {
        if (!names.has(definition.fileName)) errors.push(`client_execution_files is missing ${definition.fileName}.`);
        if (!numbers.has(definition.fileNumber)) errors.push(`client_execution_files is missing file_number ${definition.fileNumber} (${definition.code}).`);
        const exact = executionFiles.find((file: { file_number: number; file_name: string }) => file.file_number === definition.fileNumber && file.file_name === definition.fileName);
        if (!exact) errors.push(`${definition.code} must map file_number ${definition.fileNumber} to ${definition.fileName}.`);
      }
      for (const file of executionFiles as Array<{ file_number: number; file_name: string; review_state: string; status: string; content_md: string | null }>) {
        if (!ALLOWED_REVIEW_STATES.has(file.review_state)) errors.push(`${file.file_name} has invalid review_state "${file.review_state}".`);
        if (!ALLOWED_EXECUTION_STATUSES.has(file.status)) errors.push(`${file.file_name} has invalid status "${file.status}".`);
        if (!file.content_md || file.content_md.trim().length < 500) errors.push(`${file.file_name} content is missing or too short.`);
      }
      const rawText = JSON.stringify(executionFiles);
      const prohibition = /\b(?:do not|never|must not|cannot|avoid|forbidden|not claim|not use|not invent|not guaranteed|no guarantees?|without guarantees?|no testimonials?|no case stud(?:y|ies)|no fabricated|no guaranteed)\b/i;
      const scannable = rawText.split(/(?<=[.!?\n])/).map((sentence) => {
        const namesForbidden = FORBIDDEN_OUTPUT.some(({ pattern }) => pattern.test(sentence));
        return namesForbidden && prohibition.test(sentence) ? "[explicit proof-honesty constraint]" : sentence;
      }).join("");
      for (const { label, pattern } of FORBIDDEN_OUTPUT) if (pattern.test(scannable)) errors.push(`Forbidden execution-file content detected: ${label}.`);

      const passed = errors.length === 0;
      await writeActivity(sb, clientId, passed ? "execution_files_validated" : "execution_files_validation_failed", passed
        ? `Phase 2 execution-file validation passed for ${executionMonth}.`
        : `Phase 2 execution-file validation failed for ${executionMonth}: ${errors.length} error(s).`, {
        execution_month: executionMonth,
        validation_mode: validationMode,
        error_count: errors.length,
      });
      return json({
        ok: passed,
        mode: "contract_ready",
        validation_mode: validationMode,
        client_id: clientId,
        execution_month: executionMonth,
        errors,
        warnings,
        counts: { client_execution_files: executionFiles.length },
      }, passed ? 200 : 422);
    }

    // Build ref sets for cross-table lookup
    const organicRefs = new Set(organic.map((r: { ref: string }) => r.ref));
    const storyRefs   = new Set(story.map((r: { ref: string }) => r.ref));
    const adsRefs     = new Set(ads.map((r: { ref: string }) => r.ref));

    const refSets: Record<string, Set<string>> = {
      organic_master: organicRefs,
      story_master:   storyRefs,
      ads_master:     adsRefs,
    };

    // 2. Ref uniqueness per table
    const checkUnique = (rows: Array<{ ref: string }>, tableName: string) => {
      const seen = new Map<string, number>();
      for (const r of rows) {
        seen.set(r.ref, (seen.get(r.ref) ?? 0) + 1);
      }
      for (const [ref, count] of seen) {
        if (count > 1) errors.push(`Duplicate ref "${ref}" found ${count} times in ${tableName}.`);
      }
    };
    checkUnique(organic, "organic_master");
    checkUnique(story, "story_master");
    checkUnique(ads, "ads_master");

    // Generated Phase 3 rows are review drafts. Approval remains a human action.
    for (const [table, tableRows] of [["organic_master", organic], ["story_master", story], ["ads_master", ads], ["calendar_cells", cells]] as const) {
      for (const row of tableRows as Array<{ ref: string; review_state: string }>) {
        if (row.review_state !== "needs_review") errors.push(`${table} row "${row.ref}" must start as needs_review, found "${row.review_state}".`);
      }
    }

    const calendarKeys = new Set<string>();
    for (const cell of cells as Array<{ date: string; row_type: string; ref: string }>) {
      const key = `${cell.date}|${cell.row_type}|${cell.ref}`;
      if (calendarKeys.has(key)) errors.push(`Duplicate calendar cell ${key}.`);
      calendarKeys.add(key);
    }
    const validMonthDate = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value.startsWith(`${executionMonth}-`) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()));
    const organicTypes: Record<string, string> = { RL: "reel", CR: "carousels", FP: "feed_posts" };
    for (const row of organic as Array<{ ref: string; content_type: string; distribution_date: string | null }>) {
      if (!validMonthDate(row.distribution_date)) errors.push(`organic_master row "${row.ref}" has invalid distribution_date "${row.distribution_date}".`);
      const rowType = organicTypes[row.content_type];
      if (!rowType) errors.push(`organic_master row "${row.ref}" has invalid content_type "${row.content_type}".`);
      else if (row.distribution_date && !calendarKeys.has(`${row.distribution_date}|${rowType}|${row.ref}`)) errors.push(`Calendar is missing organic ref ${row.ref} on ${row.distribution_date}.`);
    }
    for (const row of story as Array<{ ref: string; distribution_date: string | null }>) {
      if (!validMonthDate(row.distribution_date)) errors.push(`story_master row "${row.ref}" has invalid distribution_date "${row.distribution_date}".`);
      else if (!calendarKeys.has(`${row.distribution_date}|stories|${row.ref}`)) errors.push(`Calendar is missing story ref ${row.ref} on ${row.distribution_date}.`);
    }
    for (const row of ads as Array<{ ref: string; lane: string; start_date: string | null; end_date: string | null; days: number | null }>) {
      if (!new Set(["Ad 1", "Ad 2", "Ad 3"]).has(row.lane)) errors.push(`ads_master row "${row.ref}" has invalid lane "${row.lane}".`);
      if (!validMonthDate(row.start_date) || !validMonthDate(row.end_date)) { errors.push(`ads_master row "${row.ref}" has invalid range ${row.start_date} to ${row.end_date}.`); continue; }
      const first = new Date(`${row.start_date}T00:00:00Z`); const last = new Date(`${row.end_date}T00:00:00Z`);
      if (first > last) { errors.push(`ads_master row "${row.ref}" starts after it ends.`); continue; }
      const expectedDays = Math.floor((last.getTime() - first.getTime()) / 86_400_000) + 1;
      if (row.days !== expectedDays) errors.push(`ads_master row "${row.ref}" days=${row.days}, expected ${expectedDays}.`);
      const rowType = row.lane.toLowerCase().replace(" ", "");
      for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const date = cursor.toISOString().slice(0, 10);
        if (!calendarKeys.has(`${date}|${rowType}|${row.ref}`)) errors.push(`Calendar is missing active ad ref ${row.ref} on ${date}.`);
      }
    }

    // 3. review_state values are canonical
    const checkReviewStates = (rows: Array<{ ref?: string; brief_id?: string; review_state?: string; status?: string }>, tableName: string, column: string) => {
      for (const r of rows) {
        const val = column === "status" ? r.status : r.review_state;
        const id = r.ref ?? r.brief_id ?? "unknown";
        if (val && !ALLOWED_REVIEW_STATES.has(val)) {
          errors.push(`${tableName} row "${id}" has invalid review_state "${val}".`);
        }
      }
    };
    checkReviewStates(organic, "organic_master", "review_state");
    checkReviewStates(story,   "story_master",   "review_state");
    checkReviewStates(ads,     "ads_master",      "review_state");
    checkReviewStates(executionFiles, "client_execution_files", "review_state");
    // asset_brief_index stores review_state in `status` column
    checkReviewStates(briefs,  "asset_brief_index", "status");

    // 4. Calendar cell row_type is within the 7 allowed values
    for (const cell of cells) {
      const c = cell as { row_type: string; ref: string; date: string; review_state: string };
      if (!ALLOWED_ROW_TYPES.has(c.row_type)) {
        errors.push(`calendar_cells row on ${c.date} has invalid row_type "${c.row_type}".`);
      }

      // 5. Calendar cell ref resolves to a known master ref
      const targetTable = ROW_TYPE_TABLE[c.row_type];
      if (targetTable && !refSets[targetTable]?.has(c.ref)) {
        errors.push(`calendar_cells row on ${c.date} (${c.row_type}) references unknown ref "${c.ref}" — no matching row in ${targetTable}.`);
      }

      // review_state on calendar cells
      if (c.review_state && !ALLOWED_REVIEW_STATES.has(c.review_state)) {
        errors.push(`calendar_cells row on ${c.date} has invalid review_state "${c.review_state}".`);
      }
    }

    // 6. asset_brief_index.source_ref resolves to a known master ref
    for (const brief of briefs) {
      const b = brief as { brief_id: string; source_ref: string; source_ref_type: string };
      const targetTable = SOURCE_REF_TYPE_TABLE[b.source_ref_type];
      if (targetTable && !refSets[targetTable]?.has(b.source_ref)) {
        warnings.push(`asset_brief_index brief "${b.brief_id}" source_ref "${b.source_ref}" (type: ${b.source_ref_type}) does not resolve to a known master ref in ${targetTable}.`);
      }
    }

    // 7. Approved rows with obviously missing required fields
    for (const r of organic) {
      const o = r as { ref: string; review_state: string; content_type: string; working_title: string | null };
      if (o.review_state === "approved" && !o.content_type) {
        warnings.push(`Approved organic_master row "${o.ref}" is missing content_type.`);
      }
    }
    for (const r of ads) {
      const a = r as { ref: string; review_state: string; stint_name: string | null; lane: string | null };
      if (a.review_state === "approved" && !a.stint_name) {
        warnings.push(`Approved ads_master row "${a.ref}" is missing stint_name.`);
      }
      if (a.review_state === "approved" && !a.lane) {
        warnings.push(`Approved ads_master row "${a.ref}" is missing lane.`);
      }
    }

    // 8. No rows with domain status implying live/scheduled unless review_state = approved
    const liveStatuses = new Set(["scheduled", "live", "repurposed"]);
    for (const r of organic) {
      const o = r as { ref: string; review_state: string; status: string };
      if (liveStatuses.has(o.status) && o.review_state !== "approved") {
        errors.push(`organic_master row "${o.ref}" has status "${o.status}" but review_state is "${o.review_state}" — must be approved first.`);
      }
    }
    for (const r of ads) {
      const a = r as { ref: string; review_state: string; status: string };
      if (a.status === "live" && a.review_state !== "approved") {
        errors.push(`ads_master row "${a.ref}" has status "live" but review_state is "${a.review_state}" — must be approved first.`);
      }
    }

    // 9. Proof honesty and current-offer integrity across all generated text.
    const rawGeneratedText = JSON.stringify({ organic, story, ads });
    const prohibition = /\b(?:do not|never|must not|cannot|avoid|forbidden|not claim|not use|not invent|not guaranteed|no guarantees?|without guarantees?|no testimonials?|no case stud(?:y|ies)|no fabricated|no guaranteed)\b/i;
    const generatedText = rawGeneratedText.split(/(?<=[.!?\n])/).map((sentence) => {
      const namesForbiddenClaim = FORBIDDEN_OUTPUT.some(({ pattern }) => pattern.test(sentence));
      return namesForbiddenClaim && prohibition.test(sentence) ? "[explicit proof-honesty constraint]" : sentence;
    }).join("");
    for (const { label, pattern } of FORBIDDEN_OUTPUT) {
      if (pattern.test(generatedText)) errors.push(`Forbidden generated content detected: ${label}.`);
    }

    const passed = errors.length === 0;
    const eventType = passed ? "execution_pack_validated" : "execution_pack_validation_failed";
    const logMsg = passed
      ? `Execution pack validation passed for ${executionMonth}. ${warnings.length} warning(s).`
      : `Execution pack validation FAILED for ${executionMonth}: ${errors.length} error(s), ${warnings.length} warning(s).`;

    await writeActivity(sb, clientId, eventType, logMsg, {
      execution_month: executionMonth,
      validation_mode: validationMode,
      error_count: errors.length,
      warning_count: warnings.length,
    });

    const result: ValidationResult = {
      ok: passed,
      mode: "contract_ready",
      client_id: clientId,
      execution_month: executionMonth,
      validation_mode: validationMode,
      errors,
      warnings,
      counts: {
        organic_master:   organic.length,
        story_master:     story.length,
        ads_master:       ads.length,
        proof_master:     proof.length,
        asset_brief_index: briefs.length,
        calendar_cells:   cells.length,
        client_execution_files: executionFiles.length,
      },
    };
    return json(result, passed ? 200 : 422);

  } catch (e) {
    return json({ ok: false, mode: "error", message: `Unexpected server error: ${String(e)}`, error: String(e) }, 500);
  }
});
