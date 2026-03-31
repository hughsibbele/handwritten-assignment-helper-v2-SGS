import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { transcribePhoto } from "@/lib/inngest/functions/transcribe-photo";
import { cleanupOldPhotos } from "@/lib/inngest/functions/cleanup-photos";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [transcribePhoto, cleanupOldPhotos],
});
