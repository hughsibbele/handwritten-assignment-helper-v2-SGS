-- Submissions (a student's work on an assignment)
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'processing', 'review', 'confirmed', 'submitted')),
  transcription_text TEXT,
  gdoc_id TEXT,
  gdoc_url TEXT,
  canvas_submission_id BIGINT,
  confirmed_at TIMESTAMPTZ,
  submitted_to_canvas_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(assignment_id, student_id)
);

CREATE INDEX idx_submissions_student ON submissions(student_id);
CREATE INDEX idx_submissions_assignment ON submissions(assignment_id);

ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can manage own submissions"
  ON submissions FOR ALL
  USING (
    student_id IN (
      SELECT s.id FROM students s WHERE s.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can view submissions in their courses"
  ON submissions FOR SELECT
  USING (
    assignment_id IN (
      SELECT a.id FROM assignments a
      JOIN courses c ON a.course_id = c.id
      JOIN teachers t ON c.teacher_id = t.id
      WHERE t.auth_user_id = auth.uid()
    )
  );
