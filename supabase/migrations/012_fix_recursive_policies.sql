-- Fix infinite recursion in RLS policies.
-- The issue: courses policy checks teachers, enrollments policy checks courses,
-- students policy checks enrollments+courses — creating circular references.

-- Simplify: teacher policies use direct teacher_id lookup (no joins to other policy-protected tables)

-- Courses: simplify to direct teacher_id check
DROP POLICY "Teachers can manage own courses" ON courses;
CREATE POLICY "Teachers can manage own courses"
  ON courses FOR ALL
  USING (
    teacher_id = (SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid())
  )
  WITH CHECK (
    teacher_id = (SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid())
  );

-- Drop the student course policy that causes recursion, recreate without join chains
DROP POLICY IF EXISTS "Students can view enrolled courses" ON courses;
CREATE POLICY "Students can view enrolled courses"
  ON courses FOR SELECT
  USING (
    id IN (
      SELECT e.course_id FROM enrollments e
      WHERE e.student_id IN (
        SELECT s.id FROM students s WHERE s.auth_user_id = auth.uid()
      )
    )
  );

-- Fix enrollments: avoid joining through policy-protected courses table
DROP POLICY "Teachers can manage enrollments in their courses" ON enrollments;
CREATE POLICY "Teachers can manage enrollments in their courses"
  ON enrollments FOR ALL
  USING (
    course_id IN (
      SELECT c.id FROM courses c
      WHERE c.teacher_id = (SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    course_id IN (
      SELECT c.id FROM courses c
      WHERE c.teacher_id = (SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid())
    )
  );

-- Fix assignments: same approach
DROP POLICY "Teachers can manage assignments in their courses" ON assignments;
CREATE POLICY "Teachers can manage assignments in their courses"
  ON assignments FOR ALL
  USING (
    course_id IN (
      SELECT c.id FROM courses c
      WHERE c.teacher_id = (SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    course_id IN (
      SELECT c.id FROM courses c
      WHERE c.teacher_id = (SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid())
    )
  );

-- Fix student assignment visibility
DROP POLICY "Students can view assignments in enrolled courses" ON assignments;
CREATE POLICY "Students can view assignments in enrolled courses"
  ON assignments FOR SELECT
  USING (
    course_id IN (
      SELECT e.course_id FROM enrollments e
      WHERE e.student_id IN (
        SELECT s.id FROM students s WHERE s.auth_user_id = auth.uid()
      )
    )
  );

-- Fix teachers-can-view-students: avoid join through courses
DROP POLICY IF EXISTS "Teachers can view students in their courses" ON students;
CREATE POLICY "Teachers can view students in their courses"
  ON students FOR SELECT
  USING (
    id IN (
      SELECT e.student_id FROM enrollments e
      WHERE e.course_id IN (
        SELECT c.id FROM courses c
        WHERE c.teacher_id = (SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid())
      )
    )
  );
