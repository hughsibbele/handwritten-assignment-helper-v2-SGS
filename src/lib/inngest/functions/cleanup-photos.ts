import { inngest } from "../client";
// Admin client required: Inngest cron job has no user session/auth cookies
import { createAdminClient } from "@/lib/supabase/admin";

export const cleanupOldPhotos = inngest.createFunction(
  {
    id: "cleanup-old-photos",
    retries: 2,
    triggers: [{ cron: "0 3 * * 0" }], // Weekly on Sunday at 3 AM
  },
  async ({ step }) => {
    // Safety net: clean up any orphaned photos older than 1 week
    // (photos are normally deleted immediately after transcription)
    const photos = await step.run("find-old-photos", async () => {
      const supabase = createAdminClient();
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const { data, error } = await supabase
        .from("submission_photos")
        .select("id, storage_path, submission_id, submissions!inner(status)")
        .not("storage_path", "is", null)
        .lt("created_at", oneWeekAgo.toISOString())
        .in("submissions.status", ["confirmed", "submitted"])
        .limit(500);

      if (error) throw new Error(`Query failed: ${error.message}`);
      return data ?? [];
    });

    if (photos.length === 0) {
      return { deleted: 0 };
    }

    // Delete files from storage in batches
    const deleted = await step.run("delete-storage-files", async () => {
      const supabase = createAdminClient();
      const paths = photos.map((p) => p.storage_path).filter(Boolean);

      const { error } = await supabase.storage
        .from("submission-photos")
        .remove(paths);

      if (error) throw new Error(`Storage delete failed: ${error.message}`);
      return paths.length;
    });

    // Null out storage_path so we don't try to delete again
    await step.run("clear-storage-paths", async () => {
      const supabase = createAdminClient();
      const ids = photos.map((p) => p.id);

      await supabase
        .from("submission_photos")
        .update({ storage_path: null })
        .in("id", ids);
    });

    return { deleted };
  }
);
