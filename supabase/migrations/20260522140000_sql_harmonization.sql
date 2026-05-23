-- M4.10: HAH SQL/migration harmonization.
--
-- Two changes, both purely additive:
--   (b) Adds is_teacher_owner(t_id uuid) + is_student_self(s_id uuid) —
--       AID-shape boolean SECURITY DEFINER helpers. HAH's existing
--       auth_teacher_id() / auth_student_id() functions stay in place; this
--       migration only INTRODUCES the new shape. Per-policy migration to
--       use these is a documented follow-up (CLAUDE.md M4.10b).
--   (c) Retro-applies the explicit GRANT EXECUTE / REVOKE EXECUTE FROM anon
--       hygiene pattern (linter 0028/0029) to the five pre-existing helper
--       functions from migrations 015 + 016. The newer helpers (022, 023)
--       already follow the pattern; this catches the laggards.
--
-- No behavior change: pre- and post-migration access semantics are
-- identical for `authenticated`. The cleanup removes default-PUBLIC
-- EXECUTE from `anon`, which never had business calling these (every
-- helper relies on `auth.uid()`, which is null for `anon`).

-- (b) AID-shape boolean RLS helpers ------------------------------------------

CREATE OR REPLACE FUNCTION is_teacher_owner(t_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM teachers
    WHERE id = t_id AND auth_user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION is_teacher_owner(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_teacher_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_teacher_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_teacher_owner(uuid) TO service_role;

CREATE OR REPLACE FUNCTION is_student_self(s_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM students
    WHERE id = s_id AND auth_user_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION is_student_self(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_student_self(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION is_student_self(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_student_self(uuid) TO service_role;

-- (c) Backfill GRANT/REVOKE hygiene on the older helpers ---------------------

REVOKE EXECUTE ON FUNCTION auth_student_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_student_id() FROM anon;
GRANT EXECUTE ON FUNCTION auth_student_id() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_student_id() TO service_role;

REVOKE EXECUTE ON FUNCTION auth_teacher_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_teacher_id() FROM anon;
GRANT EXECUTE ON FUNCTION auth_teacher_id() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_teacher_id() TO service_role;

REVOKE EXECUTE ON FUNCTION auth_teacher_course_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_teacher_course_ids() FROM anon;
GRANT EXECUTE ON FUNCTION auth_teacher_course_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_teacher_course_ids() TO service_role;

REVOKE EXECUTE ON FUNCTION auth_student_course_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_student_course_ids() FROM anon;
GRANT EXECUTE ON FUNCTION auth_student_course_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_student_course_ids() TO service_role;

REVOKE EXECUTE ON FUNCTION auth_teacher_student_ids() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION auth_teacher_student_ids() FROM anon;
GRANT EXECUTE ON FUNCTION auth_teacher_student_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION auth_teacher_student_ids() TO service_role;

COMMENT ON FUNCTION is_teacher_owner(uuid) IS
  'M4.10: AID-shape boolean check for "is the current auth.uid() the teacher who owns row t_id". Use in RLS policies as USING (is_teacher_owner(teacher_id)). Co-exists with auth_teacher_id() for one cycle; per-policy migration follow-up.';
COMMENT ON FUNCTION is_student_self(uuid) IS
  'M4.10: AID-shape boolean check for "is the current auth.uid() the student row s_id".';
