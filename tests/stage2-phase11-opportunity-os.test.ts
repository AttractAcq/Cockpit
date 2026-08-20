// Stage 2 Phase 11 — Opportunity OS.
//
// Source-text/migration assertions, matching this repo's established
// convention. Live behaviour (RLS, staff-gating, the anon/non-staff
// auth-rejection pass, happy-path detection across all three finding
// types citing real source rows, idempotency on re-run, review-status
// validation, and nonexistent-client rejection) was verified directly
// against xivewedajschthjlblfb with disposable ZZ-TEST fixtures inside
// rolled-back transactions before this file was written.
//
// Built ahead of the phase's own stated prerequisite (Finance/Sales each
// having multiple real reconciled cycles) on Alex's explicit override —
// see the migration header. Findings are expected to be sparse against
// real AA data today; that is honest, not a bug this test suite papers
// over. The exit gate itself (a full quarter minimum of confirmed-
// trustworthy review) is NOT being claimed met by this phase.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const migrationPath = new URL("../supabase/migrations/20260820290000_stage2_phase11_opportunity_os.sql", import.meta.url);
const typesPath = new URL("../src/types/opportunity.ts", import.meta.url);
const libPath = new URL("../src/lib/opportunity.ts", import.meta.url);
const pagePath = new URL("../src/pages/OpportunitiesPage.tsx", import.meta.url);
const appPath = new URL("../src/App.tsx", import.meta.url);
const constantsPath = new URL("../src/lib/constants.ts", import.meta.url);
const buildPlanPath = new URL("../docs/STAGE_2_BUSINESS_OS_BUILD_PLAN.md", import.meta.url);

test("opportunity_os_findings is additive and named to avoid the content_opportunities/ad_opportunities naming collision", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create table public\.opportunity_os_findings/);
  assert.doesNotMatch(migration, /alter table public\.(clients|sales_leads|client_finance_periods|client_performance_scores)/, "Phase 11 must not modify any existing table");
  assert.match(migration, /content_opportunities[\s\S]*?already use that bare word/);
});

test("finding_type is constrained to exactly the three documented detection rules", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /constraint opportunity_os_findings_type_check check \(finding_type in \('margin_risk', 'stalled_lead', 'underperforming_channel'\)\)/);
});

test("a reviewed finding always carries reviewed_by/reviewed_at -- enforced by a table CHECK, not just app logic", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /constraint opportunity_os_findings_reviewed_check check \(\(status = 'pending_review'\) or \(reviewed_by is not null and reviewed_at is not null\)\)/);
});

test("run_opportunity_detection is staff-gated (the 7-role list) and rejects an unknown client", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const body = migration.split("create or replace function public.run_opportunity_detection")[1].split("create or replace function public.review_opportunity_finding")[0];
  assert.match(body, /not in \('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst'\) then\s*\n\s*raise exception 'AUTH: staff role required'/);
  assert.match(body, /if not exists \(select 1 from public\.clients where id = p_client_id\) then raise exception 'NOT_FOUND: client'; end if;/);
});

test("every correlated-subquery idempotency check is fully alias-qualified -- the real bug found via live-testing", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const body = migration.split("create or replace function public.run_opportunity_detection")[1].split("create or replace function public.review_opportunity_finding")[0];
  // Each of the three detection branches' NOT EXISTS guard must reference the
  // outer row's own id via its table alias (cfp.id / l.id / ps.id), never a
  // bare `id` that would silently shadow to opportunity_os_findings' own id.
  assert.match(body, /'table','client_finance_periods','id',cfp\.id::text/);
  assert.match(body, /'table','sales_leads','id', l\.id::text/);
  assert.match(body, /'table','client_performance_scores','id',ps\.id::text/);
  assert.doesNotMatch(body, /'id',id::text/, "a bare unqualified id would shadow to the findings table's own primary key");
  assert.match(migration, /found live: it broke idempotency/);
});

test("review_opportunity_finding validates status and logs to activity_log", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const body = migration.split("create or replace function public.review_opportunity_finding")[1];
  assert.match(body, /if p_status not in \('confirmed_useful','dismissed'\) then raise exception 'VALIDATION: status must be confirmed_useful or dismissed'; end if;/);
  assert.match(body, /insert into public\.activity_log/);
  assert.match(body, /event_type, plain_english_message, object_type, object_id, metadata\)\s*\n\s*values \(v_row\.client_id, auth\.uid\(\), 'opportunity_finding_reviewed'/);
});

test("both RPCs are staff-authenticated, not service-role-only -- unlike Phase 10's webhook ingestion path", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /grant execute on function public\.run_opportunity_detection\(uuid\) to authenticated, service_role;/);
  assert.match(migration, /grant execute on function public\.review_opportunity_finding\(uuid,text,text\) to authenticated, service_role;/);
});

test("zero automatic downstream action -- deferred per the phase's own text, stated honestly in the migration header", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /Every finding is\s*\n-- human-reviewed only; nothing here triggers anything\./);
});

test("OpportunityFindingRow type matches the migration's columns", async () => {
  const types = await readFile(typesPath, "utf8");
  assert.match(types, /export type OpportunityFindingType = "margin_risk" \| "stalled_lead" \| "underperforming_channel"/);
  assert.match(types, /export type OpportunityFindingStatus = "pending_review" \| "confirmed_useful" \| "dismissed"/);
  assert.match(types, /export interface OpportunityFindingRow \{[\s\S]*?source_refs: \{ table: string; id: string \}\[\];[\s\S]*?reviewed_by: string \| null;[\s\S]*?\}/);
});

test("opportunity.ts reads the table directly and calls both RPCs by name -- no direct table write", async () => {
  const lib = await readFile(libPath, "utf8");
  assert.match(lib, /from\("opportunity_os_findings"\)/);
  assert.match(lib, /supabase\.rpc\("run_opportunity_detection"/);
  assert.match(lib, /supabase\.rpc\("review_opportunity_finding"/);
  assert.doesNotMatch(lib, /from\("opportunity_os_findings"\)\.(insert|update|upsert)/, "the frontend must never write a finding row directly -- only the RPCs may");
});

test("routes and nav wiring: Opportunities is a new top-level page", async () => {
  const constants = await readFile(constantsPath, "utf8");
  assert.match(constants, /opportunities: "\/opportunities"/);
  assert.match(constants, /label: "Opportunities",\s*path: ROUTES\.opportunities/);
  const app = await readFile(appPath, "utf8");
  assert.match(app, /path=\{ROUTES\.opportunities\} element=\{<OpportunitiesPage \/>\}/);
});

test("the report page offers running detection per client and reviewing a pending finding, never auto-review", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /runOpportunityDetection/);
  assert.match(page, /reviewOpportunityFinding/);
  assert.match(page, /"confirmed_useful"/);
  assert.match(page, /"dismissed"/);
});

test("the build plan honestly records the override decision and does not claim the exit gate met", async () => {
  const plan = await readFile(buildPlanPath, "utf8");
  const phase11 = plan.split("### Phase 11")[1]?.split("### Phase 12")[0] ?? "";
  assert.match(phase11, /[Oo]verride/, "must document that the phase's own prerequisite gate was explicitly overridden");
  assert.match(phase11, /not.{0,40}(met|claim)/i, "must not claim the full-quarter review exit gate is met");
});
