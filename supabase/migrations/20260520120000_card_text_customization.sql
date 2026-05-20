-- M6.15: per-teacher Canvas card text customization.
--
-- Admin sets system defaults for the 5 strings inside the branded card
-- (kicker / title / body / cta label / footnote). Teachers override any
-- subset on their own row; effective value = teacher override ?? system
-- default ?? package fallback in @/lib/canvas/install. Per-assignment
-- variation is NOT supported — the card text is a global per-teacher knob.
--
-- Ports OE's 20260518040000_card_text_customization shape verbatim, with
-- HAH-specific seeded defaults reflecting the upload flow.

-- Singleton table for admin defaults. Mirrors the kind-of-singleton pattern
-- used in OE's safety_envelope (id=1, CHECK pinned).
CREATE TABLE public.card_text_defaults (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  kicker TEXT NOT NULL DEFAULT 'Handwritten work · Upload to submit',
  title TEXT NOT NULL DEFAULT 'Submit your handwritten work',
  body TEXT NOT NULL DEFAULT 'Take clear photos of each page, then upload them here. We''ll transcribe your work, save it as a Google Doc in your Drive, and (when your teacher has it turned on) submit the transcript to Canvas for you.',
  cta_label TEXT NOT NULL DEFAULT 'Upload handwritten work →',
  footnote TEXT NOT NULL DEFAULT 'Sign in with your @episcopalhighschool.org Google account.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.card_text_defaults (id) VALUES (1);

-- Per-table updated_at trigger function — HAH doesn't carry a shared
-- set_updated_at() function, so keep this migration self-contained.
CREATE OR REPLACE FUNCTION card_text_defaults_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER card_text_defaults_updated_at
  BEFORE UPDATE ON public.card_text_defaults
  FOR EACH ROW EXECUTE FUNCTION card_text_defaults_touch_updated_at();

ALTER TABLE public.card_text_defaults ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_text_defaults TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.card_text_defaults TO service_role;
-- intentionally NO grant to anon — HAH is authenticated-only.

-- Any signed-in user can read the defaults (the install path needs them to
-- compose the effective card text). Admin-only write.
CREATE POLICY card_text_defaults_read ON public.card_text_defaults
  FOR SELECT TO authenticated USING (true);

CREATE POLICY card_text_defaults_admin_write ON public.card_text_defaults
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Per-teacher overrides. Each column is nullable; null = inherit from
-- card_text_defaults. The install path reads both and resolves at PUT time,
-- so changing a default propagates to next install for every teacher who
-- hasn't overridden the field.
ALTER TABLE public.teachers
  ADD COLUMN card_kicker TEXT,
  ADD COLUMN card_title TEXT,
  ADD COLUMN card_body TEXT,
  ADD COLUMN card_cta_label TEXT,
  ADD COLUMN card_footnote TEXT;

COMMENT ON COLUMN public.teachers.card_kicker IS
  'M6.15: optional teacher override for the card''s top "HANDWRITTEN WORK · UPLOAD TO SUBMIT" kicker.';
COMMENT ON COLUMN public.teachers.card_title IS
  'M6.15: optional teacher override for the card''s h3 title.';
COMMENT ON COLUMN public.teachers.card_body IS
  'M6.15: optional teacher override for the card''s body paragraph.';
COMMENT ON COLUMN public.teachers.card_cta_label IS
  'M6.15: optional teacher override for the CTA button label.';
COMMENT ON COLUMN public.teachers.card_footnote IS
  'M6.15: optional teacher override for the card''s italic footnote.';
