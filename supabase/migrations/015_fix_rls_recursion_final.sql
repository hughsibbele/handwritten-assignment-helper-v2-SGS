-- Fix RLS infinite recursion once and for all.
--
-- Problem: "Teachers can view students" policy reads enrollments,
-- "Students can view own enrollments" reads students → circular dependency.
-- Postgres evaluates ALL SELECT policies (OR'd), so even a student query
-- triggers the teacher policy chain.
--
-- Solution: SECURITY DEFINER helper functions bypass RLS on inner lookups,
-- breaking the recursion chain.

-- Helper: get current user's student ID (bypasses RLS)
CREATE OR REPLACE FUNCTION auth_student_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM students WHERE auth_user_id = auth.uid()
$$;

-- Helper: get current user's teacher ID (bypasses RLS)
CREATE OR REPLACE FUNCTION auth_teacher_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM teachers WHERE auth_user_id = auth.uid()
$$;

-- ============================================================
-- Rewrite ALL cross-table policies to use the helper functions
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
  USING (
    id IN (
      SELECT e.student_id FROM enrollments e
      WHERE e.course_id IN (
        SELECT c.id FROM courses c WHERE c.teacher_id = auth_teacher_id()
      )
    )
  );

-- COURSES table
DROP POLICY "Teachers can manage own courses" ON courses;
CREATE POLICY "Teachers can manage own courses"
  ON courses FOR ALL
  USING (teacher_id = auth_teacher_id())
  WITH CHECK (teacher_id = auth_teacher_id());

DROP POLICY "Students can view enrolled courses" ON courses;
CREATE POLICY "Students can view enrolled courses"
  ON courses FOR SELECT
  USING (
    id IN (
      SELECT e.course_id FROM enrollments e
      WHERE e.student_id = auth_student_id()
    )
  );

-- ENROLLMENTS table
DROP POLICY "Students can view own enrollments" ON enrollments;
CREATE POLICY "Students can view own enrollments"
  ON enrollments FOR SELECT
  USING (student_id = auth_student_id());

DROP POLICY "Teachers can manage enrollments in their courses" ON enrollments;
CREATE POLICY "Teachers can manage enrollments in their courses"
  ON enrollments FOR ALL
  USING (
    course_id IN (
      SELECT c.id FROM courses c WHERE c.teacher_id = auth_teacher_id()
    )
  )
  WITH CHECK (
    course_id IN (
      SELECT c.id FROM courses c WHERE c.teacher_id = auth_teacher_id()
    )
  );

-- ASSIGNMENTS table
DROP POLICY "Teachers can manage assignments in their courses" ON assignments;
CREATE POLICY "Teachers can manage assignments in their courses"
  ON assignments FOR ALL
  USING (
    course_id IN (
      SELECT c.id FROM courses c WHERE c.teacher_id = auth_teacher_id()
    )
  )
  WITH CHECK (
    course_id IN (
      SELECT c.id FROM courses c WHERE c.teacher_id = auth_teacher_id()
    )
  );

DROP POLICY "Students can view assignments in enrolled courses" ON assignments;
CREATE POLICY "Students can view assignments in enrolled courses"
  ON assignments FOR SELECT
  USING (
    course_id IN (
      SELECT e.course_id FROM enrollments e
      WHERE e.student_id = auth_student_id()
    )
  );

-- SUBMISSIONS table (if student policies exist)
DROP POLICY IF EXISTS "Students can manage own submissions" ON submissions;
CREATE POLICY "Students can manage own submissions"
  ON submissions FOR ALL
  USING (student_id = auth_student_id())
  WITH CHECK (student_id = auth_student_id());

DROP POLICY IF EXISTS "Teachers can view submissions in their courses" ON submissions;
CREATE POLICY "Teachers can view submissions in their courses"
  ON submissions FOR SELECT
  USING (
    student_id IN (
      SELECT e.student_id FROM enrollments e
      WHERE e.course_id IN (
        SELECT c.id FROM courses c WHERE c.teacher_id = auth_teacher_id()
      )
    )
  );

-- SUBMISSION_PHOTOS table (if policies exist)
DROP POLICY IF EXISTS "Students can manage own photos" ON submission_photos;
CREATE POLICY "Students can manage own photos"
  ON submission_photos FOR ALL
  USING (
    submission_id IN (
      SELECT s.id FROM submissions s WHERE s.student_id = auth_student_id()
    )
  )
  WITH CHECK (
    submission_id IN (
      SELECT s.id FROM submissions s WHERE s.student_id = auth_student_id()
    )
  );
