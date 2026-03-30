-- Fix: FOR ALL policies need WITH CHECK for inserts to work.
-- Drop and recreate the policies that need insert support.

-- Courses: teachers can insert/update/delete their own courses
DROP POLICY "Teachers can manage own courses" ON courses;
CREATE POLICY "Teachers can manage own courses"
  ON courses FOR ALL
  USING (
    teacher_id IN (
      SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    teacher_id IN (
      SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid()
    )
  );

-- Enrollments: teachers can manage enrollments in their courses
DROP POLICY "Teachers can manage enrollments in their courses" ON enrollments;
CREATE POLICY "Teachers can manage enrollments in their courses"
  ON enrollments FOR ALL
  USING (
    course_id IN (
      SELECT c.id FROM courses c
      JOIN teachers t ON c.teacher_id = t.id
      WHERE t.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    course_id IN (
      SELECT c.id FROM courses c
      JOIN teachers t ON c.teacher_id = t.id
      WHERE t.auth_user_id = auth.uid()
    )
  );

-- Assignments: teachers can manage assignments in their courses
DROP POLICY "Teachers can manage assignments in their courses" ON assignments;
CREATE POLICY "Teachers can manage assignments in their courses"
  ON assignments FOR ALL
  USING (
    course_id IN (
      SELECT c.id FROM courses c
      JOIN teachers t ON c.teacher_id = t.id
      WHERE t.auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    course_id IN (
      SELECT c.id FROM courses c
      JOIN teachers t ON c.teacher_id = t.id
      WHERE t.auth_user_id = auth.uid()
    )
  );

-- Students: teachers need to insert students during sync
CREATE POLICY "Teachers can insert students"
  ON students FOR INSERT
  WITH CHECK (true);
