-- Programme Stage D3: deterministic slot attributes.
-- calendar_slots remains the canonical owner of the scheduled date (Stage B).
-- Slot identity uniqueness is already enforced by calendar_slots_unique
-- (content_requirement_id, scheduled_for, slot_index) and is not weakened here.

alter table public.calendar_slots
  add column platform text,
  add column objective text,
  add column content_pillar text,
  add column funnel_stage text,
  add column audience_stage text,
  add column offer_ref text,
  add column preferred_source_type text,
  add column required_proof_strength text,
  add column production_constraints jsonb not null default '{}'::jsonb,
  add column approval_policy text not null default 'human_required',
  add column is_operational boolean not null default false;

alter table public.calendar_slots
  add constraint calendar_slots_funnel_stage_check
    check (funnel_stage is null or funnel_stage in ('awareness','consideration','decision','retention')),
  add constraint calendar_slots_preferred_source_check
    check (preferred_source_type is null or preferred_source_type in ('manual','proof','research','performance')),
  add constraint calendar_slots_proof_strength_check
    check (required_proof_strength is null or required_proof_strength in ('none','soft','verified')),
  add constraint calendar_slots_approval_policy_check
    check (approval_policy in ('human_required','auto_on_policy')),
  add constraint calendar_slots_constraints_check
    check (jsonb_typeof(production_constraints) = 'object');

comment on column public.calendar_slots.is_operational is 'Stage D: false until the owning execution config is approved. A slot is planning scaffolding until then and must not drive production.';
comment on column public.calendar_slots.approval_policy is 'Stage D: human_required is the default. auto_on_policy never bypasses content item approval, which remains owned by content_items.status.';
