-- Create storage bucket for submission photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('submission-photos', 'submission-photos', false);

-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload own photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'submission-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow authenticated users to read their own photos
CREATE POLICY "Users can read own photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'submission-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow service role to read all photos (for Inngest background jobs)
-- This is handled automatically by the service role key which bypasses RLS
