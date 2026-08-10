import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  boundedIntelligenceExcerpt,
  intelligenceFreshness,
  INTELLIGENCE_DOMAINS,
  type ApprovedIntelligenceRelease,
} from "../supabase/functions/_shared/client-authority.ts";

const migrationPath = new URL("../supabase/migrations/20260812150000_phase_2a_f_operationalization.sql", import.meta.url);
const authorityPath = new URL("../supabase/functions/_shared/client-authority.ts", import.meta.url);
const evidencePath = new URL("../supabase/functions/_shared/ideation/authority-evidence.ts", import.meta.url);
const researchPath = new URL("../supabase/functions/_shared/ideation/techniques/research.ts", import.meta.url);
const modelPath = new URL("../supabase/functions/_shared/ideation/model.ts", import.meta.url);
const runHandlerPath = new URL("../supabase/functions/run-ideation/handler.ts", import.meta.url);
const runIndexPath = new URL("../supabase/functions/run-ideation/index.ts", import.meta.url);
const commitPath = new URL("../supabase/functions/commit-ideation-content/index.ts", import.meta.url);
const verifyPath = new URL("../supabase/functions/_shared/intelligence/operational-authority.ts", import.meta.url);
const operationsPanelPath = new URL("../src/components/operations/IntelligenceOperationsPanel.tsx", import.meta.url);
const controlPanelPath = new URL("../src/components/operations/OperationsControlPanel.tsx", import.meta.url);

function release(domain: ApprovedIntelligenceRelease["intelligence_domain"], index: number): ApprovedIntelligenceRelease {
  return {
    id: `release-${index}`,
    intelligence_domain: domain,
    version: index,
    title: domain,
    summary: `Approved ${domain} summary`,
    content: {},
    authority_snapshot: {},
    approved_at: "2026-08-01T00:00:00.000Z",
    freshness: "fresh",
    records: [{
      id: `record-${index}`,
      release_id: `release-${index}`,
      record_type: "core",
      record_key: `${domain}_core`,
      title: `${domain} record`,
      summary: `Supported ${domain} observation`,
      payload: {},
      display_order: 0,
    }],
  };
}

test("2A-F is operationalization, not a sixth intelligence domain", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.deepEqual(INTELLIGENCE_DOMAINS, ["market_os", "avatar_os", "competitor_os", "association_os", "brand_strategist"]);
  assert.doesNotMatch(migration, /intelligence_domain[^;]*operationalization/i);
  assert.match(migration, /create table public\.client_intelligence_release_dependencies/);
  assert.match(migration, /create table public\.client_intelligence_consumptions/);
  assert.match(migration, /create table public\.client_intelligence_refresh_requests/);
  assert.match(migration, /create table public\.client_intelligence_change_proposals/);
  assert.match(migration, /create view public\.client_intelligence_operational_status/);
});

test("freshness remains policy-derived and domain excerpts stay bounded", () => {
  const approvedAt = "2026-08-01T00:00:00.000Z";
  assert.equal(intelligenceFreshness(approvedAt, 30, 7, new Date("2026-08-10T00:00:00.000Z")), "fresh");
  assert.equal(intelligenceFreshness(approvedAt, 30, 7, new Date("2026-08-25T00:00:00.000Z")), "due");
  assert.equal(intelligenceFreshness(approvedAt, 30, 7, new Date("2026-09-01T00:00:00.000Z")), "stale");
  const releases = INTELLIGENCE_DOMAINS.map((domain, index) => release(domain, index + 1));
  const bounded = boundedIntelligenceExcerpt(releases, 500, 140);
  assert.ok(bounded.excerpt.length <= 500);
  assert.equal(bounded.references.length, 5);
  assert.match(bounded.excerpt, /ACTIVE APPROVED/i);
});

test("downstream consumption is active-approved, fresh, dependency-safe, immutable, and client-isolated", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const recordFunction = migration.match(/create or replace function public\.record_intelligence_consumption[\s\S]*?end; \$\$;/)?.[0] ?? "";
  assert.match(recordFunction, /release\.status = 'approved'/);
  assert.match(recordFunction, /required active approved intelligence is missing or stale/i);
  assert.match(recordFunction, /intelligence dependency drift requires refresh/i);
  assert.match(recordFunction, /intelligence changed before downstream consumption was recorded/i);
  assert.match(recordFunction, /already bound to different intelligence/i);
  assert.match(migration, /foreign key \(dependent_release_id, client_id\)/);
  assert.match(migration, /foreign key \(upstream_release_id, client_id\)/);
  assert.match(migration, /client_intelligence_consumptions_append_only/);
  assert.match(migration, /revoke all on function public\.record_intelligence_consumption[^;]+authenticated/);
  assert.match(migration, /grant execute on function public\.record_intelligence_consumption[^;]+service_role/);
});

