// Phase G2 — securely email one approved production brief to a human contractor.
import { svc, json, cors } from "../_shared/aa.ts";

const FUNCTION_NAME = "send-production-brief-to-contractor";
const STAFF_ROLES = new Set(["admin", "account_manager", "editor"]);
const RESEND_URL = "https://api.resend.com/emails";

function failure(status: number, stage: string, error: string, details?: unknown): Response {
  return json({ ok: false, function: FUNCTION_NAME, stage, error, details, message: `${FUNCTION_NAME} failed at ${stage}: ${error}` }, status);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function dueDate(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const calendar = (metadata as { calendar?: unknown }).calendar;
  if (!Array.isArray(calendar)) return null;
  const dates = calendar.map((entry) => entry && typeof entry === "object" ? (entry as { date?: unknown }).date : null)
    .filter((value): value is string => typeof value === "string").sort();
  return dates[0] ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return failure(405, "request", "POST only");
  const sb = svc();
  let assignmentId: string | null = null;
  let briefId: string | null = null;
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await sb.auth.getUser(jwt);
    if (userError || !user) return failure(401, "authorization", "Not authenticated.");
    const { data: operator, error: operatorError } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
    if (operatorError) return failure(500, "authorization", "Could not load operator role.", operatorError.message);
    if (!operator || !STAFF_ROLES.has(operator.role)) return failure(403, "authorization", "Admin, account manager, or editor access is required.");

    const body = await req.json() as { production_brief_id?: string; contractor_id?: string; message?: string | null };
    briefId = body.production_brief_id?.trim() ?? "";
    const contractorId = body.contractor_id?.trim() ?? "";
    const message = body.message?.trim().slice(0, 4000) || null;
    if (!briefId || !contractorId) return failure(400, "request", "production_brief_id and contractor_id are required.");

    const [briefResult, contractorResult] = await Promise.all([
      sb.from("client_production_briefs").select("*, clients(name)").eq("id", briefId).maybeSingle(),
      sb.from("contractors").select("*").eq("id", contractorId).eq("active", true).maybeSingle(),
    ]);
    if (briefResult.error || !briefResult.data) return failure(404, "load_brief", "Production brief not found.", briefResult.error?.message);
    if (contractorResult.error || !contractorResult.data) return failure(404, "load_contractor", "Active contractor not found.", contractorResult.error?.message);
    const brief = briefResult.data;
    const contractor = contractorResult.data;
    if (brief.status !== "approved") return failure(409, "gate", "Production brief must be approved before it can be sent to a contractor.");
    if (brief.asset_format === "reel_video" && brief.production_mode === "ai") return failure(409, "gate", "Video content is human-only.");

    const { data: assignment, error: assignmentError } = await sb.from("contractor_assignments").insert({
      client_id: brief.client_id,
      production_brief_id: brief.id,
      contractor_id: contractor.id,
      status: "assigned",
      message,
    }).select("*").single();
    if (assignmentError || !assignment) return failure(500, "create_assignment", "Could not record contractor assignment.", assignmentError?.message);
    assignmentId = assignment.id;

    const apiKey = (Deno.env.get("RESEND_API_KEY") ?? "").trim();
    const from = (Deno.env.get("RESEND_FROM_EMAIL") ?? "").trim();
    const replyTo = (Deno.env.get("PRODUCTION_REPLY_TO") ?? "").trim();
    if (!apiKey || !from) {
      await sb.from("contractor_assignments").update({ status: "failed", error_message: "Resend configuration is unavailable.", updated_at: new Date().toISOString() }).eq("id", assignment.id);
      return failure(500, "email_configuration", "Resend is not configured. RESEND_API_KEY and RESEND_FROM_EMAIL are required.");
    }

    const clientName = brief.clients?.name ?? "Client";
    const deadline = dueDate(brief.metadata);
    const subject = `[Production Brief] ${brief.source_ref} — ${brief.title}`;
    const replyInstructions = replyTo ? `Reply to ${replyTo} with questions or delivery links.` : "Reply to this email with questions or delivery links.";
    const text = `Hello ${contractor.name},

You have been assigned a production brief for ${clientName}.

Source ref: ${brief.source_ref}
Asset format: ${brief.asset_format}
Title: ${brief.title}
${deadline ? `Target date: ${deadline}\n` : ""}${message ? `Assignment note: ${message}\n` : ""}
PRODUCTION INSTRUCTIONS

${brief.content_md}

Proof and claim restrictions in the brief are binding. Do not add unsupported proof, outcomes, testimonials, metrics, or claims.

${replyInstructions}`;
    const html = `<p>Hello ${escapeHtml(contractor.name)},</p><p>You have been assigned a production brief for <strong>${escapeHtml(clientName)}</strong>.</p><ul><li><strong>Source ref:</strong> ${escapeHtml(brief.source_ref)}</li><li><strong>Asset format:</strong> ${escapeHtml(brief.asset_format)}</li><li><strong>Title:</strong> ${escapeHtml(brief.title)}</li>${deadline ? `<li><strong>Target date:</strong> ${escapeHtml(deadline)}</li>` : ""}</ul>${message ? `<p><strong>Assignment note:</strong> ${escapeHtml(message)}</p>` : ""}<h2>Production instructions</h2><pre style="white-space:pre-wrap;font-family:ui-monospace,monospace">${escapeHtml(brief.content_md)}</pre><p><strong>Proof and claim restrictions in the brief are binding.</strong> Do not add unsupported proof, outcomes, testimonials, metrics, or claims.</p><p>${escapeHtml(replyInstructions)}</p>`;
    const resendResponse = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [contractor.email], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    const resendBody = await resendResponse.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
    if (!resendResponse.ok || !resendBody.id) {
      const safeError = resendBody.message ?? resendBody.name ?? `Resend returned HTTP ${resendResponse.status}`;
      await Promise.all([
        sb.from("contractor_assignments").update({ status: "failed", error_message: safeError.slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", assignment.id),
        sb.from("client_production_briefs").update({ production_mode: "human", production_status: "failed", updated_at: new Date().toISOString() }).eq("id", brief.id),
      ]);
      return failure(502, "send_email", "Resend did not accept the contractor email.", safeError);
    }

    const sentAt = new Date().toISOString();
    const [assignmentUpdate, briefUpdate] = await Promise.all([
      sb.from("contractor_assignments").update({ status: "sent", sent_at: sentAt, resend_message_id: resendBody.id, error_message: null, updated_at: sentAt }).eq("id", assignment.id).select("*").single(),
      sb.from("client_production_briefs").update({ production_mode: "human", production_status: "assigned_human", updated_at: sentAt }).eq("id", brief.id).select("*").single(),
    ]);
    if (assignmentUpdate.error || briefUpdate.error || !assignmentUpdate.data || !briefUpdate.data) {
      return failure(500, "finalize_assignment", "Email was sent, but assignment state could not be finalized. Manual reconciliation is required.", assignmentUpdate.error?.message ?? briefUpdate.error?.message);
    }
    await sb.from("activity_log").insert({
      client_id: brief.client_id,
      event_type: "production_brief_assigned_human",
      plain_english_message: `${brief.source_ref} sent to ${contractor.name} for human production.`,
      object_type: "contractor_assignment",
      object_id: assignment.id,
      metadata: { production_brief_id: brief.id, contractor_id: contractor.id, source_ref: brief.source_ref, resend_message_id: resendBody.id },
    });
    return json({
      ok: true,
      function: FUNCTION_NAME,
      assignment: { ...assignmentUpdate.data, contractors: { id: contractor.id, name: contractor.name, email: contractor.email, role: contractor.role, specialties: contractor.specialties } },
      brief: briefUpdate.data,
    });
  } catch (error) {
    try {
      if (assignmentId) await sb.from("contractor_assignments").update({ status: "failed", error_message: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000), updated_at: new Date().toISOString() }).eq("id", assignmentId);
      if (briefId) await sb.from("client_production_briefs").update({ production_mode: "human", production_status: "failed", updated_at: new Date().toISOString() }).eq("id", briefId);
    } catch { /* best-effort failure reconciliation */ }
    return failure(500, "unexpected", error instanceof Error ? error.message : String(error));
  }
});
