-- Ideation nav consolidation, Phase 6 (final): retire the Proposal stage
-- and the now-superseded manual-commit path.
--
-- Confirmed on the live project before writing this (2026-08-16): zero rows
-- in client_ideation_calendar_proposals, client_ideation_calendar_proposal_
-- slots, client_ideation_commit_runs, client_ideation_commit_items -- these
-- have never held real data. commit_manual_content shipped 2026-08-15 and
-- is superseded same-day by approve_content_source_to_master (previous
-- migration), which also handles its two origins (manual/proof_led) plus
-- the new ideation_candidate origin, without a separate calendar write.
--
-- Why the Proposal stage goes away entirely, not just its calendar write:
-- scheduling now happens exactly once, uniformly, for every origin, via
-- Distribute to Calendar (20260816120000) acting on Content Items. A
-- pre-commit calendar-assignment-and-approval step for AI candidates only
-- would be a second, competing scheduling mechanism for no remaining
-- purpose -- Ideation's job now ends at Score; Sources is the only
-- approval gate before a master row exists, exactly like manual/proof
-- entries.
--
-- Kept, deliberately: ideation_commit_target (still used by
-- approve_content_source_to_master), allocate_phase3_ref (Phase H8,
-- shared by many callers), client_ideation_cycles/technique_runs/
-- research_results/candidates/candidate_scores/scoring_runs (Run + Score
-- stages, unchanged).
--
-- Drop order: commit_items before commit_runs and before proposal_slots
-- (both FKs it holds); commit_runs before proposals; proposal_slots before
-- proposals.

drop table if exists public.client_ideation_commit_items cascade;
drop table if exists public.client_ideation_commit_runs cascade;
drop table if exists public.client_ideation_calendar_proposal_slots cascade;
drop table if exists public.client_ideation_calendar_proposals cascade;

drop function if exists public.commit_ideation_content(uuid, uuid, integer, uuid, text, jsonb, text, text, text, text, text, text, text);
drop function if exists public.record_ideation_commit_failure(uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text);
drop function if exists public.log_ideation_commit_replay(uuid, uuid, uuid);

drop function if exists public.recount_ideation_proposal(uuid);
drop function if exists public.begin_ideation_calendar_proposal(
  uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text,text,text,text,text,date,date,integer,integer,uuid,text,integer,uuid
);
drop function if exists public.renew_ideation_proposal_lease(uuid,text,integer);
drop function if exists public.persist_ideation_proposal_batch(uuid,text,jsonb);
drop function if exists public.complete_ideation_calendar_proposal(uuid,text,jsonb,uuid);
drop function if exists public.fail_ideation_calendar_proposal(uuid,text,text,text,boolean,jsonb,uuid);
drop function if exists public.edit_ideation_proposal_assignment(uuid,uuid,text,text,text,uuid,integer,uuid);
drop function if exists public.refresh_ideation_proposal_conflicts(uuid,uuid,jsonb,jsonb,text,integer,uuid);
drop function if exists public.approve_ideation_calendar_proposal(uuid,uuid,integer,text,uuid);

drop function if exists public.commit_manual_content(uuid, uuid, text, text, text, text, text, text, date, text, uuid);
