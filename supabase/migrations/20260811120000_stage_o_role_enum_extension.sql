-- Programme Stage O — Multi-Client Scale and Operational Control, part 1.
--
-- Extends the existing user_role enum with Stage O's remaining 5 named
-- roles (admin, account_manager, editor, client already existed as enum
-- labels). Split into its own migration because ALTER TYPE ... ADD VALUE
-- cannot be used together with a statement that references the new value
-- in the same transaction in all Postgres versions -- this migration adds
-- the values; 20260811120100_stage_o_multi_client_scale_operational_control.sql
-- (applied immediately after, in a separate transaction) does everything
-- else, including the auth_client_ids() fix that makes every one of these
-- roles actually resolve real client visibility via team_members.

alter type public.user_role add value if not exists 'strategist';
alter type public.user_role add value if not exists 'content_operator';
alter type public.user_role add value if not exists 'media_buyer';
alter type public.user_role add value if not exists 'analyst';
alter type public.user_role add value if not exists 'client_approver';
