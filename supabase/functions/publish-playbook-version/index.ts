// Programme Stage C runtime: freeze a playbook into an immutable version.
//
// public.playbooks keeps its mutable working copy. This snapshots content_md
// into playbook_versions with a content hash, so a Phase 1 generation can
// record exactly which authority produced it and a later edit cannot silently
// replace locked authority.
//
// Playbooks are AA methodology, not client data, so access is role-gated rather
// than client-scoped.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { svc, cors, json, audit, SUPABASE_URL } from "../_shared/aa.ts";
import { isIdeationStaffRole } from "../_shared/ideation/access-policy.ts";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED" }, 405);

  let body: { playbook_id?: string; activate?: boolean };
  try { body = await req.json(); } catch { return json({ code: "INVALID_JSON" }, 400); }
  const playbookId = (body.playbook_id ?? "").trim();
  if (!playbookId) return json({ code: "PLAYBOOK_ID_REQUIRED" }, 400);

  // Role gate (no client scope: playbooks are not client data).
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json({ code: "NOT_AUTHENTICATED" }, 401);
  const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
  if (!anonKey) return json({ code: "AUTH_CONFIGURATION_MISSING" }, 503);
  const uc = createClient(SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: authData, error: authErr } = await uc.auth.getUser(jwt);
  if (authErr || !authData.user) return json({ code: "NOT_AUTHENTICATED" }, 401);
  const { data: roleData } = await uc.rpc("auth_role");
  if (!isIdeationStaffRole(typeof roleData === "string" ? roleData : "")) {
    return json({ code: "STAFF_ROLE_REQUIRED", message: "Publishing playbook authority requires admin or account manager." }, 403);
  }
  const userId = authData.user.id;

  const sb = svc();
  const { data: playbook, error: pbErr } = await sb
    .from("playbooks").select("id, slug, name, content_md").eq("id", playbookId).maybeSingle();
  if (pbErr) return json({ code: "LOOKUP_FAILED", message: pbErr.message }, 500);
  if (!playbook) return json({ code: "PLAYBOOK_NOT_FOUND" }, 404);

  const content = (playbook.content_md ?? "").toString();
  if (content.trim().length === 0) {
    return json({ code: "EMPTY_PLAYBOOK", message: "A playbook with no content cannot become authority." }, 422);
  }
  const contentHash = await sha256Hex(content);

  // Identical content is not republished: the existing version stays authority.
  const { data: same } = await sb
    .from("playbook_versions")
    .select("id, version, status")
    .eq("playbook_id", playbookId)
    .eq("content_hash", contentHash)
    .maybeSingle();
  if (same) {
    return json({
      unchanged: true, playbook_version_id: same.id, version: same.version, status: same.status,
      message: "Playbook content is unchanged; the existing version remains authority.",
    }, 200);
  }

  const { data: latest } = await sb
    .from("playbook_versions").select("version").eq("playbook_id", playbookId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  const nextVersion = ((latest?.version as number) ?? 0) + 1;

  const activate = body.activate !== false;
  const nowIso = new Date().toISOString();

  const { data: created, error: insErr } = await sb
    .from("playbook_versions")
    .insert({
      playbook_id: playbookId,
      version: nextVersion,
      content_md: content,
      content_hash: contentHash,
      status: "draft",
    })
    .select("id")
    .single();
  if (insErr) return json({ code: "INSERT_FAILED", message: insErr.message }, 500);
  const versionId = created.id as string;

  if (activate) {
    // Supersede the current active version first: a partial unique index allows
    // only one active version per playbook, so this ordering matters.
    const { error: supErr } = await sb
      .from("playbook_versions")
      .update({ status: "superseded" })
      .eq("playbook_id", playbookId)
      .eq("status", "active");
    if (supErr) {
      await sb.from("playbook_versions").delete().eq("id", versionId);
      return json({ code: "SUPERSEDE_FAILED", message: supErr.message }, 500);
    }
    const { error: actErr } = await sb
      .from("playbook_versions")
      .update({ status: "active", published_at: nowIso, published_by: userId })
      .eq("id", versionId);
    if (actErr) {
      await sb.from("playbook_versions").delete().eq("id", versionId);
      return json({ code: "ACTIVATE_FAILED", message: actErr.message }, 500);
    }
  }

  await audit(sb, "playbook_version.published", "playbook_versions", versionId, {
    playbook_id: playbookId, version: nextVersion, activated: activate, content_hash: contentHash,
  });

  return json({
    unchanged: false,
    playbook_version_id: versionId,
    version: nextVersion,
    status: activate ? "active" : "draft",
    content_hash: contentHash,
  }, 201);
});
