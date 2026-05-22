import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Allow auth routes, public routes, and system-to-system endpoints (the
  // /api/super-grader/* GETs are bearer-auth'd at the route, not via session).
  //
  // Phase 0 of REMEDIATION_PLAN.md: the previous `/test-` + `/api/test-`
  // allow-list entries were removed alongside the deletion of
  // /api/test-transcribe — an unauthenticated public Gemini-spend endpoint.
  // Do NOT re-add prefix allow-lists for ad-hoc dev surfaces; gate them
  // behind /api/admin/* (which already requires isAdmin() per route).
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/inngest") ||
    pathname.startsWith("/api/super-grader") ||
    pathname === "/"
  ) {
    return supabaseResponse;
  }

  // Redirect unauthenticated users to login, preserving the original
  // pathname (and search) as ?next= so we can send them there after sign-in.
  if (!user) {
    const url = request.nextUrl.clone();
    const nextTarget =
      request.nextUrl.pathname + (request.nextUrl.search ?? "");
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(nextTarget)}`;
    return NextResponse.redirect(url);
  }

  // Admin routes: the admin check lives in /admin/layout.tsx + each
  // /api/admin/* route via isAdmin() in @/lib/auth/admin. The proxy stays
  // session-only here.

  // Allow teacher setup for any authenticated user (so they can become a teacher)
  // Protect other teacher routes to verified teachers only
  if (pathname.startsWith("/teacher") && !pathname.startsWith("/teacher/setup")) {
    const { data: teacher } = await supabase
      .from("teachers")
      .select("id")
      .eq("auth_user_id", user.id)
      .single();

    if (!teacher) {
      const url = request.nextUrl.clone();
      url.pathname = "/student/dashboard";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
