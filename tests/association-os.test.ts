import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ASSOCIATION_CORE_MODULES,
  normaliseAssociationAuthorityRecordKey,
} from "../supabase/functions/_shared/intelligence/association-research-provider.ts";

const providerPath = new URL("../supabase/functions/_shared/intelligence/association-research-provider.ts", import.meta.url);
const edgePath = new URL("../supabase/functions/run-association-os/index.ts", import.meta.url);
const pagePath = new URL("../src/pages/ClientDetailPage.tsx", import.meta.url);
const panelPath = new URL("../src/components/client/AssociationOSPanel.tsx", import.meta.url);

test("Association OS covers polarity, trust, proof, cues, variation, and cautions", () => {
  assert.deepEqual(
    ASSOCIATION_CORE_MODULES.map((module) => module.key),
    ["association_map", "trust_credibility_signals", "proof_authority_ecosystem", "emotional_symbolic_language_cues", "role_segment_variation", "tensions_cautions_unknowns"],
  );
});

test("Association authority keys accept exact keys and unambiguous type/key drift only", () => {
  const allowed = ["economic_decision_owner", "marketing_or_commercial_operator"];
  assert.equal(normaliseAssociationAuthorityRecordKey("economic_decision_owner", allowed), "economic_decision_owner");
  assert.equal(
    normaliseAssociationAuthorityRecordKey("buyer_role_system/economic_decision_owner", allowed),
    "economic_decision_owner",
  );
  assert.equal(normaliseAssociationAuthorityRecordKey("buyer_role_system/invented_role", allowed), null);
});

test("Association orchestration requires every upstream OS and preserves refresh history", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /APPROVED_AVATAR_OS_REQUIRED/);
  assert.doesNotMatch(edge, /APPROVED_MARKET_OS_REQUIRED/);
  assert.doesNotMatch(edge, /APPROVED_COMPETITOR_OS_REQUIRED/);
  assert.match(edge, /eq\("intelligence_domain", "avatar_os"\)/);
  assert.match(edge, /eq\("status", "approved"\)/);
  assert.match(edge, /market_os: authority\.marketRelease \? \{/);
  assert.match(edge, /avatar_os: \{/);
  assert.match(edge, /competitor_os: authority\.competitorRelease \? \{/);
  assert.match(edge, /previous_association_os:/);
  assert.match(edge, /ensureNextResearchStep/);
  assert.match(edge, /association_identity/);
  assert.match(edge, /association_fingerprint/);
  assert.match(edge, /change_status/);
  assert.match(edge, /unsupportedAvatarKeys/);
  assert.match(edge, /retry_step/);
  assert.match(edge, /failed_module_requeued/);
  assert.match(edge, /refresh_interval_days: 180/);
  assert.match(edge, /"completed_partial"/);
  assert.match(edge, /exhaustedFailedStepIds/);
  assert.match(edge, /status: "queued",\s+attempt_count: 0/);
  assert.match(edge, /status: "needs_review"/);
  assert.doesNotMatch(edge, /review_intelligence_release/);
});

test("Market OS and Competitor OS are optional enrichment, not hard requirements — only Avatar OS blocks", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /async function loadOptionalUpstreamAuthority\(/);
  assert.match(edge, /domain: "market_os" \| "competitor_os"/);
  assert.match(edge, /return \{ ok: true, release: null, records: \[\] \}/);
  assert.match(edge, /marketRelease: marketAuthorityResult\.release/);
  assert.match(edge, /competitorRelease: competitorAuthorityResult\.release/);
  assert.match(edge, /No approved Market OS release is available for this client/);
  assert.match(edge, /No approved Competitor OS release is available for this client/);
});

test("Association orchestration is an Anthropic tool-calling agent with memory and an audit trail", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /runAssociationResearchAgent/);
  assert.doesNotMatch(edge, /runOpenAiAssociationResearch/);
  assert.match(edge, /provider: "anthropic"/);
  assert.match(edge, /ANTHROPIC_ASSOCIATION_RESEARCH_MODEL/);
  assert.match(edge, /client_agent_memory/);
  assert.match(edge, /client_agent_turns/);
  assert.match(edge, /renderMemoryNote/);
});

