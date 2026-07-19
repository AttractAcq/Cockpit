-- Gate E: reviewed iteration intake only. No downstream strategy, content, asset,
-- calendar, distribution, metric, business-signal, or publication mutation.

create table public.client_iteration_candidates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  source_ref text,
  distribution_record_id uuid references public.client_distribution_records(id) on delete cascade,
  performance_score_id uuid references public.client_performance_scores(id) on delete set null,
  performance_insight_id uuid references public.client_performance_insights(id) on delete set null,
  candidate_type text not null check (candidate_type in ('hook','proof_angle','cta','format','story_sequence','content_angle','offer','audience','distribution','asset','calendar','other')),
  recommendation text not null check (length(trim(recommendation)) > 0),
  rationale text not null check (length(trim(rationale)) > 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  confidence text not null check (confidence in ('low','medium','high')),
  priority text not null check (priority in ('low','medium','high')),
  status text not null default 'needs_review' check (status in ('needs_review','approved','dismissed','converted')),
  created_by text not null default 'operator' check (created_by in ('operator','system')),
  created_from text not null check (created_from in ('performance_score','performance_insight','manual')),
  reviewer_notes text, reviewed_at timestamptz, converted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table public.client_iteration_reviews (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  iteration_candidate_id uuid not null references public.client_iteration_candidates(id) on delete cascade,
  previous_status text check (previous_status is null or previous_status in ('needs_review','approved','dismissed','converted')),
  new_status text not null check (new_status in ('needs_review','approved','dismissed','converted')),
  review_note text, reviewed_by text not null default 'operator', created_at timestamptz not null default now()
);

create index client_iteration_candidates_client_idx on public.client_iteration_candidates(client_id,created_at desc);
create index client_iteration_candidates_source_idx on public.client_iteration_candidates(client_id,source_ref,created_at desc);
create index client_iteration_candidates_distribution_idx on public.client_iteration_candidates(distribution_record_id,created_at desc);
create index client_iteration_candidates_status_idx on public.client_iteration_candidates(client_id,status,priority,created_at desc);
create index client_iteration_reviews_candidate_idx on public.client_iteration_reviews(iteration_candidate_id,created_at desc);
create index client_iteration_reviews_client_idx on public.client_iteration_reviews(client_id,created_at desc);
create unique index client_iteration_candidates_open_unique on public.client_iteration_candidates(client_id,coalesce(source_ref,''),candidate_type,lower(recommendation)) where status in ('needs_review','approved');

alter table public.client_iteration_candidates enable row level security;
alter table public.client_iteration_reviews enable row level security;
revoke all on public.client_iteration_candidates,public.client_iteration_reviews from public,anon,authenticated;
grant select on public.client_iteration_candidates,public.client_iteration_reviews to authenticated;
grant select,insert,update,delete on public.client_iteration_candidates,public.client_iteration_reviews to service_role;
create policy client_iteration_candidates_staff_select on public.client_iteration_candidates for select to authenticated using (public.auth_role() in ('admin','account_manager','editor'));
create policy client_iteration_reviews_staff_select on public.client_iteration_reviews for select to authenticated using (public.auth_role() in ('admin','account_manager','editor'));

create or replace function public.create_iteration_candidate(
  p_client_id uuid,p_source_ref text,p_distribution_record_id uuid,p_performance_score_id uuid,p_performance_insight_id uuid,
  p_candidate_type text,p_recommendation text,p_rationale text,p_evidence jsonb,p_confidence text,p_priority text,p_created_from text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; d public.client_distribution_records; s public.client_performance_scores; i public.client_performance_insights; v_source text:=nullif(trim(p_source_ref),''); v_distribution uuid:=p_distribution_record_id;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  if not exists(select 1 from public.clients where id=p_client_id) then raise exception 'NOT_FOUND: client'; end if;
  if p_created_from='performance_score' and p_performance_score_id is null then raise exception 'VALIDATION: performance score required'; end if;
  if p_created_from='performance_insight' and p_performance_insight_id is null then raise exception 'VALIDATION: performance insight required'; end if;
  if v_distribution is not null then select * into d from public.client_distribution_records where id=v_distribution and client_id=p_client_id; if not found then raise exception 'VALIDATION: distribution record does not belong to client'; end if; v_source:=coalesce(v_source,d.source_ref); end if;
  if p_performance_score_id is not null then
    select * into s from public.client_performance_scores where id=p_performance_score_id and client_id=p_client_id; if not found then raise exception 'VALIDATION: performance score does not belong to client'; end if;
    if v_distribution is not null and s.distribution_record_id<>v_distribution then raise exception 'VALIDATION: performance score does not belong to distribution record'; end if;
    if v_source is not null and s.source_ref<>v_source then raise exception 'VALIDATION: performance score does not belong to source ref'; end if;
    v_distribution:=coalesce(v_distribution,s.distribution_record_id); v_source:=coalesce(v_source,s.source_ref);
  end if;
  if p_performance_insight_id is not null then
    select * into i from public.client_performance_insights where id=p_performance_insight_id and client_id=p_client_id; if not found then raise exception 'VALIDATION: performance insight does not belong to client'; end if;
    if v_distribution is not null and i.distribution_record_id is distinct from v_distribution then raise exception 'VALIDATION: performance insight does not belong to distribution record'; end if;
    if v_source is not null and i.source_ref is distinct from v_source then raise exception 'VALIDATION: performance insight does not belong to source ref'; end if;
    v_distribution:=coalesce(v_distribution,i.distribution_record_id); v_source:=coalesce(v_source,i.source_ref);
  end if;
  insert into public.client_iteration_candidates(client_id,source_ref,distribution_record_id,performance_score_id,performance_insight_id,candidate_type,recommendation,rationale,evidence,confidence,priority,created_by,created_from)
  values(p_client_id,v_source,v_distribution,p_performance_score_id,p_performance_insight_id,p_candidate_type,trim(p_recommendation),trim(p_rationale),coalesce(p_evidence,'{}'::jsonb),p_confidence,p_priority,case when auth.role()='service_role' then 'system' else 'operator' end,p_created_from)
  returning id into v_id;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(p_client_id,'iteration_candidate_created','Iteration candidate created'||case when v_source is null then '.' else ' for '||v_source||'.' end,'client_iteration_candidate',v_id,jsonb_build_object('source_ref',v_source,'candidate_type',p_candidate_type));
  return v_id;
end $$;

create or replace function public.update_iteration_candidate_status(p_candidate_id uuid,p_new_status text,p_reviewer_notes text) returns void language plpgsql security definer set search_path='' as $$
declare c public.client_iteration_candidates; v_event text; v_label text;
begin
  if auth.role()<>'service_role' and (auth.uid() is null or coalesce(public.auth_role(),'') not in ('admin','account_manager','editor')) then raise exception 'AUTH: staff role required'; end if;
  select * into c from public.client_iteration_candidates where id=p_candidate_id for update; if not found then raise exception 'NOT_FOUND: iteration candidate'; end if;
  if not ((c.status='needs_review' and p_new_status in ('approved','dismissed')) or (c.status='approved' and p_new_status in ('converted','dismissed')) or (c.status='dismissed' and p_new_status='dismissed')) then raise exception 'VALIDATION: invalid status transition'; end if;
  update public.client_iteration_candidates set status=p_new_status,reviewer_notes=nullif(trim(p_reviewer_notes),''),reviewed_at=now(),converted_at=case when p_new_status='converted' then now() else converted_at end,updated_at=now() where id=c.id;
  insert into public.client_iteration_reviews(client_id,iteration_candidate_id,previous_status,new_status,review_note,reviewed_by) values(c.client_id,c.id,c.status,p_new_status,nullif(trim(p_reviewer_notes),''),case when auth.role()='service_role' then 'system' else auth.uid()::text end);
  v_event:=case p_new_status when 'approved' then 'iteration_candidate_approved' when 'dismissed' then 'iteration_candidate_dismissed' else 'iteration_candidate_converted' end;
  v_label:=case p_new_status when 'approved' then 'approved' when 'dismissed' then 'dismissed' else 'marked converted for future workflow' end;
  insert into public.activity_log(client_id,event_type,plain_english_message,object_type,object_id,metadata) values(c.client_id,v_event,'Iteration candidate '||v_label||case when c.source_ref is null then '.' else ' for '||c.source_ref||'.' end,'client_iteration_candidate',c.id,jsonb_build_object('previous_status',c.status,'new_status',p_new_status));
end $$;

revoke all on function public.create_iteration_candidate(uuid,text,uuid,uuid,uuid,text,text,text,jsonb,text,text,text) from public,anon;
revoke all on function public.update_iteration_candidate_status(uuid,text,text) from public,anon;
grant execute on function public.create_iteration_candidate(uuid,text,uuid,uuid,uuid,text,text,text,jsonb,text,text,text),public.update_iteration_candidate_status(uuid,text,text) to authenticated,service_role;

comment on table public.client_iteration_candidates is 'Reviewed intake queue only; candidates never mutate downstream strategy, content, assets, calendar, or distribution.';
comment on table public.client_iteration_reviews is 'Append-only audit of iteration-candidate review decisions.';
