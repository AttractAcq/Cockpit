// Programme Stage K — set (upsert) a client's organic distribution approval
// policy: internal-only vs client-approval-required, auto-schedule,
// manual-publish-only, blackout periods, restricted weekdays.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { validateBlackoutPeriods, validateRestrictedWeekdays, type ApprovalMode } from "../_shared/distribution-policy.ts";

const APPROVAL_MODES: readonly ApprovalMode[] = ["internal_only", "client_approval_required"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: {
    client_id?: string;
    approval_mode?: string;
    auto_schedule_after_approval?: boolean;
    manual_publish_only?: boolean;
    blackout_periods?: unknown;
    restricted_weekdays?: unknown;
  };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);

  const approvalMode = (body.approval_mode ?? "internal_only") as ApprovalMode;
  if (!APPROVAL_MODES.includes(approvalMode)) {
    return json({ code: "INVALID_APPROVAL_MODE", message: `approval_mode must be one of: ${APPROVAL_MODES.join(", ")}` }, 400);
  }

  const blackoutPeriods = validateBlackoutPeriods(body.blackout_periods ?? []);
  if (blackoutPeriods === null) return json({ code: "INVALID_BLACKOUT_PERIODS" }, 400);

  const restrictedWeekdays = validateRestrictedWeekdays(body.restricted_weekdays ?? []);
  if (restrictedWeekdays === null) return json({ code: "INVALID_RESTRICTED_WEEKDAYS" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const { data: policy, error } = await sb
    .from("client_distribution_policies")
    .upsert({
      client_id: clientId,
      approval_mode: approvalMode,
      auto_schedule_after_approval: body.auto_schedule_after_approval === true,
      manual_publish_only: body.manual_publish_only === true,
      blackout_periods: blackoutPeriods,
      restricted_weekdays: restrictedWeekdays,
      updated_by: access.userId,
    }, { onConflict: "client_id" })
    .select("*")
    .single();
  if (error) return json({ code: "UPSERT_FAILED", message: error.message }, 500);

  await audit(sb, "distribution_policy.set", "client_distribution_policies", policy.id, {
    client_id: clientId, approval_mode: approvalMode,
  });

  return json({ ok: true, policy }, 200);
});
