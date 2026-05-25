"use client";

import { Fragment, useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  FileText,
  ExternalLink,
  AlertTriangle,
  ArrowLeft,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Submission {
  id: string;
  status: string;
  transcription_text: string | null;
  gdoc_url: string | null;
  canvas_submission_url: string | null;
  assignment_id: string;
  assignment: {
    title: string;
    due_date: string | null;
    course_id: string;
    canvas_submit_by_default: boolean;
    canvas_discussion_topic_id: number | null;
    canvas_submission_types: string[] | null;
    course: { name: string };
  };
}

interface Photo {
  id: string;
  page_number: number;
  status: string;
  raw_transcription: string | null;
}

type StepStatus = "completed" | "active" | "upcoming";

interface TrackerStep {
  key: string;
  label: string;
  status: StepStatus;
}

// ---------------------------------------------------------------------------
// Pizza Tracker
// ---------------------------------------------------------------------------

function getTrackerSteps(
  submission: Submission,
  canvasRequested: boolean
): TrackerStep[] {
  const s = submission.status;
  const hasDoc = !!submission.gdoc_url;
  const steps: TrackerStep[] = [];

  // 1. Photos Uploaded — always completed if we're on this page
  steps.push({ key: "uploaded", label: "Photos Uploaded", status: "completed" });

  // 2. Transcribing
  steps.push({
    key: "transcribing",
    label: "Transcribing",
    status:
      s === "processing"
        ? "active"
        : s === "draft"
          ? "upcoming"
          : "completed",
  });

  // 3. Review & Edit
  steps.push({
    key: "review",
    label: "Review & Edit",
    status:
      s === "review"
        ? "active"
        : ["draft", "processing"].includes(s)
          ? "upcoming"
          : "completed",
  });

  // 4. Google Doc Created
  steps.push({
    key: "gdoc",
    label: "Google Doc",
    status: hasDoc
      ? "completed"
      : s === "confirmed" || s === "submitted"
        ? "active"
        : "upcoming",
  });

  // 5. Submitted to Canvas (conditional)
  if (canvasRequested) {
    steps.push({
      key: "canvas",
      label: "Canvas",
      status:
        s === "submitted"
          ? "completed"
          : s === "confirmed" && hasDoc
            ? "active"
            : "upcoming",
    });
  }

  // 6. Complete
  const finalDone = canvasRequested
    ? s === "submitted"
    : s === "confirmed" && hasDoc;
  steps.push({
    key: "complete",
    label: "Complete!",
    status: finalDone ? "completed" : "upcoming",
  });

  return steps;
}

function PizzaTracker({ steps }: { steps: TrackerStep[] }) {
  return (
    <div className="flex items-start justify-between gap-0">
      {steps.map((step, i) => (
        <Fragment key={step.key}>
          {/* Step circle + label */}
          <div className="flex flex-col items-center gap-1.5">
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-all duration-500",
                step.status === "completed" &&
                  "bg-maroon text-white",
                step.status === "active" &&
                  "border-2 border-maroon text-maroon animate-pulse",
                step.status === "upcoming" &&
                  "border-2 border-muted-foreground/30 text-cool-gray/50"
              )}
            >
              {step.status === "completed" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                i + 1
              )}
            </div>
            <span
              className={cn(
                "max-w-[72px] text-center text-[11px] leading-tight sm:max-w-[80px] sm:text-xs",
                step.status === "completed" && "font-medium text-maroon",
                step.status === "active" && "font-semibold text-ink",
                step.status === "upcoming" && "text-cool-gray/50"
              )}
            >
              {step.label}
            </span>
          </div>
          {/* Connector line */}
          {i < steps.length - 1 && (
            <div
              className={cn(
                "mt-4 h-0.5 flex-1 transition-colors duration-500",
                step.status === "completed"
                  ? "bg-maroon"
                  : "bg-cool-gray/20"
              )}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Success Panel
// ---------------------------------------------------------------------------

function SuccessPanel({
  submission,
  editedText,
  resubmitHref,
}: {
  submission: Submission;
  editedText: string;
  resubmitHref: string;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-green-50 p-6 text-center dark:bg-green-950/20">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
        <p className="text-lg font-medium">
          {submission.status === "submitted"
            ? "Submitted to Canvas!"
            : "Transcription confirmed!"}
        </p>

        {/* Links */}
        <div className="mt-4 flex flex-col items-center gap-2">
          {submission.gdoc_url && (
            <a
              href={submission.gdoc_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-maroon underline"
            >
              <FileText className="h-4 w-4" />
              Open Google Doc
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {submission.canvas_submission_url && (
            <a
              href={submission.canvas_submission_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-maroon underline"
            >
              <ExternalLink className="h-4 w-4" />
              View Canvas Submission
            </a>
          )}
        </div>
      </div>

      {submission.gdoc_url && (
        <div className="rounded-lg border border-light-blue bg-light-blue/30 p-4 text-sm">
          <p className="font-medium text-dark-blue">
            Want this in your teacher&rsquo;s shared folder?
          </p>
          <p className="mt-1 text-cool-gray">
            Your Doc is in a folder in your own Google Drive (named for
            your course and last name). Open Drive, find that folder,
            and drag it into your teacher&rsquo;s shared course folder
            if they have one. Every future upload for this class will
            appear there too — you only have to move it once. If you
            accidentally delete the folder, we&rsquo;ll make a new one
            on your next upload.
          </p>
        </div>
      )}

      {/* Transcription preview */}
      <div className="rounded-lg border p-4">
        <p className="mb-2 text-sm font-medium">Your transcription:</p>
        <p className="whitespace-pre-wrap text-sm">{editedText}</p>
      </div>

      {/* Back to dashboard + resubmit + close message */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <div className="flex gap-2">
          <Link
            href="/student/dashboard"
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-light-blue bg-paper px-2.5 py-1.5 text-sm font-medium hover:bg-paper"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
          <Link
            href={resubmitHref}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-light-blue bg-paper px-2.5 py-1.5 text-sm font-medium hover:bg-paper"
          >
            <RotateCcw className="h-4 w-4" />
            Resubmit
          </Link>
        </div>
        <p className="text-sm text-cool-gray">
          You can close this window.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SubmissionPage() {
  const params = useParams();
  const router = useRouter();
  const submissionId = params.submissionId as string;
  const supabase = createClient();

  const [submission, setSubmission] = useState<Submission | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [editedText, setEditedText] = useState("");
  const [submitToCanvas, setSubmitToCanvas] = useState(false);
  const [hasCanvasId, setHasCanvasId] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [loading, setLoading] = useState(true);

  const editedTextRef = useRef(editedText);
  useEffect(() => { editedTextRef.current = editedText; }, [editedText]);
  const hasLoadedRef = useRef(false);

  const loadData = useCallback(async () => {
    if (!hasLoadedRef.current) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: studentInfo } = await supabase
          .from("students")
          .select("canvas_user_id")
          .eq("auth_user_id", user.id)
          .single();
        setHasCanvasId(!!studentInfo?.canvas_user_id);
      }
    }

    const { data: sub } = await supabase
      .from("submissions")
      .select(
        `id, status, transcription_text, gdoc_url, canvas_submission_url, assignment_id,
         assignment:assignments(
           title,
           due_date,
           course_id,
           canvas_submit_by_default,
           canvas_discussion_topic_id,
           canvas_submission_types,
           course:courses(name)
         )`
      )
      .eq("id", submissionId)
      .single();

    if (sub) {
      const s = sub as unknown as Submission;
      setSubmission(s);
      if (s.transcription_text && !editedTextRef.current) {
        setEditedText(s.transcription_text);
      }
      // Set Canvas toggle default from teacher's setting (only on first load)
      if (!hasLoadedRef.current) {
        setSubmitToCanvas(s.assignment?.canvas_submit_by_default ?? false);
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

    hasLoadedRef.current = true;
    setLoading(false);
  }, [submissionId, supabase]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch; all setState calls are post-await
  useEffect(() => { loadData(); }, [loadData]);

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

  // Polling fallback while processing — realtime can miss events due to race conditions
  useEffect(() => {
    if (submission?.status !== "processing") return;
    const interval = setInterval(() => {
      loadData();
    }, 3000);
    return () => clearInterval(interval);
  }, [submission?.status, loadData]);

  async function handleConfirm() {
    setConfirming(true);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcriptionText: editedText,
          submitToCanvas,
        }),
      });

      if (!res.ok) throw new Error("Failed to confirm");

      const data = await res.json();

      // Show warnings if any
      if (data.warnings?.length) {
        for (const w of data.warnings) {
          toast.warning(w);
        }
      }

      const statusMsg = data.canvasSubmitted
        ? "Confirmed, Google Doc created, and submitted to Canvas!"
        : "Transcription confirmed and Google Doc created!";
      toast.success(statusMsg);

      setSubmission((prev) =>
        prev
          ? {
              ...prev,
              status: data.canvasSubmitted ? "submitted" : "confirmed",
              gdoc_url: data.gdocUrl ?? prev.gdoc_url,
              canvas_submission_url:
                data.canvasSubmissionUrl ?? prev.canvas_submission_url,
            }
          : prev
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setConfirming(false);
    }
  }

  async function handleReset() {
    if (
      !confirm(
        "This will clear your photos and transcription. You'll need to upload again. Continue?"
      )
    )
      return;
    setResetting(true);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "reset" }),
      });
      if (res.ok) {
        const courseId = submission?.assignment?.course_id;
        const assignmentId = submission?.assignment_id;
        router.push(
          `/student/courses/${courseId}/assignments/${assignmentId}`
        );
      } else {
        toast.error("Failed to reset submission");
        setResetting(false);
      }
    } catch {
      toast.error("Failed to reset submission");
      setResetting(false);
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
    return <p className="text-cool-gray">Submission not found.</p>;
  }

  const completedPhotos = photos.filter(
    (p) => p.status === "completed"
  ).length;
  const isProcessing = submission.status === "processing";
  const isReady =
    submission.status === "review" || submission.status === "confirmed";
  const isDone =
    submission.status === "confirmed" || submission.status === "submitted";

  // Determine if Canvas submission is possible for this assignment
  const isDiscussion = !!submission.assignment?.canvas_discussion_topic_id;
  const submissionTypes = submission.assignment?.canvas_submission_types ?? [];
  const canSubmitToCanvas =
    isDiscussion || submissionTypes.includes("online_text_entry");

  const canvasToggleLabel = isDiscussion
    ? "Post to Canvas discussion"
    : "Submit to Canvas assignment";

  const canResetOrStartOver =
    ["draft", "processing", "review"].includes(submission.status);
  const courseId = submission.assignment?.course_id;
  const assignmentId = submission.assignment_id;
  const resubmitHref = `/student/courses/${courseId}/assignments/${assignmentId}?resubmit=true`;

  // Tracker needs to know if Canvas was/will be submitted
  const canvasWasSubmitted = submission.status === "submitted";
  const canvasRequested = canvasWasSubmitted || (submitToCanvas && hasCanvasId);
  const trackerSteps = getTrackerSteps(submission, canvasRequested);

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
        <CardContent className="space-y-6">
          {/* Pizza Tracker */}
          <PizzaTracker steps={trackerSteps} />

          <Separator />

          {/* Start Over button — available during in-progress states */}
          {canResetOrStartOver && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={resetting}
              >
                {resetting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-2 h-4 w-4" />
                )}
                Start Over
              </Button>
            </div>
          )}

          {/* Draft with no photos — show link back to upload */}
          {submission.status === "draft" && photos.length === 0 && (
            <div className="py-4 text-center">
              <p className="mb-3 text-sm text-cool-gray">
                No content yet. Upload your photos to get started.
              </p>
              <Link
                href={`/student/courses/${courseId}/assignments/${assignmentId}`}
                className={buttonVariants()}
              >
                Go to Upload
              </Link>
            </div>
          )}

          {/* Processing: per-page transcription progress */}
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
                      <span className="text-red-600">(failed)</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Review editor */}
          {isReady && !isDone && (
            <>
              <p className="text-sm text-cool-gray">
                Review and edit the transcription below. Fix any errors, then
                click Confirm to save it as a Google Doc.
              </p>
              <Textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                rows={10}
                className="min-h-[200px] font-mono text-sm sm:min-h-[400px]"
              />

              {/* Canvas submission toggle — hidden for non-Canvas students */}
              {hasCanvasId && (
                <label className="flex items-start gap-3 rounded-lg border p-3">
                  <input
                    type="checkbox"
                    checked={submitToCanvas && canSubmitToCanvas}
                    disabled={!canSubmitToCanvas}
                    onChange={(e) => setSubmitToCanvas(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300"
                  />
                  <div className="space-y-1">
                    <span className="text-sm font-medium">
                      {canvasToggleLabel}
                    </span>
                    {!canSubmitToCanvas && (
                      <p className="flex items-center gap-1 text-xs text-cool-gray">
                        <AlertTriangle className="h-3 w-3" />
                        This assignment doesn&apos;t accept text submissions on
                        Canvas
                      </p>
                    )}
                  </div>
                </label>
              )}

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

          {/* Success state */}
          {isDone && (
            <SuccessPanel
              submission={submission}
              editedText={editedText}
              resubmitHref={resubmitHref}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { variant: "default" | "secondary" | "outline"; label: string }
  > = {
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
