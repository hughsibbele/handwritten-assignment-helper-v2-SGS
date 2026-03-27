import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { transcribePhoto } from "@/lib/inngest/functions/transcribe-photo";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [transcribePhoto],
});
