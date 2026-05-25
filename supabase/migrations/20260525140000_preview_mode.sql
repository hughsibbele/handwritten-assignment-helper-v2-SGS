-- M7.11 — per-assignment preview mode for teachers.

alter table submissions
  add column is_preview boolean not null default false;

-- One active preview per teacher per assignment. Teacher is resolved via
-- assignment → course → teacher. The partial unique enforces at most one
-- preview submission per assignment (teacher is implicit through ownership).
create unique index submissions_preview_unique
  on submissions (assignment_id)
  where is_preview = true;
