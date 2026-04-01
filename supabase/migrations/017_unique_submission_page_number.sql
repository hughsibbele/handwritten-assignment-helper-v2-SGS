-- Prevent duplicate page numbers within a submission (caused by retried upload requests)

-- First, remove duplicates keeping only the first-inserted row per (submission_id, page_number)
DELETE FROM submission_photos
WHERE id NOT IN (
  SELECT DISTINCT ON (submission_id, page_number) id
  FROM submission_photos
  ORDER BY submission_id, page_number, created_at ASC
);

-- Add unique constraint
ALTER TABLE submission_photos
  ADD CONSTRAINT unique_submission_page UNIQUE (submission_id, page_number);
