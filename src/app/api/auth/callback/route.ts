import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      const userId = data.session.user.id;
      const userEmail = data.session.user.email;
      const providerToken = data.session.provider_token;
      const providerRefreshToken = data.session.provider_refresh_token;

      if (providerToken && userEmail) {
        // Use admin client — RLS can't find students with null auth_user_id
        const admin = createAdminClient();

        // Try to find student by auth_user_id first, then by email
        const { data: studentById } = await admin
          .from("students")
          .select("id")
          .eq("auth_user_id", userId)
          .single();

        let studentId = studentById?.id;

        if (!studentId) {
          // Match by email (Canvas-synced students have email but no auth_user_id)
          const { data: studentByEmail } = await admin
            .from("students")
            .select("id, auth_user_id")
            .eq("email", userEmail)
            .single();

          if (studentByEmail) {
            studentId = studentByEmail.id;

            // Link the auth user to this Canvas student record
            if (!studentByEmail.auth_user_id) {
              await admin
                .from("students")
                .update({
                  auth_user_id: userId,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", studentId);
            }
          }
        }

        // Save Google tokens if we found a student record
        if (studentId) {
          await admin
            .from("students")
            .update({
              google_access_token: providerToken,
              google_refresh_token: providerRefreshToken ?? undefined,
              google_token_expires_at: new Date(
                Date.now() + 3600 * 1000
              ).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", studentId);
        }
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
