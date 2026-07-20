import assert from "node:assert/strict";
import fs from "node:fs";

// Strategy A: review and apply the existing held migration explicitly in a later
// gate. Later recorded migrations are unrelated, and duplicating this 710-line
// lifecycle repair under a new version would create two competing definitions.
const migrationPath = new URL("../supabase/migrations/20260717000019_asset_group_partial_acceptance.sql", import.meta.url);
const sql = fs.readFileSync(migrationPath, "utf8");
const normalized = sql.replace(/\s+/g, " ").toLowerCase();

for (const table of [
  "client_asset_group_warning_acknowledgements",
  "client_asset_group_completeness_overrides",
]) {
  assert.match(normalized, new RegExp(`create table if not exists public\\.${table} \\(`));
  assert.match(normalized, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(normalized, new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
  assert.match(normalized, new RegExp(`grant select on public\\.${table} to authenticated`));
}

for (const rpc of [
  "acknowledge_asset_group_warning",
  "accept_partial_asset_group",
  "review_asset_group",
  "persist_asset_generation_result",
  "persist_regenerated_asset_frame",
]) {
  assert.match(normalized, new RegExp(`create or replace function public\\.${rpc}\\(`));
}
assert.ok((normalized.match(/language plpgsql security definer set search_path = ''/g) ?? []).length >= 5);
assert.match(normalized, /auth: login required/);
assert.match(normalized, /admin','account_manager','editor/);

// Exact-warning acknowledgement is derived from an existing client-owned asset
// group/job and deduped by client, group, warning code, and fingerprint.
assert.match(normalized, /unique \(client_id, asset_group_ref, warning_code, warning_fingerprint\)/);
assert.match(normalized, /from public\.client_assets a where a\.asset_group_ref = p_asset_group_ref/);
assert.match(normalized, /from public\.client_asset_generation_jobs j where j\.asset_group_ref = p_asset_group_ref/);
assert.match(normalized, /warning_code is required/);
assert.match(normalized, /warning_fingerprint is required/);

// Partial acceptance is explicit, stale-aware, publication-safe, and preserves
// generated assets while terminalizing only unfinished queue items.
assert.match(normalized, /a reason of at least 8 characters is required/);
assert.match(normalized, /stale_asset_group: asset group changed while under review/);
assert.match(normalized, /publish_status in \('ready','scheduled','publishing','published','needs_reconciliation'\)/);
assert.match(normalized, /set status = 'cancelled'.*status in \('queued','processing'\)/);
assert.match(normalized, /set status = 'partial'.*closure_type = 'partial_accepted'/);
assert.doesNotMatch(normalized, /delete from public\.client_assets/);
assert.doesNotMatch(normalized, /update public\.client_distribution_records/);
assert.doesNotMatch(normalized, /delete from public\.client_distribution_records/);

// The item constraint expands safely; migration execution itself performs no
// application-data DML before the function definitions are installed.
assert.match(normalized, /status in \('queued','processing','complete','failed','cancelled'\)/);
const ddlOnly = normalized.slice(0, normalized.indexOf("create or replace function"));
assert.doesNotMatch(ddlOnly, /\b(?:insert into|update public|delete from|truncate)\b/);

for (const event of [
  "asset_group_warning_dismissed",
  "asset_group_partial_accepted",
  "asset_generation_items_cancelled",
]) assert.match(normalized, new RegExp(event));

for (const forbidden of [
  "client_metric_snapshots",
  "client_business_signal_snapshots",
  "client_performance_scores",
  "client_performance_insights",
  "run_performance_analysis_for_client",
  "generate-phase-3",
  "callanthropic",
  "callopenai",
]) assert.doesNotMatch(normalized, new RegExp(forbidden));

console.log("asset-partial-acceptance-schema tests passed (Strategy A: apply reviewed migration 20260717000019 explicitly later)");
