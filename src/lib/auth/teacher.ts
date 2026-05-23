import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getServerDbClient } from "@/lib/supabase/server";

/**
 * Shape of the `teachers` row. HAH doesn't generate Database types yet
 * (M5 follow-up); minimal hand-typed interface here so callers get
 * sensible IntelliSense without us forking on the missing tooling.
 */
export type Teacher = {
  id: string;
  auth_user_id: string | null;
  email: string;
  display_name: string;
  canvas_base_url: string | null;
  canvas_api_token: string | null;
  google_sub: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Read the current auth session + join to the teachers row. Returns null
 * when there's no teacher row for the signed-in user (e.g. they're a
 * student, or they're a brand-new EHS user who hasn't completed setup).
 * Redirects to /login when there's no session at all.
 *
 * Memoized per render via React's `cache()` so multiple components on
 * the same page can call this without piling up Supabase queries.
 *
 * Mirrors AID's `getCurrentTeacher()` shape (M4.11c). The key difference:
 * AID redirects to "/" on no-row; HAH lets the caller decide what to do
 * (the layout sends non-teachers to /student/dashboard; the setup page
 * needs to allow no-row callers in).
 */
export const getCurrentTeacher = cache(async (): Promise<Teacher | null> => {
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: teacher } = await supabase
    .from("teachers")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return teacher as unknown as Teacher | null;
});
