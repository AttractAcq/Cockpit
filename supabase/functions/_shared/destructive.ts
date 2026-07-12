// Shared dry-run planning for destructive lifecycle operations. Pure reads — no
// mutations. Both plan-destructive and execute-destructive build the plan from
// this module so the dry-run and the runtime re-check are identical logic.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const BUCKET = "client-assets";
export type OperationType = "delete_asset" | "delete_phase3_content" | "reject_asset" | "reject_content_brief";

export interface DestructiveTarget {
  operation_type: OperationType;
  asset_id?: string;
  master_table?: "organic_master" | "story_master" | "ads_master";
  ref?: string;
  asset_group_ref?: string;
  brief_id?: string;
}

export interface DestructivePlan {
  operation_type: OperationType;
  client_id: string | null;
  target_ref: string | null;
  allowed: boolean;
  blockers: string[];
  published_findings: string[];
  storage_objects: string[];
  rows_to_delete: Record<string, number>;
  rows_to_update: Record<string, number>;
  retain: string[];
  supersede: Record<string, number>;
  version_consequences: string[];
  downstream_consequences: string[];
  summary: string;
}

async function count(sb: SupabaseClient, table: string, filters: Record<string, unknown>): Promise<number> {
  let q = sb.from(table).select("id", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v as never);
  const { count: c } = await q;
  return c ?? 0;
}

async function isPublished(sb: SupabaseClient, clientId: string, sourceRef: string): Promise<boolean> {
  const { data } = await sb.rpc("phase_ref_is_published", { p_client_id: clientId, p_source_ref: sourceRef });
  return data === true;
}

function base(operation_type: OperationType): DestructivePlan {
  return {
    operation_type, client_id: null, target_ref: null, allowed: false, blockers: [], published_findings: [],
    storage_objects: [], rows_to_delete: {}, rows_to_update: {}, retain: [], supersede: {},
    version_consequences: [], downstream_consequences: [], summary: "",
  };
}

