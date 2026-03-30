import { NextResponse } from "next/server";
import { transcribeImage } from "@/lib/gemini/transcribe";

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("photo") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No photo provided" }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const mimeType = file.type || "image/jpeg";

    const transcription = await transcribeImage(base64, mimeType);
    return NextResponse.json({ transcription });
  } catch (err) {
    console.error("Transcription error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Transcription failed",
      },
      { status: 500 }
    );
  }
}
