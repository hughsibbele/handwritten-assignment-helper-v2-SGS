-- Phase 0c of REMEDIATION_PLAN.md — encrypt student Google OAuth tokens
-- at rest. AES-256-GCM application-layer encryption mirroring AID's
-- @ai-documenter/crypto pattern. Key in STUDENT_GDRIVE_TOKEN_ENC_KEY env
-- var (operator-managed, separate from CANVAS_TOKEN_ENC_KEY for clean
-- rotation scope).
--
-- Closes audit-RLS HIGH-3 + audit-seams P0: previously the columns
-- google_access_token + google_refresh_token (migration 003) lived in
-- plaintext on a table whose teacher SELECT policy returns the whole row.
-- Any teacher (or self-promoted "teacher" from the pre-Phase-0b path)
-- could impersonate any student against Drive/Docs persistently via the
-- refresh token, and a backup/pg_dump leak = months of Drive access.
--
-- Transition shape:
--   * This migration adds nullable encrypted columns.
--   * Application code writes ONLY encrypted columns from now on.
--   * Read path: try encrypted column first, fall back to legacy plaintext
--     for rows that predate this migration.
--   * Backfill: a one-off Node script (documented in the Phase 0c commit)
--     reads each plaintext token, encrypts, writes the encrypted column,
--     and NULLs the plaintext. After backfill confirmed clean, a follow-up
--     migration DROPs the plaintext columns.

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS google_access_token_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS google_refresh_token_encrypted TEXT;

COMMENT ON COLUMN public.students.google_access_token_encrypted IS
  'Phase 0c: AES-256-GCM envelope (base64) of the OAuth access token. Decrypted at read time by src/lib/crypto/secret.ts using STUDENT_GDRIVE_TOKEN_ENC_KEY. Plaintext google_access_token kept for legacy rows during the transition; drop in a follow-up migration once backfill is complete.';

COMMENT ON COLUMN public.students.google_refresh_token_encrypted IS
  'Phase 0c: AES-256-GCM envelope (base64) of the OAuth refresh token. See google_access_token_encrypted.';
