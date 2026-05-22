-- Phase 0b of REMEDIATION_PLAN.md — auth boundary criticals.
--
-- 1. teachers_allowlist table — admin-managed list of emails permitted to
--    upsert a row into `teachers`. Closes the "any signed-in EHS user can
--    self-promote to teacher" hole. Seeded from the existing teachers table
--    so today's legitimate teachers don't get locked out.
-- 2. Replace the WITH CHECK (true) policy on students (migration 011) with
--    a teacher-of-a-course constraint. The Canvas-sync bulk path uses
--    createAdminClient() and bypasses RLS, unaffected.

CREATE TABLE IF NOT EXISTS public.teachers_allowlist (
  email TEXT PRIMARY KEY,
  active BOOLEAN NOT NULL DEFAULT true,
  added_by_email TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.teachers_allowlist ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teachers_allowlist TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.teachers_allowlist TO service_role;

CREATE POLICY teachers_allowlist_admin_read ON public.teachers_allowlist
  FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY teachers_allowlist_admin_write ON public.teachers_allowlist
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

COMMENT ON TABLE public.teachers_allowlist IS
  'Phase 0b: emails permitted to become teachers. /api/teacher/setup/canvas refuses upsert unless the caller email is in this table with active=true. Seeded from existing teachers.email; new entries added by admin via /admin UI (TODO) or direct SQL.';

INSERT INTO public.teachers_allowlist (email, added_by_email)
SELECT DISTINCT lower(email), 'phase-0b-backfill'
  FROM public.teachers
 WHERE email IS NOT NULL
ON CONFLICT (email) DO NOTHING;

DROP POLICY IF EXISTS "Teachers can insert students" ON public.students;
CREATE POLICY "Teachers can insert students" ON public.students
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM teachers t
      WHERE t.auth_user_id = auth.uid()
    )
  );

COMMENT ON POLICY "Teachers can insert students" ON public.students IS
  'Phase 0b: only authenticated users with a teachers row can INSERT here. Combined with teachers_allowlist gating the teachers upsert path, non-allowlisted users can no longer plant students rows for arbitrary emails. Bulk-sync via createAdminClient() bypasses RLS, unaffected.';
