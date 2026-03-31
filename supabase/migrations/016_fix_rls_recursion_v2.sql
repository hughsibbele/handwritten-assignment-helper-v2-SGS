-- Fix remaining RLS recursion between courses ↔ enrollments.
--
-- Problem: even with auth_student_id() and auth_teacher_id(),
-- policies on courses read enrollments and vice versa → loop.
--
-- Solution: add SECURITY DEFINER helpers for ALL cross-table lookups
-- so no RLS policy ever reads another RLS-protected table directly.

-- Helper: get course IDs for the current teacher (bypasses RLS)
CREATE OR REPLACE FUNCTION auth_teacher_course_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM courses WHERE teacher_id = auth_teacher_id()
$$;

-- Helper: get course IDs the current student is enrolled in (bypasses RLS)
CREATE OR REPLACE FUNCTION auth_student_course_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.course_id FROM enrollments e WHERE e.student_id = auth_student_id()
$$;

-- Helper: get student IDs enrolled in the current teacher's courses (bypasses RLS)
CREATE OR REPLACE FUNCTION auth_teacher_student_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT e.student_id FROM enrollments e
  WHERE e.course_id IN (SELECT auth_teacher_course_ids())
$$;

-- ============================================================
-- Rewrite ALL policies to use ONLY helper functions (no direct table reads)
-- ============================================================

-- STUDENTS table
DROP POLICY "Students can read own row" ON students;
CREATE POLICY "Students can read own row"
  ON students FOR SELECT
  USING (auth_user_id = auth.uid());

DROP POLICY "Students can update own row" ON students;
CREATE POLICY "Students can update own row"
  ON students FOR UPDATE
  USING (auth_user_id = auth.uid());

DROP POLICY "Teachers can view students in their courses" ON students;
CREATE POLICY "Teachers can view students in their courses"
  ON students FOR SELECT
  USING (id IN (SELECT auth_teacher_student_ids()));

-- COURSES table
DROP POLICY "Teachers can manage own courses" ON courses;
CREATE POLICY "Teachers can manage own courses"
  ON courses FOR ALL
  USING (teacher_id = auth_teacher_id())
  WITH CHECK (teacher_id = auth_teacher_id());

DROP POLICY "Students can view enrolled courses" ON courses;
CREATE POLICY "Students can view enrolled courses"
  ON courses FOR SELECT
  USING (id IN (SELECT auth_student_course_ids()));

-- ENROLLMENTS table
DROP POLICY "Students can view own enrollments" ON enrollments;
CREATE POLICY "Students can view own enrollments"
  ON enrollments FOR SELECT
  USING (student_id = auth_student_id());

DROP POLICY "Teachers can manage enrollments in their courses" ON enrollments;
CREATE POLICY "Teachers can manage enrollments in their courses"
  ON enrollments FOR ALL
  USING (course_id IN (SELECT auth_teacher_course_ids()))
  WITH CHECK (course_id IN (SELECT auth_teacher_course_ids()));

-- ASSIGNMENTS table
DROP POLICY "Teachers can manage assignments in their courses" ON assignments;
CREATE POLICY "Teachers can manage assignments in their courses"
  ON assignments FOR ALL
  USING (course_id IN (SELECT auth_teacher_course_ids()))
  WITH CHECK (course_id IN (SELECT auth_teacher_course_ids()));

DROP POLICY "Students can view assignments in enrolled courses" ON assignments;
CREATE POLICY "Students can view assignments in enrolled courses"
  ON assignments FOR SELECT
  USING (course_id IN (SELECT auth_student_course_ids()));

-- SUBMISSIONS table
DROP POLICY "Students can manage own submissions" ON submissions;
CREATE POLICY "Students can manage own submissions"
  ON submissions FOR ALL
  USING (student_id = auth_student_id())
  WITH CHECK (student_id = auth_student_id());

DROP POLICY "Teachers can view submissions in their courses" ON submissions;
CREATE POLICY "Teachers can view submissions in their courses"
  ON submissions FOR SELECT
  USING (student_id IN (SELECT auth_teacher_student_ids()));

-- SUBMISSION_PHOTOS table
DROP POLICY "Students can manage own photos" ON submission_photos;
CREATE POLICY "Students can manage own photos"
  ON submission_photos FOR ALL
  USING (
    submission_id IN (
      SELECT id FROM submissions WHERE student_id = auth_student_id()
    )
  )
  WITH CHECK (
    submission_id IN (
      SELECT id FROM submissions WHERE student_id = auth_student_id()
    )
  );
