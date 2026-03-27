import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { CanvasClient } from "@/lib/canvas/client";

export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: teacher } = await supabase
    .from("teachers")
    .select("id, canvas_base_url, canvas_api_token")
    .eq("auth_user_id", user.id)
    .single();

  if (!teacher?.canvas_base_url || !teacher?.canvas_api_token) {
    return NextResponse.json(
      { error: "Canvas not configured" },
      { status: 400 }
    );
  }

  const canvas = new CanvasClient(
    teacher.canvas_base_url,
    teacher.canvas_api_token
  );

  try {
    const canvasCourses = await canvas.getCourses();
    const synced = [];

    for (const cc of canvasCourses) {
      // Generate a join code
      const joinCode = `${cc.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}-${cc.id}`.toUpperCase();

      const { data: course } = await supabase
        .from("courses")
        .upsert(
          {
            teacher_id: teacher.id,
            canvas_course_id: cc.id,
            name: cc.name,
            term: cc.term?.name ?? null,
            join_code: joinCode,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "teacher_id,canvas_course_id" }
        )
        .select("id")
        .single();

      if (!course) continue;

      // Sync assignments for this course
      const canvasAssignments = await canvas.getAssignments(cc.id);
      for (const ca of canvasAssignments) {
        if (!ca.published) continue;
        await supabase.from("assignments").upsert(
          {
            course_id: course.id,
            canvas_assignment_id: ca.id,
            title: ca.name,
            description: ca.description ?? null,
            due_date: ca.due_at ?? null,
            points_possible: ca.points_possible ?? null,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "course_id,canvas_assignment_id" }
        );
      }

      // Sync students for this course
      const canvasStudents = await canvas.getStudents(cc.id);
      for (const cs of canvasStudents) {
        // Upsert student
        const { data: student } = await supabase
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

        if (!student) {
          // Try to find existing student by canvas_user_id
          const { data: existing } = await supabase
            .from("students")
            .select("id")
            .eq("canvas_user_id", cs.id)
            .single();

          if (existing) {
            await supabase.from("enrollments").upsert(
              {
                course_id: course.id,
                student_id: existing.id,
              },
              { onConflict: "course_id,student_id" }
            );
          }
          continue;
        }

        // Upsert enrollment
        await supabase.from("enrollments").upsert(
          {
            course_id: course.id,
            student_id: student.id,
          },
          { onConflict: "course_id,student_id" }
        );
      }

      synced.push({ id: cc.id, name: cc.name, term: cc.term?.name });
    }

    return NextResponse.json({ courses: synced });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to sync from Canvas",
      },
      { status: 500 }
    );
  }
}
