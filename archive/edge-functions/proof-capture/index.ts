import { svc, json, cors, audit } from "../_shared/aa.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = svc();
    const { entity_id, phase, storage_path, caption = null, captured_at = null, exif = {} } = await req.json();
    if (!entity_id || !phase || !storage_path) return json({ error: "entity_id, phase, storage_path required" }, 400);
    if (!String(storage_path).startsWith(`${entity_id}/`)) return json({ error: "storage_path must be prefixed with {entity_id}/" }, 400);
    const { data: pu } = await sb.from("proof_uploads").insert({ entity_id, phase, storage_path, caption, captured_at: captured_at ?? new Date().toISOString() }).select("id").single();
    const { data: asset } = await sb.from("assets").insert({ entity_id, kind: "image", title: `Proof ${phase}`, storage_path, status: "draft", metadata: { source: "proof-capture", phase, exif } }).select("id").single();
    await audit(sb, "proof_capture", "proof_uploads", pu?.id ?? null, { phase, entity_id, asset_id: asset?.id });
    return json({ ok: true, proof_upload_id: pu?.id, asset_id: asset?.id });
  } catch (e) { return json({ error: String(e) }, 500); }
});
