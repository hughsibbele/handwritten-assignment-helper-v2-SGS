import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createServerSupabase();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      // Store the Google provider token for Drive/Docs access
      const providerToken = data.session.provider_token;
      const providerRefreshToken = data.session.provider_refresh_token;

      if (providerToken) {
        // Check if student record exists, create or update it
        const { data: existingStudent } = await supabase
          .from("students")
          .select("id")
          .eq("auth_user_id", data.session.user.id)
          .single();

        if (existingStudent) {
          await supabase
            .from("students")
            .update({
              google_access_token: providerToken,
              google_refresh_token: providerRefreshToken ?? undefined,
              google_token_expires_at: new Date(
                Date.now() + 3600 * 1000
              ).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingStudent.id);
        }
        // Student record will be created during enrollment sync from Canvas
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
