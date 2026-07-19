-- Gate F: context-update proposal intake and review only.
-- This migration does not edit context/master/strategy files, create patches,
-- run Phase 3, or mutate performance, analytics, distribution, or publishing data.

create table public.client_context_update_proposals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  iteration_candidate_id uuid references public.client_iteration_candidates(id) on delete set null,
  source_ref text,
  distribution_record_id uuid references public.client_distribution_records(id) on delete set null,
  proposal_type text not null check (proposal_type in ('context_file_update','master_context_update','positioning_update','offer_update','proof_angle_update','cta_update','distribution_update','content_rule_update','calendar_rule_update','other')),
  title text not null check (length(trim(title)) > 0),
  summary text not null check (length(trim(summary)) > 0),
  rationale text not null check (length(trim(rationale)) > 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  confidence text not null check (confidence in ('low','medium','high')),
  priority text not null check (priority in ('low','medium','high')),
  status text not null default 'needs_review' check (status in ('needs_review','approved','dismissed','converted_to_patch')),
  created_from text not null check (created_from in ('iteration_candidate','manual')),
  created_by text not null default 'operator' check (created_by in ('operator','system')),
  reviewer_notes text,
  reviewed_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_context_update_proposal_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  proposal_id uuid not null references public.client_context_update_proposals(id) on delete cascade,
  target_type text not null check (target_type in ('context_file','master_context','playbook','content_rule','distribution_rule','approval_rule','offer','positioning','other')),
  target_file_id uuid references public.client_context_files(id) on delete set null,
  target_file_name text,
  target_file_path text,
  target_section text,
  current_state_summary text,
  proposed_change_summary text not null check (length(trim(proposed_change_summary)) > 0),
  change_intent text not null check (change_intent in ('add','revise','remove','clarify','emphasize','de_emphasize')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.client_context_update_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  proposal_id uuid not null references public.client_context_update_proposals(id) on delete cascade,
  previous_status text check (previous_status is null or previous_status in ('needs_review','approved','dismissed','converted_to_patch')),
  new_status text not null check (new_status in ('needs_review','approved','dismissed','converted_to_patch')),
  review_note text,
  reviewed_by text not null default 'operator',
  created_at timestamptz not null default now()
);

create index client_context_update_proposals_client_idx on public.client_context_update_proposals(client_id,created_at desc);
create index client_context_update_proposals_source_idx on public.client_context_update_proposals(client_id,source_ref,created_at desc);
create index client_context_update_proposals_distribution_idx on public.client_context_update_proposals(distribution_record_id,created_at desc);
create index client_context_update_proposals_candidate_idx on public.client_context_update_proposals(iteration_candidate_id,created_at desc);
create index client_context_update_proposals_status_idx on public.client_context_update_proposals(client_id,status,priority,created_at desc);
create index client_context_update_proposal_items_proposal_idx on public.client_context_update_proposal_items(proposal_id,created_at);
create index client_context_update_proposal_items_client_idx on public.client_context_update_proposal_items(client_id,target_type,created_at desc);
create index client_context_update_proposal_items_file_idx on public.client_context_update_proposal_items(target_file_id,created_at desc) where target_file_id is not null;
create index client_context_update_reviews_proposal_idx on public.client_context_update_reviews(proposal_id,created_at desc);
create index client_context_update_reviews_client_idx on public.client_context_update_reviews(client_id,created_at desc);
create unique index client_context_update_proposals_active_unique
  on public.client_context_update_proposals(client_id,coalesce(iteration_candidate_id,'00000000-0000-0000-0000-000000000000'::uuid),proposal_type,lower(title))
  where status in ('needs_review','approved');

alter table public.client_context_update_proposals enable row level security;
alter table public.client_context_update_proposal_items enable row level security;
alter table public.client_context_update_reviews enable row level security;

revoke all on public.client_context_update_proposals,public.client_context_update_proposal_items,public.client_context_update_reviews from public,anon,authenticated;
grant select on public.client_context_update_proposals,public.client_context_update_proposal_items,public.client_context_update_reviews to authenticated;
grant select,insert,update,delete on public.client_context_update_proposals,public.client_context_update_proposal_items,public.client_context_update_reviews to service_role;

create policy client_context_update_proposals_staff_select on public.client_context_update_proposals for select to authenticated
  using (public.auth_role() in ('admin','account_manager','editor'));
create policy client_context_update_proposal_items_staff_select on public.client_context_update_proposal_items for select to authenticated
  using (public.auth_role() in ('admin','account_manager','editor'));
create policy client_context_update_reviews_staff_select on public.client_context_update_reviews for select to authenticated
  using (public.auth_role() in ('admin','account_manager','editor'));

create or replace function public.create_context_update_proposal(
  p_client_id uuid,
  p_iteration_candidate_id uuid,
  p_source_ref text,
  p_distribution_record_id uuid,
  p_proposal_type text,
  p_title text,
  p_summary text,
  p_rationale text,
  p_evidence jsonb,
  p_confidence text,
  p_priority text,
  p_created_from text,
  p_proposal_items jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_candidate public.client_iteration_candidates;
  v_distribution public.client_distribution_records;
  v_source text := nullif(trim(p_source_ref),'');
  v_distribution_id uuid := p_distribution_record_id;
  v_item jsonb;
  v_target_file_id uuid;
  v_target_file public.client_context_files;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then raise exception 'NOT_FOUND: client'; end if;
  if p_created_from not in ('iteration_candidate','manual') then raise exception 'VALIDATION: invalid created_from'; end if;
  if p_created_from = 'iteration_candidate' and p_iteration_candidate_id is null then raise exception 'VALIDATION: approved iteration candidate required'; end if;
  if p_created_from = 'manual' and p_iteration_candidate_id is not null then raise exception 'VALIDATION: manual proposal cannot link an iteration candidate'; end if;
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: evidence must be an object'; end if;
  if jsonb_typeof(coalesce(p_proposal_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_proposal_items,'[]'::jsonb)) = 0 then
    raise exception 'VALIDATION: at least one proposal item is required';
  end if;

  if p_iteration_candidate_id is not null then
    select * into v_candidate from public.client_iteration_candidates where id = p_iteration_candidate_id and client_id = p_client_id;
    if not found then raise exception 'VALIDATION: iteration candidate does not belong to client'; end if;
    if v_candidate.status <> 'approved' then raise exception 'VALIDATION: iteration candidate must be approved'; end if;
    if v_distribution_id is not null and v_candidate.distribution_record_id is distinct from v_distribution_id then raise exception 'VALIDATION: iteration candidate does not belong to distribution record'; end if;
    if v_source is not null and v_candidate.source_ref is distinct from v_source then raise exception 'VALIDATION: iteration candidate does not belong to source ref'; end if;
    v_distribution_id := coalesce(v_distribution_id,v_candidate.distribution_record_id);
    v_source := coalesce(v_source,v_candidate.source_ref);
  end if;

  if v_distribution_id is not null then
    select * into v_distribution from public.client_distribution_records where id = v_distribution_id and client_id = p_client_id;
    if not found then raise exception 'VALIDATION: distribution record does not belong to client'; end if;
    if v_source is not null and v_distribution.source_ref is distinct from v_source then raise exception 'VALIDATION: distribution record does not belong to source ref'; end if;
    v_source := coalesce(v_source,v_distribution.source_ref);
  end if;

  insert into public.client_context_update_proposals(
    client_id,iteration_candidate_id,source_ref,distribution_record_id,proposal_type,title,summary,rationale,evidence,
    confidence,priority,status,created_from,created_by
  ) values (
    p_client_id,p_iteration_candidate_id,v_source,v_distribution_id,p_proposal_type,trim(p_title),trim(p_summary),trim(p_rationale),coalesce(p_evidence,'{}'::jsonb),
    p_confidence,p_priority,'needs_review',p_created_from,case when auth.role()='service_role' then 'system' else 'operator' end
  ) returning id into v_id;

  for v_item in select value from jsonb_array_elements(p_proposal_items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'VALIDATION: proposal item must be an object'; end if;
    if jsonb_typeof(coalesce(v_item->'evidence','{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: proposal item evidence must be an object'; end if;
    v_target_file_id := nullif(trim(v_item->>'target_file_id'),'')::uuid;
    if v_target_file_id is not null then
      select * into v_target_file from public.client_context_files where id = v_target_file_id and client_id = p_client_id;
      if not found then raise exception 'VALIDATION: target context file does not belong to client'; end if;
    else
      v_target_file := null;
    end if;
    insert into public.client_context_update_proposal_items(
      client_id,proposal_id,target_type,target_file_id,target_file_name,target_file_path,target_section,current_state_summary,
      proposed_change_summary,change_intent,evidence
    ) values (
      p_client_id,v_id,v_item->>'target_type',v_target_file_id,
      coalesce(nullif(trim(v_item->>'target_file_name'),''),v_target_file.file_name),
      coalesce(nullif(trim(v_item->>'target_file_path'),''),v_target_file.storage_path),
      nullif(trim(v_item->>'target_section'),''),nullif(trim(v_item->>'current_state_summary'),''),
      trim(v_item->>'proposed_change_summary'),v_item->>'change_intent',coalesce(v_item->'evidence','{}'::jsonb)
    );
  end loop;

  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(p_client_id,'context_update_proposal_created','Context update proposal created'||case when v_source is null then '.' else ' for '||v_source||'.' end,
    'client_context_update_proposal',v_id,jsonb_build_object('source_ref',v_source,'proposal_type',p_proposal_type,'iteration_candidate_id',p_iteration_candidate_id));
  return v_id;
end $$;

create or replace function public.update_context_update_proposal_status(
  p_proposal_id uuid,
  p_new_status text,
  p_reviewer_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.client_context_update_proposals;
  v_event text;
  v_label text;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  select * into v_proposal from public.client_context_update_proposals where id = p_proposal_id for update;
  if not found then raise exception 'NOT_FOUND: context update proposal'; end if;
  if not (
    (v_proposal.status = 'needs_review' and p_new_status in ('approved','dismissed')) or
    (v_proposal.status = 'approved' and p_new_status in ('converted_to_patch','dismissed')) or
    (v_proposal.status = 'dismissed' and p_new_status = 'dismissed')
  ) then raise exception 'VALIDATION: invalid status transition'; end if;

  update public.client_context_update_proposals set
    status = p_new_status,
    reviewer_notes = nullif(trim(p_reviewer_notes),''),
    reviewed_at = now(),
    converted_at = case when p_new_status = 'converted_to_patch' then now() else converted_at end,
    updated_at = now()
  where id = v_proposal.id;

  insert into public.client_context_update_reviews(client_id,proposal_id,previous_status,new_status,review_note,reviewed_by)
  values(v_proposal.client_id,v_proposal.id,v_proposal.status,p_new_status,nullif(trim(p_reviewer_notes),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end);

  v_event := case p_new_status when 'approved' then 'context_update_proposal_approved' when 'dismissed' then 'context_update_proposal_dismissed' else 'context_update_proposal_converted_to_patch' end;
  v_label := case p_new_status when 'approved' then 'approved in principle' when 'dismissed' then 'dismissed' else 'marked ready for a later patch gate' end;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(v_proposal.client_id,v_event,'Context update proposal '||v_label||case when v_proposal.source_ref is null then '.' else ' for '||v_proposal.source_ref||'.' end,
    'client_context_update_proposal',v_proposal.id,jsonb_build_object('previous_status',v_proposal.status,'new_status',p_new_status));
end $$;

revoke all on function public.create_context_update_proposal(uuid,uuid,text,uuid,text,text,text,text,jsonb,text,text,text,jsonb) from public,anon;
revoke all on function public.update_context_update_proposal_status(uuid,text,text) from public,anon;
grant execute on function public.create_context_update_proposal(uuid,uuid,text,uuid,text,text,text,text,jsonb,text,text,text,jsonb),public.update_context_update_proposal_status(uuid,text,text) to authenticated,service_role;

comment on table public.client_context_update_proposals is 'Gate F review queue only. A proposal never edits context, master, strategy, content, calendar, asset, distribution, or publishing data.';
comment on table public.client_context_update_proposal_items is 'Target references and change summaries only; no replacement markdown or executable patch is stored.';
comment on table public.client_context_update_reviews is 'Append-only audit of context-update proposal review decisions.';
comment on function public.create_context_update_proposal(uuid,uuid,text,uuid,text,text,text,text,jsonb,text,text,text,jsonb) is 'Creates proposal metadata and target summaries atomically without applying any file change.';
comment on function public.update_context_update_proposal_status(uuid,text,text) is 'Records review state only; converted_to_patch remains a marker and does not create or apply a patch.';
