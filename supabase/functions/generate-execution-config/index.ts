// Programme Stage D runtime: structured Phase 2 authority.
//
// Turns the approved Execution Markdown into the machine-executable twin.
//
// There is deliberately NO model call in this function. Every number it writes
// is read from the machine-readable "## Ideation Quantity Contract" block using
// the same strict parser Ideation already uses, and every value it reconciles
// against is parsed from the human-authored Rule 2/3/4 tables. Nothing is
// inferred, so nothing can be fabricated. Where the approved files declare
// nothing for a dimension, that dimension is left absent and recorded as an
// informational check rather than filled in.
//
// This function only ever writes a config in a non-approved state.
// client_execution_configs_approval_check makes `approved` unreachable without
// a passed reconciliation and a human approver, and approval is a separate
// function.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { resolveIdeationPeriod, deriveIdeationQuantityPlan } from "../_shared/ideation/period.ts";
import type { IdeationAssetType } from "../_shared/ideation/period.ts";
import type { ApprovedExecutionFile } from "../_shared/client-authority.ts";
import { extractDeclaredAuthority, objectiveMixFromThemes } from "../_shared/execution/markdown-authority.ts";
import {
  validateExecutionConfig,
  reconcileWithExecutionFiles,
  reconciliationOutcome,
  monthBounds,
  type ExecutionConfig,
  type ExecutionConfigCheck,
  type ExecutionRequirementSpec,
} from "../../../src/types/execution-config.ts";

