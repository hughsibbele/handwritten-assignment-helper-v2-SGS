import { NextResponse } from "next/server";
import { getServerDbClient } from "@/lib/supabase/server";
// Admin client required: bulk upserts creating student/enrollment records for other users
import { createAdminDbClient } from "@/lib/supabase/admin";
import { CanvasClient } from "@/lib/canvas/client";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: courseId } = await params;
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminDbClient();

  // Get course with teacher's Canvas credentials
  const { data: course } = await admin
    .from("courses")
    .select(
      `id, canvas_course_id,
       teachers!inner ( auth_user_id, canvas_base_url, canvas_api_token )`
    )
    .eq("id", courseId)
    .single();

  if (!course) {
    return NextResponse.json({ error: "Course not found" }, { status: 404 });
  }

  const teacher = course.teachers as unknown as {
    auth_user_id: string;
    canvas_base_url: string | null;
    canvas_api_token: string | null;
  };

  if (teacher.auth_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!teacher.canvas_base_url || !teacher.canvas_api_token) {
    return NextResponse.json(
      { error: "Canvas not configured" },
      { status: 400 }
    );
  }

  const canvas = new CanvasClient(
    teacher.canvas_base_url,
    teacher.canvas_api_token
  );

  // Sync assignments
  const canvasAssignments = await canvas.getAssignments(
    course.canvas_course_id
  );
  let assignmentCount = 0;
  for (const ca of canvasAssignments) {
    if (!ca.published) continue;
    await admin.from("assignments").upsert(
      {
        course_id: courseId,
        canvas_assignment_id: ca.id,
        title: ca.name,
        description: ca.description ?? null,
        due_date: ca.due_at ?? null,
        points_possible: ca.points_possible ?? null,
        canvas_submission_types: ca.submission_types ?? null,
        canvas_discussion_topic_id: ca.discussion_topic?.id ?? null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "course_id,canvas_assignment_id" }
    );
    assignmentCount++;
  }

  // Sync students
  const canvasStudents = await canvas.getStudents(course.canvas_course_id);
  let studentCount = 0;
  for (const cs of canvasStudents) {
    const { data: student } = await admin
      .from("students")
      .upsert(
        {
          canvas_user_id: cs.id,
          email: cs.email ?? cs.login_id ?? null,
          display_name: cs.name,
        },
        { onConflict: "canvas_user_id", ignoreDuplicates: false }
      )
      .select("id")
      .single();

    const studentId =
      student?.id ??
      (
        await admin
          .from("students")
          .select("id")
          .eq("canvas_user_id", cs.id)
          .single()
      ).data?.id;

    if (studentId) {
      await admin.from("enrollments").upsert(
        {
          course_id: courseId,
          student_id: studentId,
        },
        { onConflict: "course_id,student_id" }
      );
      studentCount++;
    }
  }

  // Update last_synced_at on the course
  await admin
    .from("courses")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("id", courseId);

  return NextResponse.json({ assignmentCount, studentCount });
}
