-- Super-grader satellite integration: anonymization at the egress boundary
-- + an audit field for the exact text we POST to Canvas.

-- HMAC-derived stable token, computed in Node from canvas_user_id + email +
-- SUPER_GRADER_SALT. Nullable because we backfill lazily (Google-SSO students
-- arrive without canvas_user_id resolved). UNIQUE so collisions surface loudly.
ALTER TABLE students
  ADD COLUMN anon_token TEXT UNIQUE;

-- The exact text we sent to Canvas — including the sentinel marker prefix —
-- so the /api/super-grader/result endpoint can return canvas_submission_text
-- without re-deriving it from current state.
ALTER TABLE submissions
  ADD COLUMN canvas_submission_text TEXT;
