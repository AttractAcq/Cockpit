-- Stage 2, Phase 11 — Opportunity OS.
--
-- Built ahead of its own stated prerequisite, on Alex's explicit override:
-- the phase's own step 1 says "Confirm Finance (08) and Sales (06) each
-- have multiple real reconciled cycles behind them -- don't start early,"
-- and neither has cleared even its own single-cycle exit gate yet as of
-- this migration. The detection logic below is real and deterministic
-- (plain SQL over real tables, not fabricated), but run today it will
-- necessarily find little or nothing, because the Finance/Sales history
-- it reads is genuinely still sparse -- that is the correct, honest
-- behaviour, not a bug to paper over. The exit gate itself ("a full
-- quarter minimum" of confirmed-trustworthy review) is NOT being claimed
-- met by this migration.
--
-- Named opportunity_os_findings, not "opportunities" -- content_opportunities
-- and ad_opportunities already use that bare word for a different concept
-- (a piece of content/ad worth producing), not a cross-functional business
-- insight. Avoiding a repeat of the exact naming collision Phase 05's
-- dependency trace caught for Campaigns.
--
-- One new table, two RPCs, zero new edge functions -- Detect/Score/Explain
-- here is deterministic SQL over existing real tables (client_finance_periods,
-- client_cost_ledger, sales_leads, sales_conversations, client_performance_scores),
-- not an external AI call, so a plpgsql RPC is the right shape, not a
-- fabricated "AI insight." Deferred, per the phase's own text: any
-- automatic downstream action from a finding. Every finding is
-- human-reviewed only; nothing here triggers anything.

create table public.opportunity_os_findings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  finding_type text not null,
  title text not null,
  explanation text not null,
  score numeric(5,2) not null,
  source_refs jsonb not null default '[]'::jsonb,
  status text not null default 'pending_review',
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  generated_at timestamptz not null default now(),
  constraint opportunity_os_findings_type_check check (finding_type in ('margin_risk', 'stalled_lead', 'underperforming_channel')),
  constraint opportunity_os_findings_status_check check (status in ('pending_review', 'confirmed_useful', 'dismissed')),
  constraint opportunity_os_findings_score_check check (score >= 0 and score <= 100),
  constraint opportunity_os_findings_title_check check (length(trim(title)) > 0),
  constraint opportunity_os_findings_reviewed_check check ((status = 'pending_review') or (reviewed_by is not null and reviewed_at is not null))
);

create index opportunity_os_findings_client_idx on public.opportunity_os_findings (client_id, status, score desc);

alter table public.opportunity_os_findings enable row level security;
revoke all on public.opportunity_os_findings from public, anon, authenticated;
grant select on public.opportunity_os_findings to authenticated;
grant all on public.opportunity_os_findings to service_role;

create policy opportunity_os_findings_select on public.opportunity_os_findings
  for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.opportunity_os_findings is 'Stage 2 Phase 11: a human-reviewed Detect/Score/Explain finding, deterministically computed from real Finance/Sales/Marketing tables (source_refs cites exact source rows -- never a black box). No auto-action reads this table; review is manual only. Built ahead of the phase''s own stated prerequisite (multiple real reconciled Finance/Sales cycles) on explicit override -- findings will be sparse until that real history exists.';

