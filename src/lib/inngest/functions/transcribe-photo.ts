import { inngest } from "../client";
// Admin client required: Inngest background job has no user session/auth cookies
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeImage } from "@/lib/gemini/transcribe";
import { checkAndIncrementGeminiCall } from "@/lib/gemini/rate-limit";
import {
  getScrubberForSubmission,
  RosterMissingError,
} from "@/lib/anonymizer/roster";

export const transcribePhoto = inngest.createFunction(
  {
    id: "transcribe-photo",
    retries: 3,
    concurrency: { limit: 5 },
    triggers: [{ event: "photo.uploaded" }],
  },
  async ({ event, step }: { event: { data: { photoId: string; submissionId: string; storagePath: string } }; step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
    const { photoId, submissionId, storagePath } = event.data;

    // Step 1: Mark as processing
    const photoExists = await step.run("mark-processing", async () => {
      const supabase = createAdminClient();
      const { data: photo } = await supabase
        .from("submission_photos")
        .select("id")
        .eq("id", photoId)
        .single();
      if (!photo) return false;
      await supabase
        .from("submission_photos")
        .update({
          status: "processing",
          processing_started_at: new Date().toISOString(),
        })
        .eq("id", photoId);
      return true;
    });

    if (!photoExists) return { success: false, photoId, reason: "photo deleted" };

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

    // Step 3a: Check per-teacher daily Gemini cap. Fails open on DB errors —
    // see src/lib/gemini/rate-limit.ts. The teacher lookup is its own step so
    // Inngest's retry-with-checkpoint behavior doesn't re-run the rate-limit
    // check on every retry of "call-gemini" — once cleared, it's cleared.
    const rateLimitCheck = await step.run("check-rate-limit", async () => {
      const supabase = createAdminClient();
      const { data: row } = await supabase
        .from("submissions")
        .select("assignments!inner ( courses!inner ( teacher_id ) )")
        .eq("id", submissionId)
        .single();
      const teacherId =
        (row as unknown as {
          assignments: { courses: { teacher_id: string } };
        } | null)?.assignments?.courses?.teacher_id ?? null;
      if (!teacherId) {
        // Submission with no teacher context — surprising, but fail open
        // rather than block. Logged so we notice if it ever happens.
        console.error("[rate-limit] no teacher_id for submission", submissionId);
        return { allowed: true, teacherId: null };
      }
      const allowed = await checkAndIncrementGeminiCall(teacherId);
      return { allowed, teacherId };
    });

    if (!rateLimitCheck.allowed) {
      const supabase = createAdminClient();
      await supabase
        .from("submission_photos")
        .update({
          status: "failed",
          processing_completed_at: new Date().toISOString(),
        })
        .eq("id", photoId);
      return {
        success: false,
        photoId,
        reason: "gemini daily cap reached for teacher",
      };
    }

    // Step 3: Transcribe with Gemini
    const transcription = await step.run("call-gemini", async () => {
      return await transcribeImage(imageData.base64, imageData.mimeType);
    });

    // Step 3b: Phase 0 fail-closed PII scrub. Gemini may transcribe a
    // student's name from a header (the OCR prompt asks it to skip, but
    // there's no hard guarantee) or transcribe classmate names mentioned
    // in the body. We scrub the OCR output against the course roster
    // BEFORE writing to DB so submission_photos.raw_transcription and
    // submissions.transcription_text are tokenized at rest.
    //
    // RosterMissingError = course roster isn't synced OR salt is unset.
    // We refuse to land the text and mark the photo failed — exactly the
    // OE/AID Phase 0 contract.
    const scrubOutcome = await step.run("scrub-output", async () => {
      try {
        const scrub = await getScrubberForSubmission(submissionId);
        return { ok: true as const, text: scrub(transcription) };
      } catch (err) {
        if (err instanceof RosterMissingError) {
          console.warn(
            `[transcribe-photo] roster_missing submission=${submissionId} photo=${photoId} reason=${err.reason}`,
          );
          return { ok: false as const, reason: "roster_missing" as const };
        }
        throw err;
      }
    });

    if (!scrubOutcome.ok) {
      const supabase = createAdminClient();
      await supabase
        .from("submission_photos")
        .update({
          status: "failed",
          processing_completed_at: new Date().toISOString(),
        })
        .eq("id", photoId);
      return {
        success: false,
        photoId,
        reason: scrubOutcome.reason,
      };
    }
    const scrubbedTranscription = scrubOutcome.text;

    // Step 4: Save (scrubbed) transcription
    const savedOk = await step.run("save-transcription", async () => {
      const supabase = createAdminClient();
      const { data: photo } = await supabase
        .from("submission_photos")
        .select("id")
        .eq("id", photoId)
        .single();
      if (!photo) return false;
      await supabase
        .from("submission_photos")
        .update({
          raw_transcription: scrubbedTranscription,
          status: "completed",
          processing_completed_at: new Date().toISOString(),
        })
        .eq("id", photoId);
      return true;
    });

    if (!savedOk) return { success: false, photoId, reason: "photo deleted" };

    // Step 5: Delete photo from storage (transcription is saved, original no longer needed)
    await step.run("delete-storage-file", async () => {
      const supabase = createAdminClient();
      const { data: photo } = await supabase
        .from("submission_photos")
        .select("id, storage_path")
        .eq("id", photoId)
        .single();
      if (!photo || !photo.storage_path) return;
      await supabase.storage.from("submission-photos").remove([photo.storage_path]);
      await supabase
        .from("submission_photos")
        .update({ storage_path: null })
        .eq("id", photoId);
    });

    // Step 6: Check if all photos in this submission are done
    await step.run("check-submission-complete", async () => {
      const supabase = createAdminClient();

      // If submission was reset, don't update it
      const { data: sub } = await supabase
        .from("submissions")
        .select("status")
        .eq("id", submissionId)
        .single();
      if (!sub || sub.status !== "processing") return;

      const { data: photos } = await supabase
        .from("submission_photos")
        .select("status, raw_transcription, page_number")
        .eq("submission_id", submissionId)
        .order("page_number");

      if (!photos || photos.length === 0) return;

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
