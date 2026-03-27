-- Students
CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT,
  display_name TEXT NOT NULL,
  canvas_user_id BIGINT UNIQUE,

  -- Google OAuth tokens for Drive/Docs access
  google_access_token TEXT,
  google_refresh_token TEXT,
  google_token_expires_at TIMESTAMPTZ,

  -- Google Drive root folder for this student
  gdrive_root_folder_id TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_students_auth_user_id ON students(auth_user_id);
CREATE INDEX idx_students_canvas_user_id ON students(canvas_user_id);

ALTER TABLE students ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can read own row"
  ON students FOR SELECT
  USING (auth_user_id = auth.uid());

CREATE POLICY "Students can update own row"
  ON students FOR UPDATE
  USING (auth_user_id = auth.uid());

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
