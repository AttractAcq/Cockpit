// validate-execution-pack — Attract Acquisition Cockpit
//
// Deterministic validation of an existing Stage 2 execution pack.
// This function reads existing DB rows and validates structural integrity.
// It does NOT generate anything and does NOT write master rows.
//
// Runs twice per spec:
//   (a) before Phase 2 draft-write (to block on hard failures before AI writes)
//   (b) at approval time (to re-validate before a row goes live)
//
// Called by:
//   - generate-phase-2 (pre-write gate)
//   - Frontend "Validate" action on the Stage 2 panel (manual re-check)

import { svc, json, cors } from "../_shared/aa.ts";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const ALLOWED_ROW_TYPES = new Set(["ad1", "ad2", "ad3", "reel", "stories", "feed_posts", "carousels"]);
const ALLOWED_REVIEW_STATES = new Set(["needs_review", "approved", "rejected", "archived"]);

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
    const body = await req.json() as { client_id?: string; execution_month?: string };
    const clientId = body?.client_id;
    const executionMonth = body?.execution_month;

    if (!clientId || typeof clientId !== "string") {
      return json({ ok: false, mode: "error", message: "client_id required" }, 400);
    }
    if (!executionMonth || !MONTH_RE.test(executionMonth)) {
      return json({ ok: false, mode: "error", client_id: clientId, message: "execution_month required in YYYY-MM format" }, 400);
    }

    const sb = svc();
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Load all relevant data in parallel
    const [organicRes, storyRes, adsRes, proofRes, briefsRes, cellsRes] = await Promise.all([
      sb.from("organic_master").select("id, ref, review_state, status, working_title, content_type, distribution_date").eq("client_id", clientId).eq("month", executionMonth),
      sb.from("story_master").select("id, ref, review_state, status, story_theme").eq("client_id", clientId).eq("month", executionMonth),
      sb.from("ads_master").select("id, ref, review_state, status, stint_name, lane").eq("client_id", clientId).eq("month", executionMonth),
      sb.from("proof_master").select("id, ref, review_state, status, proof_asset_name").eq("client_id", clientId),
      sb.from("asset_brief_index").select("id, brief_id, source_ref, source_ref_type, status, production_status").eq("client_id", clientId).eq("execution_month", executionMonth),
      sb.from("calendar_cells").select("id, ref, row_type, review_state, date").eq("client_id", clientId).eq("month", executionMonth),
    ]);

    const organic = organicRes.data ?? [];
    const story   = storyRes.data ?? [];
    const ads     = adsRes.data ?? [];
    const proof   = proofRes.data ?? [];
    const briefs  = briefsRes.data ?? [];
    const cells   = cellsRes.data ?? [];

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
    const liveStatuses = new Set(["Scheduled", "Live", "Repurposed"]);
    for (const r of organic) {
      const o = r as { ref: string; review_state: string; status: string };
      if (liveStatuses.has(o.status) && o.review_state !== "approved") {
        errors.push(`organic_master row "${o.ref}" has status "${o.status}" but review_state is "${o.review_state}" — must be approved first.`);
      }
    }
    for (const r of ads) {
      const a = r as { ref: string; review_state: string; status: string };
      if (a.status === "Live" && a.review_state !== "approved") {
        errors.push(`ads_master row "${a.ref}" has status "Live" but review_state is "${a.review_state}" — must be approved first.`);
      }
    }

    const passed = errors.length === 0;
    const eventType = passed ? "execution_pack_validated" : "execution_pack_validation_failed";
    const logMsg = passed
      ? `Execution pack validation passed for ${executionMonth}. ${warnings.length} warning(s).`
      : `Execution pack validation FAILED for ${executionMonth}: ${errors.length} error(s), ${warnings.length} warning(s).`;

    await writeActivity(sb, clientId, eventType, logMsg, {
      execution_month: executionMonth,
      error_count: errors.length,
      warning_count: warnings.length,
    });

    const result: ValidationResult = {
      ok: passed,
      mode: "contract_ready",
      client_id: clientId,
      execution_month: executionMonth,
      errors,
      warnings,
      counts: {
        organic_master:   organic.length,
        story_master:     story.length,
        ads_master:       ads.length,
        proof_master:     proof.length,
        asset_brief_index: briefs.length,
        calendar_cells:   cells.length,
      },
    };
    return json(result, passed ? 200 : 422);

  } catch (e) {
    return json({ ok: false, mode: "error", message: `Unexpected server error: ${String(e)}`, error: String(e) }, 500);
  }
});
