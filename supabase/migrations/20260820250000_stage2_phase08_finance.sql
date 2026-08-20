-- Stage 2, Phase 08 — Finance.
--
-- Per Phase 00's own acceptance bar (STAGE_2_PHASE_00_GROUND_TRUTH.md §4):
-- "CSV import plus one full accounting period reconciled against the
-- already-real client_cost_ledger/client_margin_summary -- this is an
-- extension of existing schema, not a new one." Cost tracking
-- (client_cost_ledger, Stage O) is already real; what's missing is (a) bulk
-- CSV import instead of one-row-at-a-time entry, and (b) an actual period
-- concept -- today's clients.monthly_revenue_estimate is a single, mutable,
-- ever-changing scalar with no history and no reconciliation step, so
-- "reconciled for one full accounting period" cannot be expressed at all
-- yet. The phase card's own longer wishlist (accounting-platform
-- integration, payment processors, direct bank feeds, increasingly
-- autonomous reconciliation) is explicitly sequenced *after* CSV import is
-- trusted through real usage ("each step gated on the last") -- none of
-- that is v1.
--
-- Amounts here follow client_cost_ledger's own numeric(12,2) EUR
-- convention (this migration extends that table's domain directly),
-- not the newer _cents-integer convention used by unrelated Stage 2
-- tables (Sales, Marketing Campaigns) -- consistency with the domain being
-- extended wins over consistency with unrelated newer tables.
--
-- One new table (client_finance_periods) -- a reconciled period is a
-- permanent historical fact, so total_cost/margin are snapshotted at
-- reconciliation time rather than recomputed live from client_cost_ledger
-- afterward (a backdated cost entry added post-reconciliation must not
-- silently change an already-reconciled period's numbers). Within Decision
-- 4's <=3-table budget.

create table public.client_finance_periods (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null default 'open',
  actual_revenue numeric(12,2),
  total_cost numeric(12,2),
  margin numeric(12,2),
  reconciled_by uuid references public.users(id) on delete set null,
  reconciled_at timestamptz,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_finance_periods_status_check check (status in ('open','reconciled')),
  constraint client_finance_periods_dates_check check (period_end >= period_start),
  constraint client_finance_periods_revenue_check check (actual_revenue is null or actual_revenue >= 0),
  constraint client_finance_periods_reconciled_check check (
    (status = 'reconciled') = (actual_revenue is not null and total_cost is not null and reconciled_at is not null and reconciled_by is not null)
  ),
  constraint client_finance_periods_unique unique (client_id, period_start, period_end)
);

create index client_finance_periods_client_idx on public.client_finance_periods (client_id, status);

drop trigger if exists client_finance_periods_updated_at on public.client_finance_periods;
create trigger client_finance_periods_updated_at before update on public.client_finance_periods
  for each row execute function public.set_updated_at();

alter table public.client_finance_periods enable row level security;
revoke all on public.client_finance_periods from public, anon, authenticated;
grant select on public.client_finance_periods to authenticated;
grant all on public.client_finance_periods to service_role;

create policy client_finance_periods_select on public.client_finance_periods
  for select to authenticated using (client_id = any(public.auth_client_ids()));

comment on table public.client_finance_periods is 'Stage 2 Phase 08: a real accounting period with a reconciliation step, distinct from the mutable, historyless clients.monthly_revenue_estimate. total_cost/margin are snapshotted at reconciliation time, not recomputed live -- a reconciled period is a permanent fact, unaffected by cost entries added afterward.';

create or replace function public.open_finance_period(
  p_client_id uuid, p_period_start date, p_period_end date, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(), '') not in ('admin','account_manager')) then
    raise exception 'AUTH: admin or account manager role required';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then raise exception 'NOT_FOUND: client'; end if;
  if p_period_end < p_period_start then raise exception 'VALIDATION: period_end must not be before period_start'; end if;
  if exists (
    select 1 from public.client_finance_periods
    where client_id = p_client_id and period_start <= p_period_end and period_end >= p_period_start
  ) then
    raise exception 'CONFLICT: an existing period for this client overlaps the requested range';
  end if;

  insert into public.client_finance_periods (client_id, period_start, period_end, notes, created_by)
  values (p_client_id, p_period_start, p_period_end, nullif(trim(coalesce(p_notes,'')),''), case when auth.role() = 'service_role' then null else auth.uid() end)
  returning id into v_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, auth.uid(), 'finance_period_opened', 'Finance period ' || p_period_start || ' to ' || p_period_end || ' opened.', 'client_finance_period', v_id, jsonb_build_object('period_start', p_period_start, 'period_end', p_period_end));

  return v_id;
end; $$;

