-- Gate G: reviewed, stale-safe context patch drafts and immutable application audit.
-- This migration installs the workflow only. It does not create or apply a patch.

create table public.client_context_patch_drafts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  context_update_proposal_id uuid not null references public.client_context_update_proposals(id) on delete restrict,
  proposal_item_id uuid references public.client_context_update_proposal_items(id) on delete restrict,
  target_file_id uuid not null references public.client_context_files(id) on delete restrict,
  target_file_name text,
  target_file_path text,
  target_section text,
  patch_type text not null check (patch_type in ('add','revise','remove','clarify','emphasize','de_emphasize','replace_section','other')),
  title text not null check (length(trim(title)) > 0),
  summary text not null check (length(trim(summary)) > 0),
  rationale text not null check (length(trim(rationale)) > 0),
  current_state_summary text,
  proposed_change_summary text not null check (length(trim(proposed_change_summary)) > 0),
  base_file_version integer not null check (base_file_version > 0),
  base_content_hash text not null check (length(base_content_hash) = 32),
  proposed_content text,
  proposed_diff text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  confidence text not null check (confidence in ('low','medium','high')),
  priority text not null check (priority in ('low','medium','high')),
  status text not null default 'draft' check (status in ('draft','needs_review','approved','dismissed','applied','superseded')),
  created_from text not null check (created_from in ('context_update_proposal','manual')),
  created_by text not null default 'operator' check (created_by in ('operator','system')),
  reviewer_notes text,
  reviewed_at timestamptz,
  applied_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (proposed_content is null or length(trim(proposed_content)) > 0),
  check (proposed_diff is null or length(trim(proposed_diff)) > 0)
);

create table public.client_context_patch_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  patch_draft_id uuid not null references public.client_context_patch_drafts(id) on delete cascade,
  previous_status text,
  new_status text not null,
  review_note text,
  reviewed_by text not null default 'operator',
  created_at timestamptz not null default now(),
  check (previous_status is null or previous_status in ('draft','needs_review','approved','dismissed','applied','superseded')),
  check (new_status in ('draft','needs_review','approved','dismissed','applied','superseded'))
);

create table public.client_context_patch_applications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  patch_draft_id uuid not null unique references public.client_context_patch_drafts(id) on delete restrict,
  target_file_id uuid not null references public.client_context_files(id) on delete restrict,
  previous_version integer not null check (previous_version > 0),
  new_version integer not null check (new_version = previous_version + 1),
  previous_content_hash text not null check (length(previous_content_hash) = 32),
  new_content_hash text not null check (length(new_content_hash) = 32),
  previous_content_snapshot text,
  applied_content_snapshot text not null,
  applied_by text not null default 'operator',
  applied_at timestamptz not null default now()
);

create index client_context_patch_drafts_client_idx on public.client_context_patch_drafts(client_id,created_at desc);
create index client_context_patch_drafts_proposal_idx on public.client_context_patch_drafts(context_update_proposal_id,created_at desc);
create index client_context_patch_drafts_item_idx on public.client_context_patch_drafts(proposal_item_id) where proposal_item_id is not null;
create index client_context_patch_drafts_file_idx on public.client_context_patch_drafts(target_file_id,status,created_at desc);
create index client_context_patch_drafts_status_idx on public.client_context_patch_drafts(client_id,status,updated_at desc);
create unique index client_context_patch_drafts_active_unique
  on public.client_context_patch_drafts(client_id,context_update_proposal_id,target_file_id,patch_type,lower(title))
  where status in ('draft','needs_review','approved');
create index client_context_patch_reviews_patch_idx on public.client_context_patch_reviews(patch_draft_id,created_at desc);
create index client_context_patch_reviews_client_idx on public.client_context_patch_reviews(client_id,created_at desc);
create index client_context_patch_applications_client_idx on public.client_context_patch_applications(client_id,applied_at desc);
create index client_context_patch_applications_file_idx on public.client_context_patch_applications(target_file_id,applied_at desc);

alter table public.client_context_patch_drafts enable row level security;
alter table public.client_context_patch_reviews enable row level security;
alter table public.client_context_patch_applications enable row level security;

create policy client_context_patch_drafts_staff_select on public.client_context_patch_drafts for select to authenticated
  using (coalesce(public.auth_role(),'') in ('admin','account_manager','editor'));
create policy client_context_patch_reviews_staff_select on public.client_context_patch_reviews for select to authenticated
  using (coalesce(public.auth_role(),'') in ('admin','account_manager','editor'));
create policy client_context_patch_applications_staff_select on public.client_context_patch_applications for select to authenticated
  using (coalesce(public.auth_role(),'') in ('admin','account_manager','editor'));

