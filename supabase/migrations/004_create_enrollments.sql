-- Course enrollments (student <-> course)
CREATE TABLE enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  gdrive_folder_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(course_id, student_id)
);

CREATE INDEX idx_enrollments_student ON enrollments(student_id);
CREATE INDEX idx_enrollments_course ON enrollments(course_id);

ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own enrollments"
  ON enrollments FOR SELECT
  USING (
    student_id IN (
      SELECT s.id FROM students s WHERE s.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can manage enrollments in their courses"
  ON enrollments FOR ALL
  USING (
    course_id IN (
      SELECT c.id FROM courses c
      JOIN teachers t ON c.teacher_id = t.id
      WHERE t.auth_user_id = auth.uid()
    )
  );
