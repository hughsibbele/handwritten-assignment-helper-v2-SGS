-- Assignments (synced from Canvas)
CREATE TABLE assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  canvas_assignment_id BIGINT,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  points_possible NUMERIC,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(course_id, canvas_assignment_id)
);

CREATE INDEX idx_assignments_course ON assignments(course_id);

ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage assignments in their courses"
  ON assignments FOR ALL
  USING (
    course_id IN (
      SELECT c.id FROM courses c
      JOIN teachers t ON c.teacher_id = t.id
      WHERE t.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Students can view assignments in enrolled courses"
  ON assignments FOR SELECT
  USING (
    course_id IN (
      SELECT e.course_id FROM enrollments e
      JOIN students s ON e.student_id = s.id
      WHERE s.auth_user_id = auth.uid()
    )
  );
