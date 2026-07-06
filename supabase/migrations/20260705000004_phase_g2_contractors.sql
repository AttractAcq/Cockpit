-- Phase G2: human production contractors and assignment/send history.
CREATE TABLE IF NOT EXISTS public.contractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  email text NOT NULL UNIQUE CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role text,
  specialties text[] NOT NULL DEFAULT '{}'::text[],
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.contractor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  production_brief_id uuid NOT NULL REFERENCES public.client_production_briefs(id) ON DELETE CASCADE,
  contractor_id uuid NOT NULL REFERENCES public.contractors(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','sent','failed','cancelled')),
  message text,
  sent_at timestamptz,
  resend_message_id text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contractor_assignments_brief_idx
  ON public.contractor_assignments (production_brief_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contractor_assignments_contractor_idx
  ON public.contractor_assignments (contractor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS contractor_assignments_client_idx
  ON public.contractor_assignments (client_id, created_at DESC);

ALTER TABLE public.contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contractors FROM anon;
REVOKE ALL ON public.contractor_assignments FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contractors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contractor_assignments TO authenticated;

DROP POLICY IF EXISTS contractors_staff_all ON public.contractors;
CREATE POLICY contractors_staff_all ON public.contractors
  FOR ALL TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'))
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));

DROP POLICY IF EXISTS contractor_assignments_staff_all ON public.contractor_assignments;
CREATE POLICY contractor_assignments_staff_all ON public.contractor_assignments
  FOR ALL TO authenticated
  USING (public.auth_role() IN ('admin','account_manager','editor'))
  WITH CHECK (public.auth_role() IN ('admin','account_manager','editor'));
