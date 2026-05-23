import { NextResponse } from "next/server";
import { getServerDbClient } from "@/lib/supabase/server";
// Admin client required: student can't see unenrolled courses via RLS
import { createAdminDbClient } from "@/lib/supabase/admin";
import { z } from "zod";

const bodySchema = z.object({
  joinCode: z.string().min(1),
});

export async function POST(request: Request) {
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please enter a class code" },
      { status: 400 }
    );
  }

  const joinCode = parsed.data.joinCode.trim().toUpperCase();
  const admin = createAdminDbClient();

  // Look up course by join code
  const { data: course } = await admin
    .from("courses")
    .select("id, name, short_name, term")
    .eq("join_code", joinCode)
    .eq("is_active", true)
    .single();

  if (!course) {
    return NextResponse.json(
      { error: "Invalid class code. Check with your teacher and try again." },
      { status: 404 }
    );
  }

  // Find or create student record
  let { data: student } = await admin
    .from("students")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!student) {
    // Defensive: create student if auth callback didn't (shouldn't normally happen)
    const displayName =
      user.user_metadata?.full_name || user.email?.split("@")[0] || "Student";
    const { data: newStudent } = await admin
      .from("students")
      .insert({
        auth_user_id: user.id,
        email: user.email,
        display_name: displayName,
      })
      .select("id")
      .single();
    student = newStudent;
  }

  if (!student) {
    return NextResponse.json(
      { error: "Failed to create student record" },
      { status: 500 }
    );
  }

  // Upsert enrollment (idempotent — re-joining returns success)
  const { data: enrollment, error } = await admin
    .from("enrollments")
    .upsert(
      {
        course_id: course.id,
        student_id: student.id,
        is_active: true,
      },
      { onConflict: "course_id,student_id" }
    )
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to join course" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    course: {
      id: course.id,
      name: course.name,
      short_name: course.short_name,
    },
    enrollment: { id: enrollment.id },
  });
}
