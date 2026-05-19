-- Tracks which assignments currently have the HAH Canvas card installed.
-- Sister table (not a column on `assignments`) so we can carry install
-- metadata — when, by whom, the CTA URL embedded in the marker — without
-- bloating the sync-managed `assignments` row.
--
-- Lifecycle: install creates/upserts a row; uninstall deletes it.
-- ON DELETE CASCADE on the assignment FK means re-syncing a deleted Canvas
-- assignment also clears its install state automatically.

CREATE TABLE public.assignment_install_state (
  assignment_id     UUID PRIMARY KEY REFERENCES public.assignments(id) ON DELETE CASCADE,
  canvas_install_url TEXT NOT NULL,
  installed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  installed_by      UUID NOT NULL REFERENCES public.teachers(id) ON DELETE RESTRICT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assignment_install_state ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignment_install_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assignment_install_state TO service_role;

-- Teacher can manage install state for assignments in their own courses.
-- Joins via assignment → course → teacher.
CREATE POLICY "Teachers manage install state for own assignments"
  ON public.assignment_install_state FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.courses c ON c.id = a.course_id
      WHERE a.id = assignment_install_state.assignment_id
        AND c.teacher_id = auth_teacher_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.assignments a
      JOIN public.courses c ON c.id = a.course_id
      WHERE a.id = assignment_install_state.assignment_id
        AND c.teacher_id = auth_teacher_id()
    )
  );

-- Bump updated_at on UPDATEs (re-installs).
CREATE OR REPLACE FUNCTION public.bump_assignment_install_state_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bump_assignment_install_state_updated_at
  BEFORE UPDATE ON public.assignment_install_state
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_assignment_install_state_updated_at();
