import { google } from "googleapis";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Returns an authenticated OAuth2 client for a student, refreshing the
 * access token if it's expired. Updates the DB with new tokens on refresh.
 */
export async function getStudentGoogleClient(studentId: string) {
  const supabase = createAdminClient();

  const { data: student, error } = await supabase
    .from("students")
    .select(
      "google_access_token, google_refresh_token, google_token_expires_at"
    )
    .eq("id", studentId)
    .single();

  if (error || !student?.google_access_token) {
    throw new Error("Student has no Google tokens — they need to re-login");
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  client.setCredentials({
    access_token: student.google_access_token,
    refresh_token: student.google_refresh_token ?? undefined,
  });

  // Refresh if token expires in the next 5 minutes
  const expiresAt = student.google_token_expires_at
    ? new Date(student.google_token_expires_at).getTime()
    : 0;
  const needsRefresh = expiresAt - Date.now() < 5 * 60 * 1000;

  if (needsRefresh && student.google_refresh_token) {
    const { credentials } = await client.refreshAccessToken();
    client.setCredentials(credentials);

    // Persist the new tokens
    await supabase
      .from("students")
      .update({
        google_access_token: credentials.access_token,
        google_refresh_token:
          credentials.refresh_token ?? student.google_refresh_token,
        google_token_expires_at: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : new Date(Date.now() + 3600 * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", studentId);
  }

  return client;
}