create or replace function public.reconcile_finance_period(
  p_period_id uuid, p_actual_revenue numeric, p_notes text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.client_finance_periods; v_total_cost numeric(12,2);
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(), '') not in ('admin','account_manager')) then
    raise exception 'AUTH: admin or account manager role required';
  end if;
  if p_actual_revenue is null or p_actual_revenue < 0 then raise exception 'VALIDATION: actual_revenue must be a non-negative amount'; end if;

  select * into v_row from public.client_finance_periods where id = p_period_id for update;
  if not found then raise exception 'NOT_FOUND: finance period'; end if;
  if v_row.status = 'reconciled' then raise exception 'CONFLICT: period is already reconciled'; end if;

  select coalesce(sum(amount), 0) into v_total_cost
  from public.client_cost_ledger
  where client_id = v_row.client_id
    and occurred_at >= v_row.period_start and occurred_at < (v_row.period_end + 1);

  update public.client_finance_periods set
    status = 'reconciled',
    actual_revenue = p_actual_revenue,
    total_cost = v_total_cost,
    margin = p_actual_revenue - v_total_cost,
    reconciled_by = case when auth.role() = 'service_role' then null else auth.uid() end,
    reconciled_at = now(),
    notes = coalesce(nullif(trim(coalesce(p_notes,'')),''), v_row.notes)
  where id = p_period_id;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (v_row.client_id, auth.uid(), 'finance_period_reconciled', 'Finance period ' || v_row.period_start || ' to ' || v_row.period_end || ' reconciled: revenue ' || p_actual_revenue || ', cost ' || v_total_cost || '.', 'client_finance_period', v_row.id, jsonb_build_object('actual_revenue', p_actual_revenue, 'total_cost', v_total_cost, 'margin', p_actual_revenue - v_total_cost));
end; $$;

-- Bulk, atomic CSV-import counterpart to Stage O's own record_cost_entry --
-- one row per array element, same validation, all-or-nothing (a single bad
-- row rolls back the whole import rather than leaving a partial batch).
create or replace function public.import_cost_entries(p_client_id uuid, p_entries jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_entry jsonb; v_count integer := 0;
begin
  if auth.role() <> 'service_role' and (auth.uid() is null or coalesce(public.auth_role(), '') not in ('admin','account_manager')) then
    raise exception 'AUTH: admin or account manager role required';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then raise exception 'NOT_FOUND: client'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception 'VALIDATION: entries must be a non-empty array';
  end if;

  for v_entry in select * from jsonb_array_elements(p_entries) loop
    if not (v_entry ? 'cost_category') or not (v_entry ? 'amount') or not (v_entry ? 'occurred_at') then
      raise exception 'VALIDATION: each entry needs cost_category, amount, and occurred_at';
    end if;
    if (v_entry->>'cost_category') not in ('model_spend','storage','rendering','human_time','ad_management_time','revision_cost','fulfilment_cost') then
      raise exception 'VALIDATION: invalid cost_category "%"', v_entry->>'cost_category';
    end if;
    if (v_entry->>'amount')::numeric < 0 then raise exception 'VALIDATION: amount must be non-negative'; end if;

    insert into public.client_cost_ledger (client_id, cost_category, amount, currency, source_system, occurred_at, notes, created_by)
    values (
      p_client_id, v_entry->>'cost_category', (v_entry->>'amount')::numeric, 'EUR', 'csv_import',
      (v_entry->>'occurred_at')::timestamptz, nullif(trim(coalesce(v_entry->>'notes','')),''),
      case when auth.role() = 'service_role' then null else auth.uid() end
    );
    v_count := v_count + 1;
  end loop;

  insert into public.activity_log (client_id, actor_id, event_type, plain_english_message, object_type, object_id, metadata)
  values (p_client_id, auth.uid(), 'cost_entries_imported', v_count || ' cost entries imported via CSV.', 'client_cost_ledger', null, jsonb_build_object('count', v_count));

  return v_count;
end; $$;

revoke all on function public.open_finance_period(uuid,date,date,text) from public, anon;
revoke all on function public.reconcile_finance_period(uuid,numeric,text) from public, anon;
revoke all on function public.import_cost_entries(uuid,jsonb) from public, anon;
grant execute on function public.open_finance_period(uuid,date,date,text) to authenticated, service_role;
grant execute on function public.reconcile_finance_period(uuid,numeric,text) to authenticated, service_role;
grant execute on function public.import_cost_entries(uuid,jsonb) to authenticated, service_role;

comment on function public.open_finance_period(uuid,date,date,text) is 'Admin/account-manager only. Opens a real accounting period for a client; rejects overlap with any existing period for that client.';
comment on function public.reconcile_finance_period(uuid,numeric,text) is 'Admin/account-manager only. Snapshots total_cost from client_cost_ledger for the period''s date range, stores it with the supplied actual_revenue and the resulting margin, and marks the period reconciled -- permanently, not recomputed live afterward.';
comment on function public.import_cost_entries(uuid,jsonb) is 'Admin/account-manager only. Bulk, atomic counterpart to record_cost_entry for CSV import -- one bad row rolls back the whole batch.';
