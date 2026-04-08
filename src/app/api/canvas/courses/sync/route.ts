import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
// Admin client required: bulk upserts creating student/enrollment records for other users
import { createAdminClient } from "@/lib/supabase/admin";
import { CanvasClient } from "@/lib/canvas/client";
import { z } from "zod";

const bodySchema = z.object({
  courses: z.array(
    z.object({
      id: z.number(),
      shortName: z.string().min(1),
    })
  ).min(1),
});

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
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
      { error: "Provide courseIds array" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: teacher } = await admin
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
  const selectedCourses = new Map(
    parsed.data.courses.map((c) => [c.id, c.shortName])
  );

  try {
    const canvasCourses = await canvas.getCourses();
    const synced = [];

    for (const cc of canvasCourses) {
      if (!selectedCourses.has(cc.id)) continue;

      const shortName = selectedCourses.get(cc.id)!;
      const joinCode = `${cc.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}-${cc.id}`.toUpperCase();

      const { data: course, error: courseError } = await admin
        .from("courses")
        .upsert(
          {
            teacher_id: teacher.id,
            canvas_course_id: cc.id,
            name: cc.name,
            short_name: shortName,
            term: cc.term?.name ?? null,
            join_code: joinCode,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "teacher_id,canvas_course_id" }
        )
        .select("id")
        .single();

      if (courseError || !course) {
        console.error(`Course upsert failed for "${cc.name}":`, courseError);
        continue;
      }

      // Sync assignments
      const canvasAssignments = await canvas.getAssignments(cc.id);
      for (const ca of canvasAssignments) {
        if (!ca.published) continue;
        await admin.from("assignments").upsert(
          {
            course_id: course.id,
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
      }

      // Sync students
      const canvasStudents = await canvas.getStudents(cc.id);
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
              course_id: course.id,
              student_id: studentId,
            },
            { onConflict: "course_id,student_id" }
          );
        }
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
