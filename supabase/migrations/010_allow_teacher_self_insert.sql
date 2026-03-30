-- Allow any authenticated user to insert themselves as a teacher
CREATE POLICY "Users can register as teacher"
  ON teachers FOR INSERT
  WITH CHECK (auth_user_id = auth.uid());
