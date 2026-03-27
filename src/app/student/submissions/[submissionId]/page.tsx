"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { CheckCircle2, Loader2, FileText, ExternalLink } from "lucide-react";

interface Submission {
  id: string;
  status: string;
  transcription_text: string | null;
  gdoc_url: string | null;
  assignment: {
    title: string;
    course: { name: string };
  };
}

interface Photo {
  id: string;
  page_number: number;
  status: string;
  raw_transcription: string | null;
}

export default function SubmissionPage() {
  const params = useParams();
  const submissionId = params.submissionId as string;
  const supabase = createClient();

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [editedText, setEditedText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    const { data: sub } = await supabase
      .from("submissions")
      .select(
        "id, status, transcription_text, gdoc_url, assignment:assignments(title, course:courses(name))"
      )
      .eq("id", submissionId)
      .single();

    if (sub) {
      const s = sub as unknown as Submission;
      setSubmission(s);
      if (s.transcription_text && !editedText) {
        setEditedText(s.transcription_text);
      }
    }

    const { data: photoData } = await supabase
      .from("submission_photos")
      .select("id, page_number, status, raw_transcription")
      .eq("submission_id", submissionId)
      .order("page_number");

    if (photoData) {
      setPhotos(photoData);
    }

    setLoading(false);
  }, [submissionId, supabase, editedText]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Real-time subscription for status updates
  useEffect(() => {
    const channel = supabase
      .channel(`submission-${submissionId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "submission_photos",
          filter: `submission_id=eq.${submissionId}`,
        },
        () => {
          loadData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "submissions",
          filter: `id=eq.${submissionId}`,
        },
        () => {
          loadData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [submissionId, supabase, loadData]);

  async function handleConfirm() {
    setConfirming(true);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcriptionText: editedText }),
      });

      if (!res.ok) throw new Error("Failed to confirm");

      const data = await res.json();
      toast.success("Transcription confirmed and saved!");
      setSubmission((prev) =>
        prev
          ? {
              ...prev,
              status: "confirmed",
              gdoc_url: data.gdocUrl ?? prev.gdoc_url,
            }
          : prev
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to confirm"
      );
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!submission) {
    return <p className="text-muted-foreground">Submission not found.</p>;
  }

  const completedPhotos = photos.filter((p) => p.status === "completed").length;
  const isProcessing = submission.status === "processing";
  const isReady = submission.status === "review" || submission.status === "confirmed";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{submission.assignment?.title}</CardTitle>
              <CardDescription>
                {submission.assignment?.course?.name}
              </CardDescription>
            </div>
            <StatusBadge status={submission.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Processing status */}
          {isProcessing && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Transcribing your writing... ({completedPhotos}/{photos.length}{" "}
                pages done)
              </div>
              <div className="space-y-2">
                {photos.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    {p.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : p.status === "processing" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border-2" />
                    )}
                    Page {p.page_number}
                    {p.status === "failed" && (
                      <span className="text-destructive">(failed)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Review editor */}
          {isReady && submission.status !== "confirmed" && (
            <>
              <p className="text-sm text-muted-foreground">
                Review and edit the transcription below. Fix any errors, then
                click Confirm to save it as a Google Doc.
              </p>
              <Textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={20}
                className="font-mono text-sm"
              />
              <Button
                onClick={handleConfirm}
                disabled={confirming || !editedText.trim()}
                className="w-full"
              >
                {confirming ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Confirm & Create Google Doc
              </Button>
            </>
          )}

          {/* Confirmed state */}
          {submission.status === "confirmed" && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-green-50 p-4 text-center dark:bg-green-950/20">
                <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-600" />
                <p className="font-medium">Transcription confirmed!</p>
                {submission.gdoc_url && (
                  <a
                    href={submission.gdoc_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline"
                  >
                    <FileText className="h-4 w-4" />
                    Open Google Doc
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="rounded-lg border p-4">
                <p className="mb-2 text-sm font-medium">Your transcription:</p>
                <p className="whitespace-pre-wrap text-sm">{editedText}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "outline"; label: string }> = {
    draft: { variant: "secondary", label: "Draft" },
    processing: { variant: "outline", label: "Transcribing..." },
    review: { variant: "default", label: "Ready for Review" },
    confirmed: { variant: "default", label: "Confirmed" },
    submitted: { variant: "default", label: "Submitted" },
  };

  const { variant, label } = config[status] ?? {
    variant: "secondary" as const,
    label: status,
  };
  return <Badge variant={variant}>{label}</Badge>;
}
