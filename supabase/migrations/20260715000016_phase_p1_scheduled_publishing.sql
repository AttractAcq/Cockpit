-- P1 Scheduled Publishing — additive reliability layer for recurring publishing.
-- No existing column/policy is dropped; the publish_status CHECK is only EXTENDED
-- (adds 'needs_reconciliation'). Adds atomic claim, retry/backoff fields, an
-- attempt log, and stale-claim recovery. HELD — do not apply until reviewed.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Claim + retry fields on distribution records.
alter table public.client_distribution_records
  add column if not exists claimed_at        timestamptz,
  add column if not exists claimed_by        text,
  add column if not exists attempt_count     integer     not null default 0,
  add column if not exists next_attempt_at   timestamptz,
  add column if not exists permanent_failure boolean     not null default false;

-- Extend the status vocabulary with an ambiguous-external-state terminal-ish
-- value. 'needs_reconciliation' is never auto-retried; an operator must resolve it.
alter table public.client_distribution_records
  drop constraint if exists client_distribution_records_publish_status_check;
alter table public.client_distribution_records
  add constraint client_distribution_records_publish_status_check
  check (publish_status in ('ready','scheduled','publishing','published','failed','cancelled','needs_reconciliation'));

-- Retry-aware due index (scheduler filters status + next_attempt_at).
create index if not exists client_distribution_records_retry_idx
  on public.client_distribution_records (publish_status, next_attempt_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Atomic claim RPC. Concurrency-safe via FOR UPDATE SKIP LOCKED so two
--    overlapping workers get DISJOINT batches and can never claim the same row.
--    Also enforces the Story sequence gate: a frame is claimable only when every
--    earlier frame in its asset group is already published.
create or replace function public.claim_due_distribution_records(p_worker_id text, p_limit integer)
returns setof public.client_distribution_records
language sql
security definer
set search_path = ''
as $$
  update public.client_distribution_records d
  set publish_status = 'publishing',
      claimed_at      = now(),
      claimed_by      = p_worker_id,
      attempt_count   = d.attempt_count + 1,
      last_error      = null,
      updated_at      = now()
  where d.id in (
    select c.id
    from public.client_distribution_records c
    where c.publish_status = 'scheduled'
      and c.scheduled_publish_at is not null
      and c.scheduled_publish_at <= now()
      and (c.next_attempt_at is null or c.next_attempt_at <= now())
      and not exists (
        select 1 from public.client_distribution_records e
        where e.client_id = c.client_id
          and e.asset_group_ref = c.asset_group_ref
          and e.sequence_index < c.sequence_index
          and e.publish_status <> 'published'
      )
    order by c.scheduled_publish_at
    limit p_limit
    for update skip locked
  )
  returning d.*;
$$;
revoke all on function public.claim_due_distribution_records(text, integer) from public, anon, authenticated;
grant execute on function public.claim_due_distribution_records(text, integer) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Stale-claim recovery. Rows stuck in 'publishing' longer than p_older_than
--    (a worker died / hit the edge wall-clock cap mid-publish):
--      • WITH publication evidence  → finalize 'published' (post exists; the
--        worker died after media_publish but before the final write).
--      • WITHOUT evidence           → 'needs_reconciliation' — external state is
--        UNCERTAIN (it may or may not have posted). NEVER blind-retried.
create or replace function public.recover_stale_publishing(p_older_than interval)
returns table(recovered_published integer, flagged_reconcile integer)
language plpgsql
security definer
set search_path = ''
as $$
declare v_pub integer; v_rec integer;
begin
  with stale as (
    select id,
           (external_post_id is not null or published_at is not null or published_url is not null) as has_evidence
    from public.client_distribution_records
    where publish_status = 'publishing'
      and claimed_at is not null
      and claimed_at < now() - p_older_than
  ),
  pub as (
    update public.client_distribution_records d
    set publish_status = 'published',
        published_at   = coalesce(d.published_at, now()),
        last_error     = null,
        updated_at     = now()
    from stale s where d.id = s.id and s.has_evidence
    returning d.id
  ),
  rec as (
    update public.client_distribution_records d
    set publish_status = 'needs_reconciliation',
        last_error     = 'Stale publishing claim with no publication evidence — external Instagram state is uncertain; manual reconciliation required before any retry.',
        updated_at     = now()
    from stale s where d.id = s.id and not s.has_evidence
    returning d.id
  )
  select (select count(*) from pub), (select count(*) from rec) into v_pub, v_rec;
  return query select coalesce(v_pub,0), coalesce(v_rec,0);
end;
$$;
revoke all on function public.recover_stale_publishing(interval) from public, anon, authenticated;
grant execute on function public.recover_stale_publishing(interval) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Publish attempt log — one row per publish attempt, for operator diagnosis.
create table if not exists public.client_publish_attempts (
  id                     uuid primary key default gen_random_uuid(),
  distribution_record_id uuid not null references public.client_distribution_records(id) on delete cascade,
  client_id              uuid not null references public.clients(id) on delete cascade,
  source_ref             text not null,
  asset_format           text,
  attempt_number         integer not null,
  worker_invocation_id   text,
  claimed_by             text,
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  result                 text not null default 'started'
    check (result in ('started','published','retryable_failure','permanent_failure','ambiguous','skipped')),
  category               text,
  retryable              boolean,
  meta_error_code        integer,
  meta_error_subcode     integer,
  external_post_id       text,
  container_ids          jsonb not null default '[]'::jsonb,
  message                text,
  created_at             timestamptz not null default now()
);
create index if not exists client_publish_attempts_record_idx
  on public.client_publish_attempts (distribution_record_id, attempt_number);
create index if not exists client_publish_attempts_client_idx
  on public.client_publish_attempts (client_id, created_at desc);

alter table public.client_publish_attempts enable row level security;
revoke all on public.client_publish_attempts from anon, public;
grant select on public.client_publish_attempts to authenticated;      -- staff-select via policy
grant select, insert, update on public.client_publish_attempts to service_role;

drop policy if exists client_publish_attempts_staff_select on public.client_publish_attempts;
create policy client_publish_attempts_staff_select on public.client_publish_attempts
  for select to authenticated
  using (public.auth_role() in ('admin','account_manager','editor'));
