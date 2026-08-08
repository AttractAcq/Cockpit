// Programme Stage L — generate the Hooks x Visuals x Copy x CTA x Format
// creative matrix for an approved Ad Brief. Idempotent: re-running only
// inserts combinations that don't already exist for this Brief.

import { svc, cors, json, audit } from "../_shared/aa.ts";
import { validateIdeationAccess } from "../_shared/ideation/auth.ts";
import { validateAdBriefBody, generateCreativeMatrix, MAX_VARIANTS_PER_BRIEF } from "../_shared/ad-studio.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { client_id?: string; ad_brief_id?: string; formats?: string[] };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }

  const clientId = (body.client_id ?? "").trim();
  const briefId = (body.ad_brief_id ?? "").trim();
  const formats = Array.isArray(body.formats) ? body.formats.filter((f) => typeof f === "string" && f.trim().length > 0) : [];
  if (!clientId) return json({ code: "CLIENT_ID_REQUIRED" }, 400);
  if (!briefId) return json({ code: "AD_BRIEF_ID_REQUIRED" }, 400);
  if (formats.length === 0) return json({ code: "FORMATS_REQUIRED" }, 400);

  const access = await validateIdeationAccess(req.headers.get("Authorization"), clientId);
  if (!access.ok) return json({ code: access.code, message: access.message }, access.status);

  const sb = svc();

  const brief = await sb.from("ad_briefs").select("id, client_id, status, body").eq("id", briefId).maybeSingle();
  if (brief.error) return json({ code: "LOOKUP_FAILED", message: brief.error.message }, 500);
  if (!brief.data || brief.data.client_id !== clientId) return json({ code: "CROSS_CLIENT_BRIEF" }, 403);
  if (brief.data.status !== "approved") return json({ code: "BRIEF_NOT_APPROVED", message: `Brief status is "${brief.data.status}", not "approved".` }, 409);

  const validated = validateAdBriefBody(brief.data.body);
  if (!validated) return json({ code: "CORRUPT_BRIEF_BODY" }, 500);

  const matrix = generateCreativeMatrix(validated, formats);
  if (!matrix.ok) return json({ code: "MATRIX_TOO_LARGE", message: matrix.error, max_variants: MAX_VARIANTS_PER_BRIEF, total_combinations: matrix.totalCombinations }, 422);

  const existing = await sb.from("ad_creative_variants").select("hook_index, visual_index, copy_index, cta_index, format").eq("ad_brief_id", briefId);
  if (existing.error) return json({ code: "LOOKUP_FAILED", message: existing.error.message }, 500);
  const existingKeys = new Set((existing.data ?? []).map((r) => `${r.hook_index}:${r.visual_index}:${r.copy_index}:${r.cta_index}:${r.format}`));

  const toInsert = matrix.combinations
    .filter((c) => !existingKeys.has(`${c.hookIndex}:${c.visualIndex}:${c.copyIndex}:${c.ctaIndex}:${c.format}`))
    .map((c) => ({
      client_id: clientId, ad_brief_id: briefId,
      hook_index: c.hookIndex, visual_index: c.visualIndex, copy_index: c.copyIndex, cta_index: c.ctaIndex, format: c.format,
      hook_text: c.hookText, visual_ref: c.visualRef, copy_text: c.copyText, cta_text: c.ctaText,
      status: "draft",
      source_provenance: { ad_brief_id: briefId, brief_field_indices: { hook: c.hookIndex, visual: c.visualIndex, copy: c.copyIndex, cta: c.ctaIndex } },
    }));

  let inserted: unknown[] = [];
  if (toInsert.length > 0) {
    const result = await sb.from("ad_creative_variants").insert(toInsert).select("*");
    if (result.error) return json({ code: "INSERT_FAILED", message: result.error.message }, 500);
    inserted = result.data ?? [];
  }

  await audit(sb, "ad_creative_variants.generated", "ad_briefs", briefId, {
    client_id: clientId, formats, new_variant_count: inserted.length, total_combinations: matrix.totalCombinations,
  });

  return json({
    ok: true, new_variants: inserted, new_variant_count: inserted.length,
    total_combinations: matrix.totalCombinations, estimated_cost_units: matrix.estimatedCostUnits,
  }, 201);
});
