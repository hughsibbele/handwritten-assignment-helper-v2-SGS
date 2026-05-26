import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getServerDbClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const supabase = await getServerDbClient();
  const cookieStore = await cookies();
  const hasRefreshToken = cookieStore.get("_grt")?.value === "1";

  const next = request.nextUrl.searchParams.get("next") ?? "/";
  const callbackUrl = new URL("/api/auth/callback", request.nextUrl.origin);
  callbackUrl.searchParams.set("next", next);

  const SCOPES = [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/documents",
  ].join(" ");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
      scopes: SCOPES,
      queryParams: {
        prompt: hasRefreshToken ? "select_account" : "consent",
        access_type: "offline",
      },
    },
  });

  if (error || !data.url) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("error", error?.message ?? "oauth_init_failed");
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(data.url);
}