revoke all on public.client_context_patch_drafts,public.client_context_patch_reviews,public.client_context_patch_applications from public,anon,authenticated;
grant select on public.client_context_patch_drafts,public.client_context_patch_reviews,public.client_context_patch_applications to authenticated;
grant all on public.client_context_patch_drafts,public.client_context_patch_reviews,public.client_context_patch_applications to service_role;

create or replace function public.create_context_patch_draft(
  p_client_id uuid,
  p_context_update_proposal_id uuid,
  p_proposal_item_id uuid,
  p_target_file_id uuid,
  p_target_section text,
  p_patch_type text,
  p_title text,
  p_summary text,
  p_rationale text,
  p_current_state_summary text,
  p_proposed_change_summary text,
  p_proposed_content text,
  p_proposed_diff text,
  p_evidence jsonb,
  p_confidence text,
  p_priority text,
  p_created_from text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_proposal public.client_context_update_proposals;
  v_item public.client_context_update_proposal_items;
  v_file public.client_context_files;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  if p_created_from not in ('context_update_proposal','manual') then raise exception 'VALIDATION: invalid created_from'; end if;
  if jsonb_typeof(coalesce(p_evidence,'{}'::jsonb)) <> 'object' then raise exception 'VALIDATION: evidence must be an object'; end if;

  select * into v_proposal from public.client_context_update_proposals
    where id=p_context_update_proposal_id and client_id=p_client_id;
  if not found then raise exception 'VALIDATION: context update proposal does not belong to client'; end if;
  if v_proposal.status <> 'approved' then raise exception 'VALIDATION: context update proposal must be approved'; end if;

  if p_proposal_item_id is not null then
    select * into v_item from public.client_context_update_proposal_items
      where id=p_proposal_item_id and proposal_id=v_proposal.id and client_id=p_client_id;
    if not found then raise exception 'VALIDATION: proposal item does not belong to proposal'; end if;
    if v_item.target_file_id is not null and v_item.target_file_id <> p_target_file_id then
      raise exception 'VALIDATION: proposal item does not belong to target context file';
    end if;
  end if;

  select * into v_file from public.client_context_files where id=p_target_file_id and client_id=p_client_id for share;
  if not found then raise exception 'VALIDATION: target context file does not belong to client'; end if;

  insert into public.client_context_patch_drafts(
    client_id,context_update_proposal_id,proposal_item_id,target_file_id,target_file_name,target_file_path,target_section,
    patch_type,title,summary,rationale,current_state_summary,proposed_change_summary,base_file_version,base_content_hash,
    proposed_content,proposed_diff,evidence,confidence,priority,status,created_from,created_by
  ) values (
    p_client_id,v_proposal.id,p_proposal_item_id,v_file.id,v_file.file_name,v_file.storage_path,nullif(trim(p_target_section),''),
    p_patch_type,trim(p_title),trim(p_summary),trim(p_rationale),nullif(trim(p_current_state_summary),''),trim(p_proposed_change_summary),
    v_file.version,md5(coalesce(v_file.content_md,'')),nullif(p_proposed_content,''),nullif(p_proposed_diff,''),coalesce(p_evidence,'{}'::jsonb),
    p_confidence,p_priority,'draft',p_created_from,case when auth.role()='service_role' then 'system' else 'operator' end
  ) returning id into v_id;

  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(p_client_id,'context_patch_draft_created','Context patch draft created for '||v_file.file_name||'.','client_context_patch_draft',v_id,
    jsonb_build_object('proposal_id',v_proposal.id,'proposal_item_id',p_proposal_item_id,'target_file_id',v_file.id,'base_file_version',v_file.version));
  return v_id;
end $$;

create or replace function public.update_context_patch_draft_status(
  p_patch_draft_id uuid,
  p_new_status text,
  p_reviewer_notes text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_patch public.client_context_patch_drafts;
  v_event text;
  v_label text;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  select * into v_patch from public.client_context_patch_drafts where id=p_patch_draft_id for update;
  if not found then raise exception 'NOT_FOUND: context patch draft'; end if;
  if not (
    (v_patch.status='draft' and p_new_status in ('needs_review','dismissed')) or
    (v_patch.status='needs_review' and p_new_status in ('approved','dismissed')) or
    (v_patch.status='approved' and p_new_status='dismissed') or
    (v_patch.status='dismissed' and p_new_status='dismissed')
  ) then raise exception 'VALIDATION: invalid patch status transition'; end if;
  if p_new_status in ('needs_review','approved') and nullif(trim(coalesce(v_patch.proposed_content,'')),'') is null
     and nullif(trim(coalesce(v_patch.proposed_diff,'')),'') is null then
    raise exception 'VALIDATION: proposed content or diff required before review';
  end if;

  update public.client_context_patch_drafts set status=p_new_status,reviewer_notes=nullif(trim(p_reviewer_notes),''),
    reviewed_at=now(),updated_at=now() where id=v_patch.id;
  insert into public.client_context_patch_reviews(client_id,patch_draft_id,previous_status,new_status,review_note,reviewed_by)
  values(v_patch.client_id,v_patch.id,v_patch.status,p_new_status,nullif(trim(p_reviewer_notes),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end);
  v_event:=case p_new_status when 'needs_review' then 'context_patch_draft_submitted' when 'approved' then 'context_patch_draft_approved' else 'context_patch_draft_dismissed' end;
  v_label:=case p_new_status when 'needs_review' then 'submitted for review' when 'approved' then 'approved' else 'dismissed' end;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(v_patch.client_id,v_event,'Context patch draft '||v_label||' for '||coalesce(v_patch.target_file_name,'context file')||'.','client_context_patch_draft',v_patch.id,
    jsonb_build_object('previous_status',v_patch.status,'new_status',p_new_status,'target_file_id',v_patch.target_file_id));
end $$;

create or replace function public.apply_context_patch_draft(
  p_patch_draft_id uuid,
  p_final_content text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_patch public.client_context_patch_drafts;
  v_file public.client_context_files;
  v_content text;
  v_current_hash text;
  v_new_hash text;
  v_application_id uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then
    raise exception 'AUTH: staff role required';
  end if;
  select * into v_patch from public.client_context_patch_drafts where id=p_patch_draft_id for update;
  if not found then raise exception 'NOT_FOUND: context patch draft'; end if;
  if v_patch.status <> 'approved' then raise exception 'VALIDATION: only approved patches can be applied'; end if;
  if exists(select 1 from public.client_context_patch_applications where patch_draft_id=v_patch.id) then raise exception 'VALIDATION: patch already applied'; end if;

  select * into v_file from public.client_context_files where id=v_patch.target_file_id and client_id=v_patch.client_id for update;
  if not found then raise exception 'VALIDATION: target context file does not belong to client'; end if;
  v_current_hash:=md5(coalesce(v_file.content_md,''));
  if v_file.version <> v_patch.base_file_version or v_current_hash <> v_patch.base_content_hash then
    raise exception 'STALE: target context file version or content changed';
  end if;
  v_content:=coalesce(nullif(p_final_content,''),nullif(v_patch.proposed_content,''));
  if nullif(trim(coalesce(v_content,'')),'') is null then raise exception 'VALIDATION: final content is required to apply patch'; end if;
  v_new_hash:=md5(v_content);

  update public.client_context_files set content_md=v_content,version=v_file.version+1,updated_at=now() where id=v_file.id;
  insert into public.client_context_patch_applications(client_id,patch_draft_id,target_file_id,previous_version,new_version,
    previous_content_hash,new_content_hash,previous_content_snapshot,applied_content_snapshot,applied_by)
  values(v_patch.client_id,v_patch.id,v_file.id,v_file.version,v_file.version+1,v_current_hash,v_new_hash,v_file.content_md,v_content,
    case when auth.role()='service_role' then 'system' else auth.uid()::text end) returning id into v_application_id;
  update public.client_context_patch_drafts set status='applied',applied_at=now(),updated_at=now() where id=v_patch.id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata)
  values(v_patch.client_id,'context_patch_applied','Context patch applied to '||coalesce(v_patch.target_file_name,v_file.file_name)||'; Phase 3 was not run.',
    'client_context_patch_draft',v_patch.id,jsonb_build_object('application_id',v_application_id,'target_file_id',v_file.id,'previous_version',v_file.version,'new_version',v_file.version+1));
  return v_application_id;
end $$;

revoke all on function public.create_context_patch_draft(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb,text,text,text) from public,anon;
revoke all on function public.update_context_patch_draft_status(uuid,text,text) from public,anon;
revoke all on function public.apply_context_patch_draft(uuid,text) from public,anon;
grant execute on function public.create_context_patch_draft(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb,text,text,text),
  public.update_context_patch_draft_status(uuid,text,text),public.apply_context_patch_draft(uuid,text) to authenticated,service_role;

comment on table public.client_context_patch_drafts is 'Reviewed patch drafts with optimistic base version/hash guards; rows do not affect Phase 3 until explicitly applied.';
comment on table public.client_context_patch_reviews is 'Append-only audit of context patch review decisions.';
comment on table public.client_context_patch_applications is 'Immutable before/after audit of applied context file versions.';
comment on function public.create_context_patch_draft(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,jsonb,text,text,text) is 'Creates a draft and captures current context file version/hash without editing the file.';
comment on function public.apply_context_patch_draft(uuid,text) is 'Applies one approved non-stale patch atomically, increments one context file version, and never runs Phase 3.';
