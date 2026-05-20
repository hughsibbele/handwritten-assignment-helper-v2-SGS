-- M6.18b: 3-checkbox deliverable-destination picker.
--
-- Replaces the single `assignments.canvas_submit_by_default` boolean with
-- three independent booleans:
--   - post_to_drive             (default true; HAH's core feature — locked-on in UI)
--   - post_to_canvas_comment    (default false; HAH doesn't post comments yet, picker stores intent)
--   - post_to_canvas_submission (default true; preserves HAH's "auto-submit" muscle memory)
--
-- Backfill from the legacy column: post_to_canvas_submission =
-- canvas_submit_by_default. The legacy column stays for one cycle as a
-- rollback safety net (writers keep it in sync); drops in a follow-up
-- migration.

ALTER TABLE public.assignments
  ADD COLUMN post_to_drive BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN post_to_canvas_comment BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN post_to_canvas_submission BOOLEAN NOT NULL DEFAULT true;

UPDATE public.assignments
SET post_to_canvas_submission = canvas_submit_by_default;

COMMENT ON COLUMN public.assignments.post_to_drive IS
  'M6.18b: handwritten transcript lands as a Google Doc in the student''s Drive. Always on for HAH today — locked-on in the dashboard picker.';
COMMENT ON COLUMN public.assignments.post_to_canvas_comment IS
  'M6.18b: transcript lands as a draft submission comment in SpeedGrader. Writer not yet implemented for HAH — picker stores intent for when M6.18b-followup ships the writer.';
COMMENT ON COLUMN public.assignments.post_to_canvas_submission IS
  'M6.18b: transcript IS the student submission body (or discussion reply on discussion-topic assignments). Replaces canvas_submit_by_default.';
COMMENT ON COLUMN public.assignments.canvas_submit_by_default IS
  'DEPRECATED 2026-05-20: replaced by post_to_canvas_submission. Kept for one cycle as a rollback safety net; writers keep it in sync. Drop in a follow-up migration.';
