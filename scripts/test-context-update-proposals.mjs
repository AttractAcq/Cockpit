import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";

const helperSource=fs.readFileSync(new URL("../src/lib/context-update-proposals.ts",import.meta.url),"utf8");
const js=ts.transpileModule(helperSource,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const helper=await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const migration=fs.readFileSync(new URL("../supabase/migrations/20260719000025_gate_f_context_update_proposals.sql",import.meta.url),"utf8");
const api=fs.readFileSync(new URL("../src/lib/api.ts",import.meta.url),"utf8");
const ui=fs.readFileSync(new URL("../src/components/client/ContextUpdateProposalsSection.tsx",import.meta.url),"utf8");
const performance=fs.readFileSync(new URL("../src/components/client/PerformanceIterationPanel.tsx",import.meta.url),"utf8");
const contextFiles=fs.readFileSync(new URL("../src/components/client/ContextFilesPanel.tsx",import.meta.url),"utf8");
const archive=fs.readFileSync(new URL("../src/components/client/ArchivePanel.tsx",import.meta.url),"utf8");
const proposalScope=helperSource+migration+ui;

assert.equal(helper.validContextUpdateProposalTransition("needs_review","approved"),true);
assert.equal(helper.validContextUpdateProposalTransition("needs_review","dismissed"),true);
assert.equal(helper.validContextUpdateProposalTransition("approved","converted_to_patch"),true);
assert.equal(helper.validContextUpdateProposalTransition("approved","dismissed"),true);
assert.equal(helper.validContextUpdateProposalTransition("dismissed","dismissed"),true);
assert.equal(helper.validContextUpdateProposalTransition("dismissed","approved"),false);
assert.equal(helper.validContextUpdateProposalTransition("converted_to_patch","approved"),false);
assert.equal(helper.validContextUpdateProposalTransition("converted_to_patch","needs_review"),false);

const evidence=helper.contextProposalEvidenceFromCandidate({id:"candidate",candidate_type:"cta",recommendation:"Test a clearer CTA",rationale:"Evidence is early",evidence:{reach:1}});
assert.deepEqual(evidence,{iteration_candidate_id:"candidate",candidate_type:"cta",recommendation:"Test a clearer CTA",rationale:"Evidence is early",evidence:{reach:1}});

// Additive schema, item creation, proposal-only status, and review audit.
assert.match(migration,/create table public\.client_context_update_proposals/);
assert.match(migration,/create table public\.client_context_update_proposal_items/);
assert.match(migration,/create table public\.client_context_update_reviews/);
assert.match(migration,/insert into public\.client_context_update_proposal_items/);
assert.match(migration,/insert into public\.client_context_update_reviews/);
assert.match(migration,/status text not null default 'needs_review'/);
assert.match(migration,/converted_to_patch/);

// Candidate-backed creation requires an approved, same-client candidate and consistent source/distribution ownership.
assert.match(migration,/from public\.client_iteration_candidates where id = p_iteration_candidate_id and client_id = p_client_id/);
assert.match(migration,/iteration candidate must be approved/);
assert.match(migration,/iteration candidate does not belong to distribution record/);
assert.match(migration,/iteration candidate does not belong to source ref/);
assert.match(migration,/distribution record does not belong to client/);
assert.match(migration,/distribution record does not belong to source ref/);
assert.match(migration,/p_created_from = 'manual'/);

// Target context files are validated by client; proposals and items share the RPC-resolved client.
assert.match(migration,/from public\.client_context_files where id = v_target_file_id and client_id = p_client_id/);
assert.match(migration,/target context file does not belong to client/);
assert.match(migration,/p_client_id,v_id,v_item->>'target_type'/);
assert.match(migration,/jsonb_typeof\(coalesce\(p_proposal_items,'\[\]'::jsonb\)\) <> 'array'/);
assert.match(migration,/proposal item evidence must be an object/);

// Active duplicate prevention excludes dismissed/converted history.
assert.match(migration,/create unique index client_context_update_proposals_active_unique[\s\S]*where status in \('needs_review','approved'\)/);
assert.doesNotMatch(migration,/where status in \([^)]*dismissed|where status in \([^)]*converted_to_patch/);

// RLS and RPC-only writes.
assert.match(migration,/enable row level security/g);
assert.match(migration,/revoke all on public\.client_context_update_proposals,public\.client_context_update_proposal_items,public\.client_context_update_reviews from public,anon,authenticated/);
assert.match(migration,/grant select on public\.client_context_update_proposals,public\.client_context_update_proposal_items,public\.client_context_update_reviews to authenticated/);
assert.match(migration,/security definer set search_path = ''/g);
assert.match(migration,/AUTH: staff role required/g);
assert.match(api,/rpc\("create_context_update_proposal"/);
assert.match(api,/rpc\("update_context_update_proposal_status"/);
assert.doesNotMatch(api,/from\("client_context_update_(?:proposals|proposal_items|reviews)"\)\.(?:insert|update|delete)/);

// Activity events are save/review only.
assert.match(migration,/context_update_proposal_created/);
assert.match(migration,/context_update_proposal_approved/);
assert.match(migration,/context_update_proposal_dismissed/);
assert.match(migration,/context_update_proposal_converted_to_patch/);

// UI boundary, approved-candidate gate, manual path, items, queues, and read-only integrations.
assert.match(performance,/ContextUpdateProposalsSection/);
assert.match(ui,/This is a proposal only/);
assert.match(ui,/Approving a proposal does not edit context files/);
assert.match(ui,/Context file patching happens in a later reviewed gate/);
assert.match(ui,/Phase 3 will not read this proposal until a later approved patch is applied/);
assert.match(ui,/Approve the candidate before creating a context update proposal/);
assert.match(ui,/candidate\.status==="approved"/);
assert.match(ui,/Manual proposal/);
assert.match(ui,/Create proposal only/);
assert.match(ui,/Proposal Review Queue/);
assert.match(ui,/Mark converted to patch/);
assert.match(contextFiles,/open context update proposal/);
assert.match(contextFiles,/no context file is edited from this indicator/);
assert.match(archive,/Proposal only — no context file edited/);
assert.match(archive,/contextUpdateProposals/);

// Gate F never changes source data or implements downstream execution.
assert.doesNotMatch(migration,/update public\.(?:client_context_files|client_inputs|client_execution_files|client_distribution_records|client_metric_snapshots|client_business_signal_snapshots|client_performance_scores|client_performance_insights|client_iteration_candidates)/i);
assert.doesNotMatch(proposalScope,/openai|anthropic|launch[_ ]ads|media_publish|generate[_ ](?:content|asset)|runPhase3|updateContextFileContent|updateMaster|content_md\s*=|applyPatch/i);
assert.match(migration,/no replacement markdown or executable patch is stored/i);

console.log("context-update-proposals tests passed");
