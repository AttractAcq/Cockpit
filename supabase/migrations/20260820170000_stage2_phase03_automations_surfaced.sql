-- Stage 2, Phase 03 — Automations, surfaced.
--
-- Zero new execution infrastructure, per this phase's own goal: a
-- read-mostly observability layer over the cron/edge-function runtime that
-- already exists. The only new object is one staff-only, read-only RPC
-- exposing pg_cron's real job list -- the ground truth for "what's actually
-- scheduled" -- with the SQL command text deliberately not returned (it
-- embeds a vault secret reference in its headers; the caller only needs to
-- know which function each job calls, not the literal command).

create or replace function public.list_scheduled_triggers() returns table (
  jobname text,
  schedule text,
  active boolean,
  target_function text
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'AUTH: not authenticated'; end if;
  if coalesce(public.auth_role(), '') = 'client' then raise exception 'AUTH: staff role required'; end if;

  return query
  select
    j.jobname,
    j.schedule,
    j.active,
    -- Extract the function slug from ".../functions/v1/<slug>" in the
    -- command text without ever returning the command itself.
    (regexp_match(j.command, 'functions/v1/([a-z0-9-]+)'))[1] as target_function
  from cron.job j
  order by j.jobname;
end;
$$;

revoke all on function public.list_scheduled_triggers() from public, anon;
grant execute on function public.list_scheduled_triggers() to authenticated, service_role;

comment on function public.list_scheduled_triggers() is 'Stage 2 Phase 03: staff-only read of pg_cron''s real job list (jobname, schedule, active, target_function). Never returns the raw command text, which embeds a vault secret reference in its headers.';
