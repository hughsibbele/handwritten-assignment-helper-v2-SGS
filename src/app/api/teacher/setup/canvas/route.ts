import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { testCanvasConnection } from "@/lib/canvas/connection";
import { z } from "zod";

const bodySchema = z.object({
  canvasBaseUrl: z.string().url(),
  canvasApiToken: z.string().min(1),
});

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Phase 0b: teachers allowlist gate. Closes the "any signed-in EHS user
  // can self-promote to teacher" hole. Allowlist managed via /admin or
  // direct SQL by an admin (teachers_allowlist table seeded with existing
  // teachers in migration 025).
  const callerEmail = user.email.toLowerCase();
  const admin = createAdminClient();
  const { data: allowed } = await admin
    .from("teachers_allowlist")
    .select("email, active")
    .eq("email", callerEmail)
    .maybeSingle();
  if (!allowed || !allowed.active) {
    return NextResponse.json(
      {
        error: "not_a_teacher",
        message:
          "Your account isn't on the teacher allowlist. Ask an admin to add you in the admin dashboard, then try again.",
      },
      { status: 403 },
    );
  }

  // Phase 0b: role conflict — refuse to upsert teachers if this auth user
  // already has a students row. A user is a student xor a teacher.
  const { data: existingStudent } = await admin
    .from("students")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (existingStudent) {
    return NextResponse.json(
      {
        error: "role_conflict",
        message:
          "This account is already registered as a student. Sign in with a different account to use the teacher dashboard.",
      },
      { status: 409 },
    );
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const canvasBaseUrl = parsed.data.canvasBaseUrl.replace(/\/+$/, "");
  const canvasApiToken = parsed.data.canvasApiToken;

  const test = await testCanvasConnection(canvasBaseUrl, canvasApiToken);
  if (!test.ok) {
    return NextResponse.json({ error: test.error }, { status: 400 });
  }

  // Upsert teacher record
  const { error } = await supabase.from("teachers").upsert(
    {
      auth_user_id: user.id,
      email: user.email!,
      display_name:
        user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "Teacher",
      canvas_base_url: canvasBaseUrl,
      canvas_api_token: canvasApiToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "auth_user_id" }
  );

  if (error) {
    return NextResponse.json(
      { error: "Failed to save teacher config" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
