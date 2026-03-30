-- Policies that reference tables created in later migrations.
-- Split out to avoid forward-reference errors.

-- Students can view courses they are enrolled in
CREATE POLICY "Students can view enrolled courses"
  ON courses FOR SELECT
  USING (
    id IN (
      SELECT e.course_id FROM enrollments e
      JOIN students s ON e.student_id = s.id
      WHERE s.auth_user_id = auth.uid()
    )
  );

-- Teachers can view students enrolled in their courses
CREATE POLICY "Teachers can view students in their courses"
  ON students FOR SELECT
  USING (
    id IN (
      SELECT e.student_id FROM enrollments e
      JOIN courses c ON e.course_id = c.id
      JOIN teachers t ON c.teacher_id = t.id
      WHERE t.auth_user_id = auth.uid()
    )
  );
