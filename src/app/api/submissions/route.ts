import { NextResponse } from "next/server";
import { getServerDbClient } from "@/lib/supabase/server";
import { z } from "zod";

const bodySchema = z.object({
  assignmentId: z.string().uuid(),
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
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Get student record
  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Check for existing submission
  const { data: existing } = await supabase
    .from("submissions")
    .select("id, status, attempt_number")
    .eq("assignment_id", parsed.data.assignmentId)
    .eq("student_id", student.id)
    .single();

  if (existing) {
    return NextResponse.json({ submission: existing });
  }

  // Create new submission
  const { data: submission, error } = await supabase
    .from("submissions")
    .insert({
      assignment_id: parsed.data.assignmentId,
      student_id: student.id,
      status: "draft",
    })
    .select("id, status")
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create submission" },
      { status: 500 }
    );
  }

  return NextResponse.json({ submission });
}
