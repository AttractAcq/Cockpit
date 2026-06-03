-- scripts/create-staff-admin.sql
-- Run in Supabase SQL editor AFTER the user has signed in once via magic link
-- (so their auth.users row already exists). Substitute YOUR_EMAIL below.
--
-- Steps:
--   1. Go to https://iwkhdqqgfjtpdhcbpftu.supabase.co and sign in as the user
--      via magic link (this creates the auth.users row).
--   2. Open the Supabase dashboard → SQL editor.
--   3. Paste this script, replace YOUR_EMAIL@example.com, and run it.
--   4. Refresh the cockpit — the user should now have admin access.

DO $$
DECLARE
  v_user_id uuid;
  v_email   text := 'YOUR_EMAIL@example.com'; -- <-- change this
BEGIN
  -- Look up the auth user
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = v_email
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No auth.users row found for %. Sign in via magic link first.', v_email;
  END IF;

  -- Upsert a users/profiles row (adjust table name if yours differs)
  INSERT INTO public.users (id, email, full_name, created_at)
  VALUES (v_user_id, v_email, 'Admin', now())
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

  -- Upsert team_members row with admin role
  INSERT INTO public.team_members (user_id, role, created_at)
  VALUES (v_user_id, 'admin', now())
  ON CONFLICT (user_id) DO UPDATE SET role = 'admin';

  RAISE NOTICE 'Done — % is now an admin.', v_email;
END $$;