test("every module runs as a two-phase search step then write step, each a separate invocation", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /function researchStepKey\(moduleKey: string\)/);
  assert.match(edge, /runAssociationSearchPhase/);
  assert.match(edge, /ensureWriteStep/);
  assert.match(edge, /ensureNextResearchStep/);
  assert.match(edge, /priorResearchNotes/);
  assert.match(edge, /priorSources/);
  assert.match(edge, /realModuleKeys\.has\(step\.step_key\)/);
});

test("prepare() archives runs that can never resume instead of leaving them in limbo", async () => {
  const edge = await readFile(edgePath, "utf8");
  assert.match(edge, /async function archiveStaleRun\(/);
  assert.match(edge, /status: "cancelled", retryable: false/);
  assert.match(edge, /status: "archived"/);
  assert.match(edge, /association_os\.stale_run_archived/);
  assert.match(edge, /if \(!release\) \{[\s\S]*?await archiveStaleRun\(sb, clientId, run\.id, null\);/);
  assert.match(edge, /if \(!canResume\) \{[\s\S]*?await archiveStaleRun\(sb, clientId, run\.id, release\.id\);/);
});

test("search phase runs targeted gap searches against the existing corpus instead of re-discovering it every module", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /const hasExistingCorpus = Boolean\(input\.existingAssociationModel\) && input\.module\.key !== "association_map"/);
  assert.match(provider, /Do NOT re-run broad discovery searches for new associations/);
  assert.match(provider, /targeted, subject-specific queries/);
});

test("Association provider is a bounded Anthropic web_search agent loop with a schema-enforced non-empty records array", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /callAnthropicWithTools/);
  assert.match(provider, /web_search_20260209/);
  assert.match(provider, /submit_module/);
  assert.match(provider, /minItems: 1/);
  assert.match(provider, /MAX_AGENT_TURNS/);
  assert.match(provider, /export async function runAssociationSearchPhase/);
  assert.match(provider, /cache_control: \{ type: "ephemeral" \}/);
});

test("Association provider rejects placeholder and degenerate content with a structural check", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /function isPlaceholderText\(/);
  assert.match(provider, /if \(!\/\\s\/\.test\(trimmed\)\) return true;/);
  assert.match(provider, /if \(words\.length < 4\) return true;/);
  assert.match(provider, /submit_module returned a placeholder\/degenerate record/);
});

test("Association provider blocks unsafe profiling, stereotypes, and strategy", async () => {
  const provider = await readFile(providerPath, "utf8");
  assert.match(provider, /Never infer or target race, ethnicity, nationality, religion, health, disability, sexuality, gender identity, political beliefs/i);
  assert.match(provider, /Do not use proxies for these traits/i);
  assert.match(provider, /Do not turn cultural, geographic, demographic, or identity stereotypes into buyer truths/i);
  assert.match(provider, /Weak symbolic or cultural hypotheses must be unknown, never asserted/i);
  assert.match(provider, /Do not recommend a brand position, message, visual identity, offer, content, campaign, channel, or targeting action/i);
});

test("Association tab renders the real one-button workspace", async () => {
  const [page, panel] = await Promise.all([readFile(pagePath, "utf8"), readFile(panelPath, "utf8")]);
  assert.match(page, /<AssociationOSPanel clientId=\{id\}/);
  assert.doesNotMatch(page, /Not started\. Association OS/);
  assert.match(panel, /Build Association OS/);
  assert.match(panel, /meanings and signals that make approved buyer roles trust, value, doubt, avoid, or reject/i);
  assert.match(panel, /positive.*negative.*changed/i);
  assert.match(panel, /Approve &amp; activate/);
  assert.match(panel, /Retry all failed/);
  assert.match(panel, /Retry module/);
});