-- Detect + Score + Explain, deterministic, cites its own sources.
-- Three finding types, each a plain, auditable SQL rule:
--   margin_risk: a reconciled finance period with margin < 10% of revenue.
--   stalled_lead: an open (non-closed) sales lead with no logged conversation in 14+ days.
--   underperforming_channel: a client_performance_scores row scoring in the bottom
--     quartile of that client's own recent scores (a real, already-populated table).
create or replace function public.run_opportunity_detection(p_client_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer := 0; v_row record;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then raise exception 'NOT_FOUND: client'; end if;

  -- margin_risk: reconciled periods with thin margin, not already reported.
  -- Every reference below is alias-qualified deliberately -- the EXISTS
  -- subquery's own table (opportunity_os_findings) has its own `id` column,
  -- so an unqualified `id` here would silently shadow to the wrong row
  -- (found live: it broke idempotency on the underperforming_channel branch
  -- before this fix, and would have broken all three).
  for v_row in
    select cfp.id, cfp.period_start, cfp.period_end, cfp.actual_revenue, cfp.margin
    from public.client_finance_periods cfp
    where cfp.client_id = p_client_id and cfp.status = 'reconciled' and cfp.actual_revenue > 0
      and (cfp.margin / cfp.actual_revenue) < 0.10
      and not exists (
        select 1 from public.opportunity_os_findings f
        where f.client_id = p_client_id and f.finding_type = 'margin_risk'
          and f.source_refs @> jsonb_build_array(jsonb_build_object('table','client_finance_periods','id',cfp.id::text))
      )
  loop
    insert into public.opportunity_os_findings (client_id, finding_type, title, explanation, score, source_refs)
    values (
      p_client_id, 'margin_risk',
      'Thin margin: ' || v_row.period_start || ' to ' || v_row.period_end,
      'Reconciled period ' || v_row.period_start || '–' || v_row.period_end || ' closed at ' ||
        round((v_row.margin / v_row.actual_revenue) * 100, 1) || '% margin (revenue ' || v_row.actual_revenue || ', margin ' || v_row.margin || '), below the 10% threshold.',
      least(100, greatest(0, 100 - (v_row.margin / v_row.actual_revenue) * 1000)),
      jsonb_build_array(jsonb_build_object('table','client_finance_periods','id',v_row.id::text))
    );
    v_count := v_count + 1;
  end loop;

  -- stalled_lead: open leads with no conversation in 14+ days (or none ever, 14+ days after creation).
  for v_row in
    select l.id, l.name, l.stage, l.created_at,
      coalesce((select max(occurred_at) from public.sales_conversations c where c.lead_id = l.id), l.created_at) as last_activity
    from public.sales_leads l
    join public.businesses b on b.id = l.business_id
    where b.client_id = p_client_id and l.stage not in ('closed_won','closed_lost')
      and not exists (
        select 1 from public.opportunity_os_findings f
        where f.client_id = p_client_id and f.finding_type = 'stalled_lead'
          and f.source_refs @> jsonb_build_array(jsonb_build_object('table','sales_leads','id', l.id::text))
      )
  loop
    if v_row.last_activity < now() - interval '14 days' then
      insert into public.opportunity_os_findings (client_id, finding_type, title, explanation, score, source_refs)
      values (
        p_client_id, 'stalled_lead',
        'Stalled lead: ' || v_row.name,
        'Lead "' || v_row.name || '" (stage: ' || v_row.stage || ') has had no logged conversation since ' || v_row.last_activity || ', ' ||
          extract(day from now() - v_row.last_activity)::int || ' days ago.',
        least(100, extract(day from now() - v_row.last_activity)::numeric),
        jsonb_build_array(jsonb_build_object('table','sales_leads','id',v_row.id::text))
      );
      v_count := v_count + 1;
    end if;
  end loop;

  -- underperforming_channel: a performance score in the bottom quartile of this client's own recent scores.
  for v_row in
    select ps.id, ps.source_ref, ps.overall_score
    from public.client_performance_scores ps
    where ps.client_id = p_client_id and ps.score_status = 'scored' and ps.overall_score is not null
      and ps.overall_score < (
        select percentile_cont(0.25) within group (order by overall_score)
        from public.client_performance_scores where client_id = p_client_id and score_status = 'scored' and overall_score is not null
      )
      and not exists (
        select 1 from public.opportunity_os_findings f
        where f.client_id = p_client_id and f.finding_type = 'underperforming_channel'
          and f.source_refs @> jsonb_build_array(jsonb_build_object('table','client_performance_scores','id',ps.id::text))
      )
  loop
    insert into public.opportunity_os_findings (client_id, finding_type, title, explanation, score, source_refs)
    values (
      p_client_id, 'underperforming_channel',
      'Underperforming: ' || v_row.source_ref,
      v_row.source_ref || ' scored ' || v_row.overall_score || ', in the bottom quartile of this client''s own recent performance scores.',
      least(100, greatest(0, 100 - v_row.overall_score)),
      jsonb_build_array(jsonb_build_object('table','client_performance_scores','id',v_row.id::text))
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end; $$;

create or replace function public.review_opportunity_finding(p_finding_id uuid, p_status text, p_notes text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.opportunity_os_findings;
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') not in ('admin','account_manager','strategist','content_operator','editor','media_buyer','analyst') then
    raise exception 'AUTH: staff role required';
  end if;
  if p_status not in ('confirmed_useful','dismissed') then raise exception 'VALIDATION: status must be confirmed_useful or dismissed'; end if;

  select * into v_row from public.opportunity_os_findings where id = p_finding_id for update;
  if not found then raise exception 'NOT_FOUND: finding'; end if;

  update public.opportunity_os_findings set status = p_status, reviewed_by = auth.uid(), reviewed_at = now(), review_notes = nullif(trim(coalesce(p_notes,'')),'') where id = p_finding_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_row.client_id, auth.uid(), 'opportunity_finding_reviewed', 'Opportunity finding "' || v_row.title || '" marked ' || p_status || '.', 'opportunity_os_finding', v_row.id, jsonb_build_object('finding_type', v_row.finding_type, 'status', p_status));
end; $$;

revoke all on function public.run_opportunity_detection(uuid) from public, anon;
revoke all on function public.review_opportunity_finding(uuid,text,text) from public, anon;
grant execute on function public.run_opportunity_detection(uuid) to authenticated, service_role;
grant execute on function public.review_opportunity_finding(uuid,text,text) to authenticated, service_role;

comment on function public.run_opportunity_detection(uuid) is 'Staff-only. Deterministic Detect+Score+Explain over real client_finance_periods/sales_leads/client_performance_scores rows. Returns the count of new findings inserted (already-reported source rows are skipped, not re-inserted).';
comment on function public.review_opportunity_finding(uuid,text,text) is 'Staff-only. Human review is the only thing that can close a finding out -- nothing here auto-acts.';
