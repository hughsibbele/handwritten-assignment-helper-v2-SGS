-- Track resubmission attempts (attempt 1 = first submission)
ALTER TABLE submissions ADD COLUMN attempt_number INT NOT NULL DEFAULT 1;
