-- Programme Stage D2: link content requirements to approved execution authority.
-- Additive. Existing Stage B columns are unchanged, so any requirement created
-- before Stage D remains valid and historically readable.

alter table public.content_requirements
  add column execution_config_id uuid references public.client_execution_configs(id) on delete restrict,
  add column platform text,
  add column cadence text,
  add column objective_mix jsonb not null default '{}'::jsonb,
  add column preferred_origins jsonb not null default '{}'::jsonb,
  add column requirement_set_version integer not null default 1;

alter table public.content_requirements
  add constraint content_requirements_cadence_check
    check (cadence is null or cadence in ('daily','weekly','biweekly','monthly')),
  add constraint content_requirements_mix_check
    check (jsonb_typeof(objective_mix) = 'object' and jsonb_typeof(preferred_origins) = 'object'),
  add constraint content_requirements_set_version_check check (requirement_set_version >= 1);

comment on column public.content_requirements.execution_config_id is 'Stage D: the approved execution config this requirement was derived from. A changed Execution version produces a new config and therefore a new requirement set; older sets remain historically readable.';
