-- Submission photos (individual pages)
CREATE TABLE submission_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  page_number INT NOT NULL DEFAULT 1,
  storage_path TEXT NOT NULL,
  raw_transcription TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_submission_photos_submission ON submission_photos(submission_id);

ALTER TABLE submission_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can manage own submission photos"
  ON submission_photos FOR ALL
  USING (
    submission_id IN (
      SELECT sub.id FROM submissions sub
      JOIN students s ON sub.student_id = s.id
      WHERE s.auth_user_id = auth.uid()
    )
  );

CREATE POLICY "Teachers can view photos in their courses"
  ON submission_photos FOR SELECT
  USING (
    submission_id IN (
      SELECT sub.id FROM submissions sub
      JOIN assignments a ON sub.assignment_id = a.id
      JOIN courses c ON a.course_id = c.id
      JOIN teachers t ON c.teacher_id = t.id
      WHERE t.auth_user_id = auth.uid()
    )
  );

-- Enable realtime for submission status updates
ALTER PUBLICATION supabase_realtime ADD TABLE submission_photos;
ALTER PUBLICATION supabase_realtime ADD TABLE submissions;
