import { google } from "googleapis";
// Admin client required: reads any student's tokens (caller may be teacher/system context)
import { createAdminDbClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret";

/**
 * Returns an authenticated OAuth2 client for a student, refreshing the
 * access token if it's expired. Updates the DB with new tokens on refresh.
 *
 * Phase 0c of REMEDIATION_PLAN.md: tokens are AES-256-GCM encrypted at
 * rest. Read order: encrypted column first, fall back to legacy plaintext
 * column for rows that predate the encryption migration. Refreshed tokens
 * are always written encrypted; the matching plaintext column is nulled
 * so we don't accumulate plaintext on every refresh.
 */
export async function getStudentGoogleClient(studentId: string) {
  const supabase = createAdminDbClient();

  const { data: student, error } = await supabase
    .from("students")
    .select(
      [
        "google_access_token",
        "google_refresh_token",
        "google_access_token_encrypted",
        "google_refresh_token_encrypted",
        "google_token_expires_at",
      ].join(", ")
    )
    .eq("id", studentId)
    .single();

  if (error || !student) {
    throw new Error("Student has no Google tokens — they need to re-login");
  }

  const row = student as unknown as {
    google_access_token: string | null;
    google_refresh_token: string | null;
    google_access_token_encrypted: string | null;
    google_refresh_token_encrypted: string | null;
    google_token_expires_at: string | null;
  };

  const accessToken = row.google_access_token_encrypted
    ? decryptSecret(row.google_access_token_encrypted)
    : row.google_access_token;
  const refreshToken = row.google_refresh_token_encrypted
    ? decryptSecret(row.google_refresh_token_encrypted)
    : row.google_refresh_token;

  if (!accessToken) {
    throw new Error("Student has no Google tokens — they need to re-login");
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken ?? undefined,
  });

  // Refresh if token expires in the next 5 minutes
  const expiresAt = row.google_token_expires_at
    ? new Date(row.google_token_expires_at).getTime()
    : 0;
  const needsRefresh = expiresAt - Date.now() < 5 * 60 * 1000;

  if (needsRefresh && refreshToken) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);

    // Persist the new tokens (encrypted). NULL the legacy plaintext
    // columns so we converge on encrypted-only without waiting for the
    // standalone backfill script.
    const newAccess = credentials.access_token
      ? encryptSecret(credentials.access_token)
      : row.google_access_token_encrypted;
    const newRefresh = credentials.refresh_token
      ? encryptSecret(credentials.refresh_token)
      : row.google_refresh_token_encrypted ??
        (refreshToken ? encryptSecret(refreshToken) : null);
    await supabase
      .from("students")
      .update({
        google_access_token_encrypted: newAccess,
        google_refresh_token_encrypted: newRefresh,
        google_access_token: null,
        google_refresh_token: null,
        google_token_expires_at: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : new Date(Date.now() + 3600 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", studentId);
  }

  return client;
}
