import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";

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

  // Verify submission belongs to this user
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

  const formData = await request.formData();
  const photos: { id: string; storagePath: string }[] = [];

  // Clean up any old pending/processing photos from previous upload attempts
  const { data: stalePhotos } = await supabase
    .from("submission_photos")
    .select("id, storage_path, status")
    .eq("submission_id", submissionId)
    .in("status", ["pending", "processing"]);

  if (stalePhotos && stalePhotos.length > 0) {
    // Delete storage files for stale photos
    const pathsToDelete = stalePhotos
      .map((p) => p.storage_path)
      .filter(Boolean);
    if (pathsToDelete.length > 0) {
      await supabase.storage.from("submission-photos").remove(pathsToDelete);
    }
    // Delete DB records
    await supabase
      .from("submission_photos")
      .delete()
      .in("id", stalePhotos.map((p) => p.id));
  }

  // Start page numbering after any remaining (completed) photos
  const { data: existingPhotos } = await supabase
    .from("submission_photos")
    .select("page_number")
    .eq("submission_id", submissionId)
    .order("page_number", { ascending: false })
    .limit(1);

  let pageNumber = (existingPhotos?.[0]?.page_number ?? 0) + 1;

  for (const [, value] of formData.entries()) {
    if (!(value instanceof File)) continue;

    const ext = value.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const storagePath = `${user.id}/${submissionId}/${pageNumber}.${ext}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("submission-photos")
      .upload(storagePath, value, {
        contentType: value.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      continue;
    }

    // Create photo record
    const { data: photo } = await supabase
      .from("submission_photos")
      .insert({
        submission_id: submissionId,
        page_number: pageNumber,
        storage_path: storagePath,
        status: "pending",
      })
      .select("id")
      .single();

    if (photo) {
      photos.push({ id: photo.id, storagePath });
    }

    pageNumber++;
  }

  // Update submission status to processing
  await supabase
    .from("submissions")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", submissionId);

  // Trigger transcription for each photo
  for (const photo of photos) {
    await inngest.send({
      name: "photo.uploaded",
      data: {
        photoId: photo.id,
        submissionId,
        storagePath: photo.storagePath,
      },
    });
  }

  return NextResponse.json({ uploaded: photos.length });
}
