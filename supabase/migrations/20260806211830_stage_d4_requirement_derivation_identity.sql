-- Programme Stage D4: idempotent derivation identity for content_requirements.
--
-- Stage B gave content_requirements only a primary key. Stage D derives
-- requirements deterministically from an approved execution config, so
-- re-running the derivation — a retry, a double submit, a re-approval — would
-- have inserted a second identical row with a fresh uuid and silently doubled
-- the demand-side plan.
--
-- Identity for a derived requirement is (execution_config_id, platform,
-- channel, asset_format). A changed Execution version produces a new config
-- row and therefore a new execution_config_id, so a new requirement set is
-- still created and the previous set remains historically readable — this
-- constraint does not collapse versions together.
--
-- Additive and backwards compatible: the index is partial on
-- execution_config_id is not null, so every pre-Stage-D row (which has a null
-- execution_config_id) is untouched and remains valid.

-- A null platform would defeat the unique index, because SQL treats nulls as
-- distinct. Derived rows must therefore always carry a platform. Legacy rows
-- are exempt via the execution_config_id is null branch.
alter table public.content_requirements
  add constraint content_requirements_derived_platform_check
    check (execution_config_id is null or platform is not null);

create unique index content_requirements_derived_identity
  on public.content_requirements (execution_config_id, platform, channel, asset_format)
  where execution_config_id is not null;

comment on index public.content_requirements_derived_identity is
  'Stage D: makes derivation idempotent. Re-deriving from the same approved execution config updates the existing requirement rather than inserting a duplicate. Partial so pre-Stage-D rows are unaffected.';

-- Slot identity is already enforced by calendar_slots_unique
-- (content_requirement_id, scheduled_for, slot_index) from Stage B and is not
-- weakened here. This index only supports the operational-slot lookups the
-- Stage D review UI and derivation perform.
create index calendar_slots_requirement_operational_idx
  on public.calendar_slots (content_requirement_id, is_operational);