export async function buildPlan(sb: SupabaseClient, target: DestructiveTarget): Promise<DestructivePlan> {
  const plan = base(target.operation_type);

  if (target.operation_type === "delete_asset") {
    const { data: asset } = await sb.from("client_assets").select("*").eq("id", target.asset_id ?? "").maybeSingle();
    if (!asset) { plan.blockers.push("Asset not found (already deleted)."); plan.summary = "Nothing to delete."; return plan; }
    plan.client_id = asset.client_id; plan.target_ref = asset.source_ref;
    plan.storage_objects = [asset.storage_path];
    plan.rows_to_delete["client_assets"] = 1;
    if (await isPublished(sb, asset.client_id, asset.source_ref)) {
      plan.published_findings.push("A distribution/analytics record for this ref is published.");
      plan.blockers.push("Cockpit data cannot be permanently deleted because this asset has been published externally. Deleting local records would not delete the Instagram post.");
    }
    const remaining = await count(sb, "client_assets", { production_brief_id: asset.production_brief_id, asset_group_ref: asset.asset_group_ref, sequence_index: asset.sequence_index }) - 1;
    if (asset.is_current && remaining > 0) plan.version_consequences.push(`Current version — the latest of ${remaining} remaining version(s) will be promoted to current.`);
    else if (asset.is_current) plan.version_consequences.push("This is the only version of the frame; the frame will be fully removed.");
    else plan.version_consequences.push("Historical (non-current) version — siblings and the current version are untouched.");
    const refAssets = await count(sb, "client_assets", { client_id: asset.client_id, source_ref: asset.source_ref });
    if (refAssets <= 1) plan.downstream_consequences.push("This is the last asset for the ref; unpublished distribution/analytics for it will be removed and its archive snapshots superseded.");
    plan.retain.push("Sibling frames and other versions.");
    plan.allowed = plan.blockers.length === 0;
    plan.summary = plan.allowed ? `Delete 1 asset (v${asset.version} seq ${asset.sequence_index}) + its storage object.` : "Blocked.";
    return plan;
  }

  if (target.operation_type === "delete_phase3_content") {
    const table = target.master_table!; const ref = target.ref ?? "";
    const { data: master } = await sb.from(table).select("client_id, ref, review_state").eq("ref", ref).maybeSingle();
    if (!master) { plan.blockers.push("Master row not found."); plan.summary = "Nothing to delete."; return plan; }
    plan.client_id = master.client_id; plan.target_ref = ref;
    if (master.review_state === "approved") plan.blockers.push("Approved Phase 3 Content is immutable in this slice.");
    const briefs = await count(sb, "client_production_briefs", { client_id: master.client_id, source_ref: ref });
    const assets = await count(sb, "client_assets", { client_id: master.client_id, source_ref: ref });
    const dist = await count(sb, "client_distribution_records", { client_id: master.client_id, source_ref: ref });
    const analytics = await count(sb, "client_analytics_records", { client_id: master.client_id, source_ref: ref });
    if (briefs) plan.blockers.push(`${briefs} Content Brief(s) exist for ${ref}.`);
    if (assets) plan.blockers.push(`${assets} generated Asset(s) exist for ${ref}.`);
    if (dist) plan.blockers.push(`${dist} Distribution record(s) exist for ${ref}.`);
    if (analytics) plan.blockers.push(`${analytics} Analytics record(s) exist for ${ref}.`);
    if (await isPublished(sb, master.client_id, ref)) { plan.published_findings.push("Published downstream exists."); plan.blockers.push("Published record exists for this ref."); }
    const cells = await count(sb, "calendar_cells", { client_id: master.client_id, ref });
    plan.rows_to_delete[table] = 1; plan.rows_to_delete["calendar_cells"] = cells;
    plan.allowed = plan.blockers.length === 0;
    plan.summary = plan.allowed ? `Delete master ${ref} + ${cells} calendar cell(s).` : "Blocked: downstream/approved.";
    return plan;
  }

  if (target.operation_type === "reject_asset") {
    const group = target.asset_group_ref ?? "";
    const { data: rows } = await sb.from("client_assets").select("client_id, source_ref, production_brief_id, storage_path, is_current, version, sequence_index").eq("asset_group_ref", group);
    if (!rows || rows.length === 0) { plan.blockers.push("No assets for this group."); plan.summary = "Nothing to reject."; return plan; }
    plan.client_id = rows[0].client_id; plan.target_ref = rows[0].source_ref;
    const current = rows.filter((r) => r.is_current !== false);
    const historical = rows.filter((r) => r.is_current === false);
    plan.storage_objects = current.map((r) => r.storage_path);
    plan.rows_to_delete["client_assets (current frames)"] = current.length;
    plan.rows_to_update["client_assets (historical → rejected)"] = historical.length;
    if (await isPublished(sb, rows[0].client_id, rows[0].source_ref)) {
      plan.published_findings.push("A published distribution/analytics record exists for this group.");
      plan.blockers.push("Rejection rollback is blocked because this asset group has been published externally. Deleting local records would not delete the Instagram post.");
    }
    plan.retain.push("Historical versions retained as rejected/superseded audit evidence (is_current=false, status=rejected). No older version is promoted.");
    plan.version_consequences.push("Group rejection leaves NO current asset for the group; the brief returns to Content Briefs to re-produce.");
    const dist = await count(sb, "client_distribution_records", { client_id: rows[0].client_id, asset_group_ref: group });
    const analytics = await count(sb, "client_analytics_records", { client_id: rows[0].client_id, asset_group_ref: group });
    if (dist) plan.downstream_consequences.push(`Up to ${dist} unpublished distribution record(s) removed.`);
    if (analytics) plan.downstream_consequences.push(`Up to ${analytics} unpublished analytics record(s) removed.`);
    plan.supersede["asset-stage archive snapshots"] = await count(sb, "client_asset_archive_snapshots", { client_id: rows[0].client_id, asset_group_ref: group });
    plan.allowed = plan.blockers.length === 0;
    plan.summary = plan.allowed ? `Reject group: delete ${current.length} current frame(s) + storage, retain ${historical.length} historical as rejected, return to Content Briefs.` : "Blocked: published.";
    return plan;
  }

  // reject_content_brief
  const briefId = target.brief_id ?? "";
  const { data: brief } = await sb.from("client_production_briefs").select("client_id, source_ref, status").eq("id", briefId).maybeSingle();
  if (!brief) { plan.blockers.push("Brief not found."); plan.summary = "Nothing to reject."; return plan; }
  plan.client_id = brief.client_id; plan.target_ref = brief.source_ref;
  const { data: assets } = await sb.from("client_assets").select("storage_path").eq("client_id", brief.client_id).eq("production_brief_id", briefId);
  plan.storage_objects = (assets ?? []).map((a) => a.storage_path);
  plan.rows_to_update["client_production_briefs (retain → rejected)"] = 1;
  plan.rows_to_delete["client_assets"] = (assets ?? []).length;
  plan.rows_to_delete["client_asset_generation_jobs (+ items cascade)"] = await count(sb, "client_asset_generation_jobs", { client_id: brief.client_id, production_brief_id: briefId });
  if (await isPublished(sb, brief.client_id, brief.source_ref)) {
    plan.published_findings.push("Published downstream content exists for this brief.");
    plan.blockers.push("Rejection rollback is blocked because this brief has published downstream content. Deleting local records would not delete the Instagram post.");
  }
  plan.retain.push("The brief row is retained as immutable rejected evidence (status=rejected) — never hard-deleted.");
  plan.downstream_consequences.push("Unpublished distribution/analytics for this brief/ref removed; archive snapshots superseded.");
  plan.supersede["archive snapshots"] = await count(sb, "client_asset_archive_snapshots", { client_id: brief.client_id, source_ref: brief.source_ref });
  plan.allowed = plan.blockers.length === 0;
  plan.summary = plan.allowed ? `Reject brief ${brief.source_ref}: retain as rejected, delete ${(assets ?? []).length} asset(s) + storage, return to Content.` : "Blocked: published.";
  return plan;
}
