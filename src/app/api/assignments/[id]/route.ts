import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
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

  // RLS ensures only the owning teacher can see/update this assignment
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id")
    .eq("id", assignmentId)
    .single();

  if (!assignment) {
    return NextResponse.json(
      { error: "Assignment not found" },
      { status: 404 }
    );
  }

  const { error } = await supabase
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
