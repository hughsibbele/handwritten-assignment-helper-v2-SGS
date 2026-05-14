-- Create storage bucket for submission photos.
-- Idempotent so re-running this migration after a public-schema reset
-- doesn't trip the storage table's protect_delete / unique constraints.
INSERT INTO storage.buckets (id, name, public)
VALUES ('submission-photos', 'submission-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to their own folder
DROP POLICY IF EXISTS "Users can upload own photos" ON storage.objects;
CREATE POLICY "Users can upload own photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'submission-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow authenticated users to read their own photos
DROP POLICY IF EXISTS "Users can read own photos" ON storage.objects;
CREATE POLICY "Users can read own photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'submission-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Allow service role to read all photos (for Inngest background jobs)
-- This is handled automatically by the service role key which bypasses RLS
