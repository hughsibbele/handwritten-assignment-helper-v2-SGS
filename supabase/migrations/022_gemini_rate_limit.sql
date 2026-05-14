-- Per-teacher daily Gemini call cap. Protects against runaway costs from a
-- single classroom (retry storms, accidental bulk re-runs) without blocking
-- legitimate use. Defaults to GEMINI_DEFAULT_DAILY_CAP env (or 1000 if unset).

-- Per-teacher override. NULL falls back to the env default.
ALTER TABLE teachers
  ADD COLUMN gemini_daily_cap INT;

-- One row per (teacher, date). Atomic increment via the function below.
CREATE TABLE public.gemini_usage_daily (
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  date       DATE NOT NULL,
  calls      INT  NOT NULL DEFAULT 0,
  denials    INT  NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, date)
);

ALTER TABLE public.gemini_usage_daily ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gemini_usage_daily TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gemini_usage_daily TO service_role;

-- Teachers can read their own usage (for a future /admin/usage view); writes
-- happen only via the SECURITY DEFINER function below or via service_role.
CREATE POLICY "Teachers can read own usage"
  ON public.gemini_usage_daily FOR SELECT
  TO authenticated
  USING (teacher_id = auth_teacher_id());

-- Atomic check-and-increment. Returns true if the call is allowed (and was
-- counted), false if the cap was hit (and a denial was counted). FOR UPDATE
-- locks the row so concurrent students of the same teacher can't both
-- squeak past the cap by reading-then-writing without a lock.
--
-- Fail-open semantics live in the application layer: if this function
-- raises (DB down, bad arg), the caller treats that as "allowed." We'd
-- rather over-serve a student than block them on a rate-limiter glitch.
CREATE OR REPLACE FUNCTION check_and_increment_gemini_call(
  p_teacher_id UUID,
  p_default_cap INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap      INT;
  v_calls    INT;
  v_today    DATE := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  -- Per-teacher override beats env default. NULL means "use the default."
  SELECT COALESCE(gemini_daily_cap, p_default_cap)
    INTO v_cap
    FROM teachers
   WHERE id = p_teacher_id;

  IF v_cap IS NULL THEN
    -- No cap row at all (no env default passed in either) — fail open.
    RETURN TRUE;
  END IF;

  -- Read or seed the row, holding the lock through the increment.
  INSERT INTO gemini_usage_daily (teacher_id, date, calls, denials)
       VALUES (p_teacher_id, v_today, 0, 0)
  ON CONFLICT (teacher_id, date) DO NOTHING;

  SELECT calls
    INTO v_calls
    FROM gemini_usage_daily
   WHERE teacher_id = p_teacher_id
     AND date = v_today
     FOR UPDATE;

  IF v_calls >= v_cap THEN
    UPDATE gemini_usage_daily
       SET denials = denials + 1,
           updated_at = now()
     WHERE teacher_id = p_teacher_id AND date = v_today;
    RETURN FALSE;
  END IF;

  UPDATE gemini_usage_daily
     SET calls = calls + 1,
         updated_at = now()
   WHERE teacher_id = p_teacher_id AND date = v_today;
  RETURN TRUE;
END;
$$;

-- Per the project migration template: explicit grants on the new public-
-- schema function. anon never reaches HAH so we don't grant to it, and we
-- can't rely on Supabase's auto-grant-to-anon behavior being correct here.
REVOKE EXECUTE ON FUNCTION check_and_increment_gemini_call(UUID, INT) FROM anon;
GRANT EXECUTE ON FUNCTION check_and_increment_gemini_call(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION check_and_increment_gemini_call(UUID, INT) TO service_role;
