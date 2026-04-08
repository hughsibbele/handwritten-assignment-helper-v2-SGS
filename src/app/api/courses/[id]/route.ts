import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

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

  // RLS ensures only the owning teacher can see this course
  const { data: course } = await supabase
    .from("courses")
    .select("id, name, short_name, term")
    .eq("id", courseId)
    .single();

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const { data: assignments } = await supabase
    .from("assignments")
    .select(
      "id, title, due_date, canvas_submit_by_default, canvas_submission_types, canvas_discussion_topic_id"
    )
    .eq("course_id", courseId)
    .eq("is_active", true)
    .order("due_date", { ascending: true, nullsFirst: false });

  const { count } = await supabase
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
