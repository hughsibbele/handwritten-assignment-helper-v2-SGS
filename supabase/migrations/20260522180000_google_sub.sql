-- M4.11 (b): persist the Google OAuth subject claim (`identities[].identity_data.sub`)
-- on both teacher + student rows. Useful for account reconciliation when a
-- user changes their EHS email — the sub is stable across email renames
-- while auth.users.email is mutable.
--
-- AID has stored this on both tables since its initial schema. HAH didn't;
-- this migration backfills the column shape so HAH's auth callback can
-- start populating on next sign-in.

ALTER TABLE public.students
  ADD COLUMN google_sub text;

ALTER TABLE public.teachers
  ADD COLUMN google_sub text;

CREATE INDEX students_google_sub_idx ON public.students (google_sub)
  WHERE google_sub IS NOT NULL;
CREATE INDEX teachers_google_sub_idx ON public.teachers (google_sub)
  WHERE google_sub IS NOT NULL;

COMMENT ON COLUMN public.students.google_sub IS
  'Google OAuth subject claim (identities[].identity_data.sub). Stable across EHS email renames; useful for reconciling accounts. Populated on sign-in callback (M4.11).';
COMMENT ON COLUMN public.teachers.google_sub IS
  'Google OAuth subject claim. See students.google_sub.';