const GENERATOR = "generate-execution-config";
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CALENDAR_FILE_NUMBER = 5;
const ASSET_TYPES: IdeationAssetType[] = ["reel", "carousel", "static", "story"];

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable stringify so an identical config always hashes identically. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function check(
  code: string,
  status: "pass" | "fail",
  detail: string,
  severity: ExecutionConfigCheck["severity"] = "blocking",
  expected: string | null = null,
  actual: string | null = null,
): ExecutionConfigCheck {
  return { check_code: code, severity, status, expected_value: expected, actual_value: actual, detail };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; execution_month?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const month = (body.execution_month ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!MONTH_RE.test(month)) {
    return json({ code: "INVALID_EXECUTION_MONTH", message: "execution_month must be YYYY-MM." }, 400);
  }

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: client, error: clientErr } = await sb
    .from("clients").select("id, name, primary_platform").eq("id", clientId).maybeSingle();
  if (clientErr) return json({ code: "LOOKUP_FAILED", message: clientErr.message }, 500);
  if (!client) return json({ code: "CLIENT_NOT_FOUND" }, 404);

  // Approved Execution Markdown only. review_state is the approval field for
  // execution files; `status` is not the approval gate.
  const { data: fileRows, error: filesErr } = await sb
    .from("client_execution_files")
    .select("id, month, file_number, file_name, content_md, review_state, version")
    .eq("client_id", clientId)
    .eq("month", month)
    .eq("review_state", "approved");
  if (filesErr) return json({ code: "LOOKUP_FAILED", message: filesErr.message }, 500);

  const files = (fileRows ?? []) as ApprovedExecutionFile[];
  if (files.length === 0) {
    return json({
      code: "NO_APPROVED_EXECUTION_AUTHORITY",
      message: `No approved execution files exist for ${month}. Structured authority is never derived from unapproved Markdown.`,
    }, 409);
  }

  // Exact monthly quantities, from the machine-readable contract, via the
  // parser Ideation already uses. Its own preconditions (exactly one approved
  // E02/E04/E05, exactly one quantity section, strict schema version) throw and
  // are surfaced as a fail-closed 422 rather than being worked around.
  let plan;
  try {
    const period = resolveIdeationPeriod({ period_type: "one_month", month });
    plan = deriveIdeationQuantityPlan(period, new Map([[month, files]]));
  } catch (e) {
    return json({
      code: "QUANTITY_AUTHORITY_INVALID",
      message: e instanceof Error ? e.message : String(e),
    }, 422);
  }

  const calendarFile = files.find((f) => f.file_number === CALENDAR_FILE_NUMBER);
  if (!calendarFile) {
    return json({ code: "CALENDAR_AUTHORITY_MISSING", message: `Approved E05 is required for ${month}.` }, 422);
  }
  const declared = extractDeclaredAuthority(calendarFile.content_md);
  const legacyQuantityAuthority = plan.monthly_plans[0]?.authority_mode === "legacy_rule_2";

  // The approved Execution file is the authority for the month, so its declared
  // platform wins. clients.primary_platform is only a fallback for a client
  // whose approved file names none. Platform is optional at planning time: an
  // undeclared value is represented honestly rather than blocking generation
  // or being inferred from the formats that happen to be present.
  const declaredPlatform = declared.primary_platform
    ?? (client.primary_platform as string | null)?.trim()?.toLowerCase()
    ?? null;
  const platform = declaredPlatform ?? "unassigned";

  const themes = declared.weekly_themes;
  const hasDeclaredThemes = Boolean(themes && themes.length > 0);

  const requirements: ExecutionRequirementSpec[] = ASSET_TYPES
    .map((assetType) => {
      const quantity = plan.by_asset_type[assetType] ?? 0;
      return {
        platform,
        asset_format: assetType,
        channel: "organic",
        quantity,
        cadence: "weekly" as const,
        objective_mix: hasDeclaredThemes
          ? objectiveMixFromThemes(quantity, themes!)
          : { unassigned: quantity },
        ...(declared.content_pillars ? { content_pillar_rotation: declared.content_pillars } : {}),
      };
    })
    .filter((r) => r.quantity > 0);

  const config: ExecutionConfig = {
    execution_month: month,
    requirements,
    ...(declared.content_pillars ? { content_pillars: declared.content_pillars } : {}),
  };

  // --- checks -------------------------------------------------------------
  const checks: ExecutionConfigCheck[] = [...validateExecutionConfig(config)];

  checks.push(check(
    "platform_authority",
    "pass",
    declaredPlatform
      ? `Primary platform is declared as ${declaredPlatform}.`
      : "No primary platform is declared. Requirements remain platform-neutral as unassigned until a platform is selected.",
    declaredPlatform ? "blocking" : "warning",
    declaredPlatform,
    platform,
  ));

  checks.push(check(
    "objective_authority",
    "pass",
    hasDeclaredThemes
      ? "Objectives are derived from the weekly themes declared in the approved calendar."
      : "No weekly themes are declared. Objective allocation remains unassigned and does not block the pre-intelligence execution contract.",
    hasDeclaredThemes ? "blocking" : "warning",
    hasDeclaredThemes ? "declared weekly themes" : null,
    hasDeclaredThemes ? themes!.join(", ") : "unassigned",
  ));

  // Reconciliation against the independent human-authored Rule 2 table. If an
  // operator edits one representation and not the other, this blocks approval.
  if (legacyQuantityAuthority) {
    checks.push(check("weekly_target_reconcile", "pass",
      "Legacy compatibility: quantities were derived directly from the single approved E05 Rule 2 table because this approved file predates the machine-readable quantity block. Human review remains required.",
      "warning"));
  } else if (declared.slot_targets) {
    const declaredWeekly = new Map(declared.slot_targets.map((t) => [t.asset_type, t.weekly_target]));
    for (const assetType of ASSET_TYPES) {
      const contractWeekly = plan.monthly_plans[0]?.weekly_quotas[assetType];
      const tableWeekly = declaredWeekly.get(assetType);
      if (tableWeekly === undefined) continue;
      checks.push(
        contractWeekly === tableWeekly
          ? check(`weekly_target_reconcile:${assetType}`, "pass",
              `Rule 2 weekly target for ${assetType} matches the quantity contract`,
              "blocking", String(tableWeekly), String(contractWeekly))
          : check(`weekly_target_reconcile:${assetType}`, "fail",
              `Rule 2 declares ${tableWeekly} ${assetType}/week but the Ideation Quantity Contract declares ${contractWeekly}. The approved file contradicts itself.`,
              "blocking", String(tableWeekly), String(contractWeekly)),
      );
    }
  } else {
    checks.push(check("weekly_target_reconcile", "pass",
      "The approved calendar declares no Rule 2 slot-target table, so no independent weekly figure exists to reconcile against.",
      "warning"));
  }

  if (declared.declared_organic_weekly_total !== null) {
    const contractTotal = ASSET_TYPES.reduce(
      (sum, a) => sum + (plan.monthly_plans[0]?.weekly_quotas[a] ?? 0), 0);
    const declaredTotal = declared.declared_organic_weekly_total;
    checks.push(
      contractTotal === declaredTotal
        ? check("organic_weekly_total_reconcile", "pass",
            "Rule 2 organic weekly total matches the sum of the per-format contract figures",
            "blocking", String(declaredTotal), String(contractTotal))
        : check("organic_weekly_total_reconcile", "fail",
            `Rule 2 declares an organic total of ${declaredTotal}/week but the per-format figures sum to ${contractTotal}.`,
            "blocking", String(declaredTotal), String(contractTotal)),
    );
  }

  checks.push(...reconcileWithExecutionFiles(config, {
    formats: declared.slot_targets?.map((t) => t.asset_type),
  }));

  if (!declared.content_pillars) {
    checks.push(check("pillars_declared", "pass",
      "The approved calendar declares no pillar table, so slots carry no content pillar. This dimension is unplanned, not defaulted.",
      "warning"));
  }

  const outcome = reconciliationOutcome(checks);
  const now = new Date().toISOString();

  const contentHash = await sha256Hex(canonical(config));
  const sourceHash = await sha256Hex(
    files
      .map((f) => `${f.id}:${f.version}`)
      .sort()
      .join("|") + "|" + (await sha256Hex(files.map((f) => f.content_md).join(" "))),
  );

  // Idempotent: regenerating from unchanged authority returns the existing row
  // rather than stacking versions.
  const { data: existing, error: existingErr } = await sb
    .from("client_execution_configs")
    .select("id, config_version, status, reconciliation_status")
    .eq("client_id", clientId).eq("execution_month", month)
    .eq("content_hash", contentHash).eq("source_execution_files_hash", sourceHash)
    .maybeSingle();
  if (existingErr) return json({ code: "LOOKUP_FAILED", message: existingErr.message }, 500);
  if (existing) {
    return json({
      unchanged: true,
      execution_config_id: existing.id,
      config_version: existing.config_version,
      status: existing.status,
      reconciliation_status: existing.reconciliation_status,
      message: "Authority is unchanged since this config was generated.",
    }, 200);
  }

  const { data: maxRow } = await sb
    .from("client_execution_configs")
    .select("config_version")
    .eq("client_id", clientId).eq("execution_month", month)
    .order("config_version", { ascending: false }).limit(1).maybeSingle();
  const nextVersion = ((maxRow?.config_version as number | undefined) ?? 0) + 1;

  const { data: inserted, error: insertErr } = await sb
    .from("client_execution_configs")
    .insert({
      client_id: clientId,
      execution_month: month,
      config_version: nextVersion,
      status: outcome === "passed" ? "needs_review" : "draft",
      config,
      content_hash: contentHash,
      source_execution_file_ids: files.map((f) => f.id).sort(),
      source_execution_files_hash: sourceHash,
      reconciliation_status: outcome,
      reconciliation_ran_at: now,
      generated_by_function: GENERATOR,
      created_by: access.userId,
    })
    .select("id, config_version, status")
    .single();
  if (insertErr) return json({ code: "INSERT_FAILED", message: insertErr.message }, 500);

  const configId = inserted.id as string;
  const { error: checksErr } = await sb.from("client_execution_config_checks").insert(
    checks.map((c) => ({
      client_id: clientId,
      execution_config_id: configId,
      check_code: c.check_code,
      severity: c.severity,
      status: c.status,
      expected_value: c.expected_value,
      actual_value: c.actual_value,
      detail: c.detail,
      source_execution_file_id: calendarFile.id,
    })),
  );
  if (checksErr) {
    // The config is meaningless without its evidence — do not leave it behind.
    await sb.from("client_execution_configs").delete().eq("id", configId);
    return json({ code: "CHECKS_INSERT_FAILED", message: checksErr.message }, 500);
  }

  await audit(sb, "execution_config.generated", "client_execution_configs", configId, {
    client_id: clientId, execution_month: month, reconciliation_status: outcome,
  });

  const { period_start, period_end } = monthBounds(month);
  return json({
    unchanged: false,
    execution_config_id: configId,
    config_version: inserted.config_version,
    status: inserted.status,
    reconciliation_status: outcome,
    period: { period_start, period_end },
    requirement_count: requirements.length,
    total_quantity: requirements.reduce((s, r) => s + r.quantity, 0),
    checks: checks.map((c) => ({ check_code: c.check_code, status: c.status, severity: c.severity })),
  }, 201);
});
