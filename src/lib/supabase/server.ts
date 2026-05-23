import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Build a request-scoped Supabase client that uses the caller's cookies
 * (RLS as the signed-in user). Named to match the suite-wide convention
 * (AID's `getServerDbClient`), renamed from `createServerSupabase` 2026-05-22
 * as part of M4.13.
 */
export async function getServerDbClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll can be called from Server Components where cookies
            // can't be set. This is fine — the proxy handles refresh.
          }
        },
      },
    }
  );
}
