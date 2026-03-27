-- Teachers table
CREATE TABLE teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,

  -- Canvas API config
  canvas_base_url TEXT,
  canvas_api_token TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Teachers can read own row"
  ON teachers FOR SELECT
  USING (auth_user_id = auth.uid());

CREATE POLICY "Teachers can update own row"
  ON teachers FOR UPDATE
  USING (auth_user_id = auth.uid());
