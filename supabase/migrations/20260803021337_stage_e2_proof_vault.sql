-- Programme Stage E2: Proof Vault extraction, consent and usage management.
-- Additive to proof_items (Stage B). Verification remains the fail-closed gate
-- from Stage B; consent and usage state are additional independent gates.

alter table public.proof_items
  add column happened_what text,
  add column happened_for text,
  add column what_changed text,
  add column claims_supported jsonb not null default '[]'::jsonb,
  add column objections_answered jsonb not null default '[]'::jsonb,
  add column available_media jsonb not null default '[]'::jsonb,
  add column specificity text,
  add column occurred_on date,
  add column service_ref text,
  add column audience_relevance text,
  add column consent_status text not null default 'not_obtained',
  add column consent_reference text,
  add column anonymisation text not null default 'none',
  add column usage_state text not null default 'unused',
  add column used_count integer not null default 0,
  add column last_used_at timestamptz,
  add column restricted_reason text,
  add column expires_on date;

alter table public.proof_items
  add constraint proof_items_jsonb_check
    check (jsonb_typeof(claims_supported) = 'array'
      and jsonb_typeof(objections_answered) = 'array'
      and jsonb_typeof(available_media) = 'array'),
  add constraint proof_items_specificity_check
    check (specificity is null or specificity in ('vague','general','specific','quantified')),
  add constraint proof_items_consent_check
    check (consent_status in ('not_obtained','requested','granted','withdrawn','not_required')),
  add constraint proof_items_anonymisation_check
    check (anonymisation in ('none','first_name_only','initials','fully_anonymised')),
  add constraint proof_items_usage_state_check
    check (usage_state in ('unused','used','repurposed','overused','high_performing','restricted','expired','needs_stronger_evidence')),
  add constraint proof_items_used_count_check check (used_count >= 0),
  add constraint proof_items_used_consistency_check
    check ((used_count = 0) = (last_used_at is null)),
  add constraint proof_items_restricted_check
    check (usage_state <> 'restricted' or restricted_reason is not null),
  add constraint proof_items_expired_check
    check (usage_state <> 'expired' or expires_on is not null);

create index proof_items_usage_state_idx on public.proof_items (client_id, usage_state);

comment on column public.proof_items.consent_status is 'Stage E: publishable proof requires granted or not_required consent. Withdrawn consent removes usability regardless of verification state.';
comment on column public.proof_items.usage_state is 'Stage E usage management. restricted and expired both block publication; needs_stronger_evidence marks proof that failed a claim check.';
