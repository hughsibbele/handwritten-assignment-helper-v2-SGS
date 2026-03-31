import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: courseId } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Verify this course belongs to the teacher
  const { data: course } = await admin
    .from("courses")
    .select(
      `id, name, short_name, term,
       teachers!inner ( auth_user_id )`
    )
    .eq("id", courseId)
    .single();

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const teacher = course.teachers as unknown as { auth_user_id: string };
  if (teacher.auth_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: assignments } = await admin
    .from("assignments")
    .select(
      "id, title, due_date, canvas_submit_by_default, canvas_submission_types, canvas_discussion_topic_id"
    )
    .eq("course_id", courseId)
    .eq("is_active", true)
    .order("due_date", { ascending: true, nullsFirst: false });

  const { count } = await admin
    .from("enrollments")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId)
    .eq("is_active", true);

  return NextResponse.json({
    course: {
      id: course.id,
      name: course.name,
      short_name: course.short_name,
      term: course.term,
    },
    assignments: assignments ?? [],
    studentCount: count ?? 0,
  });
}
