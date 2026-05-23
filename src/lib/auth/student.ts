import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getServerDbClient } from "@/lib/supabase/server";

/**
 * Shape of the `students` row. Matches the migration schema; HAH doesn't
 * generate Database types yet (M5 follow-up).
 */
export type Student = {
  id: string;
  auth_user_id: string | null;
  email: string;
  display_name: string;
  canvas_user_id: number | null;
  google_sub: string | null;
  google_access_token: string | null;
  google_refresh_token: string | null;
  google_access_token_encrypted: string | null;
  google_refresh_token_encrypted: string | null;
  google_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Read the current auth session + join to the students row. Returns null
 * when there's no student row (e.g. they're a teacher, or a brand-new
 * EHS user who hasn't been Canvas-roster-synced yet and hasn't joined
 * via a class code). Redirects to /login when there's no session.
 *
 * Memoized per render via React's `cache()`.
 *
 * Mirrors AID's `getCurrentStudent()` shape (M4.11c). HAH-specific:
 * we don't auto-redirect on no-row because the join-via-class-code
 * flow needs callers (layout / page) to handle that path themselves.
 */
export const getCurrentStudent = cache(async (): Promise<Student | null> => {
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: student } = await supabase
    .from("students")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  return student as unknown as Student | null;
});
