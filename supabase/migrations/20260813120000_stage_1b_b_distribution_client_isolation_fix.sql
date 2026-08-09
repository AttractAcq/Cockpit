-- Programme Stage 1B-B — real security bug found via audit before extending
-- this exact table for Facebook Page destinations.
--
-- client_distribution_accounts and client_distribution_records both have
-- staff RLS policies that check only auth_role() IN (admin, account_manager,
-- editor) -- with NO client_id scoping via auth_client_ids() at all, unlike
-- their sibling client_distribution_policies (which correctly uses
-- `client_id = ANY (auth_client_ids())`). This means any account_manager or
-- editor -- even one with zero team_members rows for a given client -- can
-- see and modify every client's distribution accounts and distribution
-- records today, defeating the team_members-scoped isolation model Stage O
-- established as the correct standard for every other staff-facing table.
--
-- This stage is about to add a `credential_reference` column to
-- client_distribution_accounts (Vault credential name for Facebook Page
-- access) and store Facebook Page identifiers there -- exactly the kind of
-- data this isolation gap would expose across clients. Fixed here, before
-- that column exists, rather than after.
--
-- auth_client_ids() already returns every client for role='admin' (Stage O),
-- so this is purely additive for admins and a real tightening for every
-- other staff role -- no legitimate access is removed.
--
-- Both tables are staff-only, authenticated-role tables: the scheduled-
-- publishing worker and its claim/verification RPCs all run as service_role,
-- which bypasses RLS entirely, so this change has zero effect on the live
-- worker -- only on direct staff access via the frontend.

alter policy client_distribution_accounts_staff_select on public.client_distribution_accounts
  using (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()));

alter policy client_distribution_accounts_staff_insert on public.client_distribution_accounts
  with check (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()));

alter policy client_distribution_accounts_staff_update on public.client_distribution_accounts
  using (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()))
  with check (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()));

alter policy client_distribution_records_staff_select on public.client_distribution_records
  using (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()));

alter policy client_distribution_records_staff_insert on public.client_distribution_records
  with check (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()));

alter policy client_distribution_records_staff_update on public.client_distribution_records
  using (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()))
  with check (auth_role() = any (array['admin','account_manager','editor']) and client_id = any (auth_client_ids()));
