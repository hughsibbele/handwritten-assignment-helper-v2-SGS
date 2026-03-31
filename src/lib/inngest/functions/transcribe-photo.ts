import { inngest } from "../client";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeImage } from "@/lib/gemini/transcribe";

export const transcribePhoto = inngest.createFunction(
  {
    id: "transcribe-photo",
    retries: 3,
    concurrency: { limit: 5 },
    triggers: [{ event: "photo.uploaded" }],
  },
  async ({ event, step }: { event: { data: { photoId: string; submissionId: string; storagePath: string } }; step: any }) => {
    const { photoId, submissionId, storagePath } = event.data;

    // Step 1: Mark as processing
    await step.run("mark-processing", async () => {
      const supabase = createAdminClient();
      await supabase
        .from("submission_photos")
        .update({
          status: "processing",
          processing_started_at: new Date().toISOString(),
        })
        .eq("id", photoId);
    });

    // Step 2: Download image from Supabase Storage
    const imageData = await step.run("download-image", async () => {
      const supabase = createAdminClient();
      const { data, error } = await supabase.storage
        .from("submission-photos")
        .download(storagePath);

      if (error || !data) {
        throw new Error(`Failed to download image: ${error?.message}`);
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      const ext = storagePath.split(".").pop()?.toLowerCase();
      const mimeTypes: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        webp: "image/webp",
        heic: "image/heic",
        heif: "image/heif",
      };
      const mimeType = mimeTypes[ext ?? ""] ?? "image/jpeg";

      return {
        base64: buffer.toString("base64"),
        mimeType,
      };
    });

    // Step 3: Transcribe with Gemini
    const transcription = await step.run("call-gemini", async () => {
      return await transcribeImage(imageData.base64, imageData.mimeType);
    });

    // Step 4: Save transcription
    await step.run("save-transcription", async () => {
      const supabase = createAdminClient();
      await supabase
        .from("submission_photos")
        .update({
          raw_transcription: transcription,
          status: "completed",
          processing_completed_at: new Date().toISOString(),
        })
        .eq("id", photoId);
    });

    // Step 5: Delete photo from storage (transcription is saved, original no longer needed)
    await step.run("delete-storage-file", async () => {
      const supabase = createAdminClient();
      await supabase.storage.from("submission-photos").remove([storagePath]);
      await supabase
        .from("submission_photos")
        .update({ storage_path: null })
        .eq("id", photoId);
    });

    // Step 6: Check if all photos in this submission are done
    await step.run("check-submission-complete", async () => {
      const supabase = createAdminClient();

      const { data: photos } = await supabase
        .from("submission_photos")
        .select("status, raw_transcription, page_number")
        .eq("submission_id", submissionId)
        .order("page_number");

      if (!photos) return;

      const allDone = photos.every(
        (p) => p.status === "completed" || p.status === "failed"
      );

      if (allDone) {
        const combined = photos
          .filter((p) => p.status === "completed" && p.raw_transcription)
          .map((p) => p.raw_transcription)
          .join("\n\n");

        await supabase
          .from("submissions")
          .update({
            transcription_text: combined,
            status: "review",
            updated_at: new Date().toISOString(),
          })
          .eq("id", submissionId);
      }
    });

    return { success: true, photoId };
  }
);
