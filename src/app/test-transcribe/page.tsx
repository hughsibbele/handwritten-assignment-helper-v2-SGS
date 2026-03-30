"use client";

import { useState } from "react";
import { PhotoDropzone } from "@/components/upload/photo-dropzone";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function TestTranscribePage() {
  const [transcription, setTranscription] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(files: File[]) {
    setLoading(true);
    setError(null);
    setTranscription(null);

    try {
      const file = files[0];
      const formData = new FormData();
      formData.append("photo", file);

      const res = await fetch("/api/test-transcribe", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Transcription failed");
      }

      const data = await res.json();
      setTranscription(data.transcription);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Test Transcription</CardTitle>
          <CardDescription>
            Upload a photo of handwriting to test the Gemini transcription.
            This bypasses the full submission flow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <PhotoDropzone onFilesSelected={handleUpload} disabled={loading} />

          {loading && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Transcribing...
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          {transcription && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Transcription:</p>
              <div className="rounded-lg border bg-muted/50 p-4">
                <p className="whitespace-pre-wrap text-sm">{transcription}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
