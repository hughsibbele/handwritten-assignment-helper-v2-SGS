import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { z } from "zod";

const bodySchema = z.object({
  transcriptionText: z.string().min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: submissionId } = await params;
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
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Verify submission belongs to user
  const { data: submission } = await supabase
    .from("submissions")
    .select("id, student_id, students!inner(auth_user_id)")
    .eq("id", submissionId)
    .single();

  if (!submission) {
    return NextResponse.json(
      { error: "Submission not found" },
      { status: 404 }
    );
  }

  // Update submission with confirmed text
  const { error } = await supabase
    .from("submissions")
    .update({
      transcription_text: parsed.data.transcriptionText,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to confirm submission" },
      { status: 500 }
    );
  }

  // TODO: Phase 2 — create Google Doc in student's Drive here
  // For now, just confirm the transcription

  return NextResponse.json({ success: true });
}
