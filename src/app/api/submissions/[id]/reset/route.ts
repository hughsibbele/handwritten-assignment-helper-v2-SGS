import { NextResponse } from "next/server";
import { getServerDbClient } from "@/lib/supabase/server";
import { createAdminDbClient } from "@/lib/supabase/admin";
import { z } from "zod";

const bodySchema = z.object({
  mode: z.enum(["reset", "resubmit"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: submissionId } = await params;
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

  const admin = createAdminDbClient();

  // Fetch submission and verify ownership
  const { data: submission } = await admin
    .from("submissions")
    .select(
      "id, status, attempt_number, student_id, students!inner(auth_user_id)"
    )
    .eq("id", submissionId)
    .single();

  if (!submission) {
    return NextResponse.json(
      { error: "Submission not found" },
      { status: 404 }
    );
  }

  const student = submission.students as unknown as { auth_user_id: string };
  if (student.auth_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { mode } = parsed.data;
  const inProgress = ["draft", "processing", "review"].includes(
    submission.status
  );
  const isDone = ["confirmed", "submitted"].includes(submission.status);

  if (mode === "reset" && !inProgress) {
    return NextResponse.json(
      { error: "Can only reset in-progress submissions" },
      { status: 400 }
    );
  }

  if (mode === "resubmit" && !isDone) {
    return NextResponse.json(
      { error: "Can only resubmit confirmed/submitted submissions" },
      { status: 400 }
    );
  }

  // Delete existing photos from storage and DB
  const { data: photos } = await admin
    .from("submission_photos")
    .select("id, storage_path")
    .eq("submission_id", submissionId);

  if (photos && photos.length > 0) {
    const pathsToDelete = photos
      .map((p) => p.storage_path)
      .filter(Boolean) as string[];
    if (pathsToDelete.length > 0) {
      await admin.storage.from("submission-photos").remove(pathsToDelete);
    }
    await admin
      .from("submission_photos")
      .delete()
      .in(
        "id",
        photos.map((p) => p.id)
      );
  }

  // Reset the submission row
  const updates: Record<string, unknown> = {
    status: "draft",
    transcription_text: null,
    updated_at: new Date().toISOString(),
  };

  if (mode === "resubmit") {
    updates.attempt_number = (submission.attempt_number ?? 1) + 1;
    updates.gdoc_id = null;
    updates.gdoc_url = null;
    updates.canvas_submission_id = null;
    updates.canvas_submission_url = null;
    updates.confirmed_at = null;
    updates.submitted_to_canvas_at = null;
    updates.submit_to_canvas = false;
  }

  const { error: updateError } = await admin
    .from("submissions")
    .update(updates)
    .eq("id", submissionId);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to reset submission" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    submission: {
      id: submissionId,
      status: "draft",
      attempt_number:
        mode === "resubmit"
          ? (submission.attempt_number ?? 1) + 1
          : submission.attempt_number ?? 1,
    },
  });
}
