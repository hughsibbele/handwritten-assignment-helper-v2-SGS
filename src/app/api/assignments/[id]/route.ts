import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const patchSchema = z.object({
  canvas_submit_by_default: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: assignmentId } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify this assignment belongs to a course owned by this teacher
  const { data: assignment } = await admin
    .from("assignments")
    .select("id, courses!inner(teacher_id, teachers!inner(auth_user_id))")
    .eq("id", assignmentId)
    .single();

  if (!assignment) {
    return NextResponse.json(
      { error: "Assignment not found" },
      { status: 404 }
    );
  }

  const course = assignment.courses as unknown as {
    teacher_id: string;
    teachers: { auth_user_id: string };
  };
  if (course.teachers.auth_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error } = await admin
    .from("assignments")
    .update({
      ...parsed.data,
    })
    .eq("id", assignmentId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to update assignment" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
