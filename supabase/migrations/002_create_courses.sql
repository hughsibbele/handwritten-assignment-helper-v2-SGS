-- Courses (synced from Canvas)
CREATE TABLE courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  canvas_course_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  term TEXT,
  join_code TEXT UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(teacher_id, canvas_course_id)
);

CREATE INDEX idx_courses_teacher ON courses(teacher_id);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can manage own courses"
  ON courses FOR ALL
  USING (
    teacher_id IN (
      SELECT t.id FROM teachers t WHERE t.auth_user_id = auth.uid()
    )
  );

-- Student policy added in 009_cross_table_policies.sql (depends on enrollments table)
