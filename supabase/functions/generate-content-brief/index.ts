// Programme Stage H — generate a structured Content Brief for a Content
// Item. Writes content_briefs (new version), content_item_proof (provenance
// links to whichever Proof backs the Opportunity this item came from), and
// updates content_items.current_content_brief_id. Re-generation supersedes
// any prior approved version rather than overwriting it.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { callAnthropic, hasAnthropicKey, isAiEnabled, DEFAULT_AI_MODEL } from "../_shared/anthropic.ts";
import { validateStructuredBrief, renderBriefMarkdown } from "../_shared/content-brief.ts";

function buildPrompt(input: {
  itemTitle: string;
  opportunity: Record<string, unknown> | null;
  slot: Record<string, unknown> | null;
  proofExcerpts: string;
  contextExcerpts: string;
}): { system: string; user: string } {
  const system =
    "You are the Content Brief generator for Attract Acquisition's Cockpit. " +
    "You convert an approved Content Opportunity and its Calendar Slot into one structured, " +
    "production-ready Content Brief. Never invent proof, results, metrics or claims beyond what " +
    "is given. Set proof_required to true only if the brief's core claim actually depends on proof " +
    "to be credible — if so and no proof excerpt is provided, still set it true and leave the proof " +
    "field null; do not fabricate proof to fill the gap. Output ONLY a JSON object, no prose, no markdown fence.";

  const user = `CONTENT ITEM: ${input.itemTitle}

OPPORTUNITY:
${JSON.stringify(input.opportunity, null, 2)}

CALENDAR SLOT:
${JSON.stringify(input.slot, null, 2)}

AVAILABLE PROOF (verified only):
${input.proofExcerpts || "(none available)"}

APPROVED BUSINESS CONTEXT (excerpts, for grounding only):
${input.contextExcerpts.slice(0, 3000)}

Return a JSON object with exactly these keys: objective, audience, platform, format,
organic_or_paid ("organic" or "paid"), core_idea, core_claim (string or null), hook,
belief_before, belief_after, proof (string or null), proof_required (boolean),
narrative_structure, copy_or_script_requirements, visual_direction,
asset_inputs (string array), brand_constraints (string array), cta, approval_rules,
production_mode ("ai", "human", or "hybrid"), required_outputs (string array),
quality_checklist (string array).`;

  return { system, user };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const tryParse = (candidate: string): Record<string, unknown> | null => {
    try {
      const value = JSON.parse(candidate);
      return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  };
  const raw = tryParse(text.trim());
  if (raw) return raw;
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  if (fenced) {
    const parsed = tryParse(fenced[1]);
    if (parsed) return parsed;
  }
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s >= 0 && e > s) {
    const parsed = tryParse(text.slice(s, e + 1));
    if (parsed) return parsed;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; content_item_id?: string };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const contentItemId = (body.content_item_id ?? "").trim();
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!contentItemId) return json({ code: "CONTENT_ITEM_ID_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  if (!isAiEnabled() || !hasAnthropicKey()) {
    return json({ code: "AI_GENERATION_DISABLED", message: "AI generation is not enabled for this environment." }, 503);
  }

  const sb = svc();

  const { data: item, error: itemError } = await sb
    .from("content_items")
    .select("id, client_id, title, content_opportunity_id, calendar_slot_id, context_version, execution_version")
    .eq("id", contentItemId)
    .maybeSingle();
  if (itemError) return json({ code: "LOOKUP_FAILED", message: itemError.message }, 500);
  if (!item) return json({ code: "CONTENT_ITEM_NOT_FOUND" }, 404);
  if (item.client_id !== clientId) return json({ code: "CROSS_CLIENT_CONTENT_ITEM" }, 403);

  const [oppRes, slotRes, existingRes, contextRes] = await Promise.all([
    item.content_opportunity_id
      ? sb.from("content_opportunities").select("*").eq("id", item.content_opportunity_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    item.calendar_slot_id
      ? sb.from("calendar_slots").select("*").eq("id", item.calendar_slot_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sb.from("content_briefs").select("id, brief_version, status").eq("content_item_id", contentItemId).order("brief_version", { ascending: false }),
    sb.from("client_context_files")
      .select("file_name, content_md")
      .eq("client_id", clientId)
      .eq("status", "approved")
      .in("file_number", [1, 2, 3, 4]),
  ]);
  if (oppRes.error) return json({ code: "LOOKUP_FAILED", message: oppRes.error.message }, 500);
  if (slotRes.error) return json({ code: "LOOKUP_FAILED", message: slotRes.error.message }, 500);
  if (existingRes.error) return json({ code: "LOOKUP_FAILED", message: existingRes.error.message }, 500);

  let proofExcerpts = "";
  let linkedSourceIds: string[] = [];
  if (item.content_opportunity_id) {
    const { data: sourceLinks } = await sb
      .from("content_opportunity_sources")
      .select("content_source_id")
      .eq("content_opportunity_id", item.content_opportunity_id);
    linkedSourceIds = (sourceLinks ?? []).map((r) => r.content_source_id);
    if (linkedSourceIds.length > 0) {
      const { data: linkedProof } = await sb
        .from("proof_items")
        .select("claim, evidence_ref, verification_status")
        .eq("verification_status", "verified")
        .in("content_source_id", linkedSourceIds);
      proofExcerpts = (linkedProof ?? []).map((p) => `- ${p.claim}${p.evidence_ref ? ` (${p.evidence_ref})` : ""}`).join("\n");
    }
  }

  const contextExcerpts = (contextRes.data ?? [])
    .map((f) => `[${f.file_name}]\n${String(f.content_md ?? "").slice(0, 1000)}`)
    .join("\n\n") || "(no approved context files available)";

  const { system, user } = buildPrompt({
    itemTitle: item.title,
    opportunity: oppRes.data as Record<string, unknown> | null,
    slot: slotRes.data as Record<string, unknown> | null,
    proofExcerpts,
    contextExcerpts,
  });

  const aiResult = await callAnthropic({ system, user, maxTokens: 3000, timeoutMs: 60000 });
  if (!aiResult.ok) {
    return json({ code: aiResult.code, message: aiResult.error, retryable: aiResult.retryable }, 502);
  }

  const parsed = extractJsonObject(aiResult.text);
  if (!parsed) return json({ code: "GENERATION_RESPONSE_INVALID", message: "The model did not return a valid JSON object." }, 502);

  const structured = validateStructuredBrief(parsed);
  if (!structured) return json({ code: "GENERATION_SCHEMA_INVALID", message: "The generated brief failed schema validation." }, 502);

  const nextVersion = (existingRes.data?.[0]?.brief_version ?? 0) + 1;
  const renderedMarkdown = renderBriefMarkdown(structured, item.title);

  // Re-generation supersedes any prior approved version rather than leaving
  // two "current" briefs for the same Content Item.
  const previousApproved = existingRes.data?.find((b) => b.status === "approved");
  if (previousApproved) {
    await sb.from("content_briefs").update({ status: "superseded" }).eq("id", previousApproved.id);
  }

  const { data: newBrief, error: insertError } = await sb
    .from("content_briefs")
    .insert({
      client_id: clientId,
      content_item_id: contentItemId,
      brief_version: nextVersion,
      status: "draft",
      body: structured,
      rendered_markdown: renderedMarkdown,
      context_version: item.context_version,
      execution_version: item.execution_version,
      provider: "anthropic",
      model: DEFAULT_AI_MODEL,
    })
    .select("*")
    .single();
  if (insertError) return json({ code: "INSERT_FAILED", message: insertError.message }, 500);

  const { error: pointerError } = await sb
    .from("content_items")
    .update({ current_content_brief_id: newBrief.id })
    .eq("id", contentItemId);
  if (pointerError) return json({ code: "POINTER_UPDATE_FAILED", message: pointerError.message, brief: newBrief }, 500);

  // Provenance: link whichever verified Proof actually backs this Brief.
  if (linkedSourceIds.length > 0) {
    const { data: verifiedProof } = await sb
      .from("proof_items")
      .select("id")
      .eq("verification_status", "verified")
      .in("content_source_id", linkedSourceIds);
    for (const p of verifiedProof ?? []) {
      await sb.from("content_item_proof").upsert(
        { client_id: clientId, content_item_id: contentItemId, proof_item_id: p.id },
        { onConflict: "content_item_id,proof_item_id", ignoreDuplicates: true },
      );
    }
  }

  await audit(sb, "content_brief.generated", "content_briefs", newBrief.id, {
    client_id: clientId, content_item_id: contentItemId, brief_version: nextVersion,
  });

  return json({ ok: true, content_item_id: contentItemId, brief: newBrief }, 201);
});