test("supersession invalidates consumers and queues only affected dependent domains", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const invalidation = migration.match(/create or replace function public\.invalidate_superseded_intelligence_consumers[\s\S]*?end; \$\$;/)?.[0] ?? "";
  assert.match(invalidation, /invalidated_at = now\(\)/);
  assert.match(invalidation, /authority_snapshot -> new\.intelligence_domain ->> 'release_id' = old\.release_id::text/);
  assert.match(invalidation, /dependency\.upstream_release_id = old\.release_id/);
  assert.match(invalidation, /dependency\.material/);
  assert.match(invalidation, /request_type[^\n]*dependency|dependent_domain, 'dependency'/);
  assert.doesNotMatch(invalidation, /update public\.client_intelligence_releases/);
  assert.doesNotMatch(invalidation, /status = 'approved'/);
});

test("refresh commands preserve domain cadence and never auto-run or auto-approve", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /policy\.refresh_interval_days - policy\.due_warning_days/);
  assert.match(migration, /policy\.scheduled_refresh_enabled/);
  assert.match(migration, /request_type in \('manual','scheduled','dependency'\)/);
  assert.match(migration, /status in \('requested','claimed','completed','cancelled','failed'\)/);
  assert.doesNotMatch(migration, /perform public\.review_intelligence_release/);
  assert.doesNotMatch(migration, /invoke.*run-(market|avatar|competitor|association)/i);
});

test("feedback proposals are reviewable but cannot mutate Context or approved intelligence", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const review = migration.match(/create or replace function public\.review_intelligence_change_proposal[\s\S]*?end; \$\$;/)?.[0] ?? "";
  assert.match(review, /auth\.uid\(\) is null/);
  assert.match(review, /p_decision not in \('approved','dismissed','converted_to_draft'\)/);
  assert.match(review, /approve the proposal before converting it to a draft/i);
  assert.doesNotMatch(review, /update public\.client_context_files/);
  assert.doesNotMatch(review, /update public\.client_intelligence_releases/);
  assert.match(migration, /Approval never mutates existing authority/i);
});

test("Ideation consumes, cites, and snapshots all approved intelligence domains", async () => {
  const [authority, evidence, research, model, handler, index] = await Promise.all([
    readFile(authorityPath, "utf8"), readFile(evidencePath, "utf8"), readFile(researchPath, "utf8"),
    readFile(modelPath, "utf8"), readFile(runHandlerPath, "utf8"), readFile(runIndexPath, "utf8"),
  ]);
  assert.match(authority, /INTELLIGENCE_AUTHORITY_INCOMPLETE/);
  assert.match(authority, /INTELLIGENCE_AUTHORITY_STALE/);
  assert.match(authority, /INTELLIGENCE_DEPENDENCY_DRIFT/);
  assert.match(evidence, /sourceType: "approved_intelligence"/);
  assert.match(evidence, /const intelligence = Object\.fromEntries/);
  assert.match(research, /buildIntelligenceEvidenceSources/);
  assert.match(model, /ACTIVE APPROVED INTELLIGENCE/);
  assert.match(model, /source\.source_type === "approved_intelligence"/);
  assert.match(handler, /p_consumer_type: "ideation_cycle"/);
  assert.match(handler, /p_expected_authority: authoritySnapshot\.intelligence/);
  assert.match(index, /record_intelligence_consumption/);
});

test("final Ideation commit fails closed when consumed intelligence drifts or becomes stale", async () => {
  const [commit, verifier] = await Promise.all([readFile(commitPath, "utf8"), readFile(verifyPath, "utf8")]);
  assert.match(commit, /verifyIntelligenceAuthoritySnapshot/);
  assert.match(commit, /authoritySnapshot\.intelligence/);
  assert.match(verifier, /INTELLIGENCE_AUTHORITY_DRIFT/);
  assert.match(verifier, /INTELLIGENCE_AUTHORITY_STALE/);
  assert.match(verifier, /INTELLIGENCE_DEPENDENCY_DRIFT/);
  assert.match(verifier, /content no longer matches the recorded authority hash/i);
});

test("Operations exposes portfolio readiness, refresh recovery, proposals, and consumption audit", async () => {
  const [panel, control] = await Promise.all([readFile(operationsPanelPath, "utf8"), readFile(controlPanelPath, "utf8")]);
  assert.match(control, /intelligence: "Intelligence"/);
  assert.match(control, /<IntelligenceOperationsPanel clients=\{clients\}/);
  assert.match(panel, /Client\/domain readiness/);
  assert.match(panel, /Request refresh/);
  assert.match(panel, /Change proposal review/);
  assert.match(panel, /Downstream authority ledger/);
  assert.match(panel, /No authority was mutated/);
});
