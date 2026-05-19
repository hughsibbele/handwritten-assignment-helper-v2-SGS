-- Admins table + is_admin() helper. Graduates HAH from the env-var
-- ADMIN_EMAILS allowlist to AI Documenter's pattern: a real `admins` table
-- keyed on lowercase email, an is_admin() SECURITY DEFINER function callable
-- from RLS, and a self-bootstrap in app code that promotes
-- INITIAL_ADMIN_EMAIL when the table is empty.
--
-- Shape ported from AI Documenter's 20260507160000_admins_and_system_prompts
-- (admins-table portion only — HAH's prompts table is single-prompt and
-- doesn't need the scope/system-vs-teacher work AID did in the same file).

CREATE TABLE public.admins (
  email TEXT PRIMARY KEY CHECK (email = lower(email)),
  granted_by_email TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admins TO service_role;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE SQL SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (
    SELECT 1 FROM admins a
    WHERE a.active = true
      AND a.email = lower((auth.jwt() ->> 'email'))
  );
$$;

REVOKE EXECUTE ON FUNCTION is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION is_admin() TO service_role;

-- Admins manage the table via the app's service-role admin client (which
-- bypasses RLS for bootstrap). RLS lets the logged-in admin read/write rows
-- via the regular user-scoped client too, useful for a future /admin/admins
-- management page.
CREATE POLICY admins_select ON public.admins
  FOR SELECT TO authenticated USING (is_admin());

CREATE POLICY admins_modify ON public.admins
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());
