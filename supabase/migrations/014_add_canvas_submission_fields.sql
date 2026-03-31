-- Teacher-set default: should students auto-submit to Canvas for this assignment?
ALTER TABLE assignments ADD COLUMN canvas_submit_by_default BOOLEAN NOT NULL DEFAULT false;

-- Canvas submission_types array (e.g. ["online_text_entry","online_url","online_upload"])
-- Used to check if Canvas will accept our submission type before attempting it.
ALTER TABLE assignments ADD COLUMN canvas_submission_types TEXT[];

-- For discussion-type assignments, the Canvas discussion topic ID
ALTER TABLE assignments ADD COLUMN canvas_discussion_topic_id BIGINT;

-- Student-level toggle per submission: submit this one to Canvas?
ALTER TABLE submissions ADD COLUMN submit_to_canvas BOOLEAN NOT NULL DEFAULT false;
