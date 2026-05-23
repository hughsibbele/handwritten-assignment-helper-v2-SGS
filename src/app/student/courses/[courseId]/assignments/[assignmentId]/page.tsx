"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PhotoDropzone } from "@/components/upload/PhotoDropzone";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Loader2, CheckCircle2, RotateCcw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface Assignment {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  canvas_submission_types: string[] | null;
  canvas_discussion_topic_id: number | null;
  canvas_submit_by_default: boolean;
  course: { name: string } | null;
}

interface ExistingSubmission {
  id: string;
  status: string;
  attempt_number: number;
}

type PageState =
  | "loading"
  | "not-found"
  | "upload"         // fresh submission or resubmit ready
  | "already-submitted" // confirmed/submitted, no ?resubmit
  | "redirecting";   // in-progress, redirecting to review page

export default function AssignmentUploadPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [existingSub, setExistingSub] = useState<ExistingSubmission | null>(null);
  const [isResubmission, setIsResubmission] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [hasCanvasId, setHasCanvasId] = useState(false);

  const assignmentId = params.assignmentId as string;
  const courseId = params.courseId as string;
  const resubmitParam = searchParams.get("resubmit") === "true";

  useEffect(() => {
    async function load() {
      // Load assignment
      const { data: assignmentData } = await supabase
        .from("assignments")
        .select(
          "id, title, description, due_date, canvas_submission_types, canvas_discussion_topic_id, canvas_submit_by_default, course:courses(name)"
        )
        .eq("id", assignmentId)
        .single();

      if (!assignmentData) {
        setPageState("not-found");
        return;
      }
      setAssignment(assignmentData as unknown as Assignment);

      // Check for existing submission
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setPageState("not-found");
        return;
      }

      const { data: studentData } = await supabase
        .from("students")
        .select("id, canvas_user_id")
        .eq("auth_user_id", user.id)
        .single();

      if (!studentData) {
        // No student record yet — show upload (submission API will create one)
        setPageState("upload");
        return;
      }

      setHasCanvasId(!!(studentData as { canvas_user_id: number | null }).canvas_user_id);

      const { data: sub } = await supabase
        .from("submissions")
        .select("id, status, attempt_number")
        .eq("assignment_id", assignmentId)
        .eq("student_id", studentData.id)
        .single();

      if (!sub) {
        setPageState("upload");
        return;
      }

      const submission = sub as unknown as ExistingSubmission;
      setExistingSub(submission);

      const isDone = ["confirmed", "submitted"].includes(submission.status);
      const inProgress = ["processing", "review"].includes(submission.status);
      const isDraft = submission.status === "draft";

      if (isDone && resubmitParam) {
        // Resubmit: reset the submission and show upload
        setResetting(true);
        const res = await fetch(`/api/submissions/${submission.id}/reset`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "resubmit" }),
        });
        if (res.ok) {
          const data = await res.json();
          setExistingSub({
            ...submission,
            status: "draft",
            attempt_number: data.submission.attempt_number,
          });
          setIsResubmission(true);
          setPageState("upload");
        } else {
          toast.error("Failed to start resubmission");
          setPageState("already-submitted");
        }
        setResetting(false);
      } else if (isDone) {
        setPageState("already-submitted");
      } else if (inProgress) {
        setPageState("redirecting");
        router.replace(`/student/submissions/${submission.id}`);
      } else if (isDraft) {
        // Check if there are existing photos (partially started)
        const { count } = await supabase
          .from("submission_photos")
          .select("id", { count: "exact", head: true })
          .eq("submission_id", submission.id);
        if (count && count > 0) {
          setPageState("redirecting");
          router.replace(`/student/submissions/${submission.id}`);
        } else {
          setPageState("upload");
        }
      }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  async function handleUpload(files: File[]) {
    setUploading(true);
    try {
      // 1. Create/get submission
      const createRes = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error || "Failed to create submission");
      }

      const { submission } = await createRes.json();

      // 2. Upload photos
      const formData = new FormData();
      files.forEach((file, i) => {
        formData.append(`photo_${i}`, file);
      });

      const uploadRes = await fetch(
        `/api/submissions/${submission.id}/photos`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!uploadRes.ok) {
        throw new Error("Failed to upload photos");
      }

      toast.success("Photos uploaded! Transcription in progress...");
      router.push(`/student/submissions/${submission.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Upload failed"
      );
    } finally {
      setUploading(false);
    }
  }

  if (pageState === "loading" || pageState === "redirecting" || resetting) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (pageState === "not-found" || !assignment) {
    return <p className="text-muted-foreground">Assignment not found.</p>;
  }

  if (pageState === "already-submitted" && existingSub) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CardTitle>{assignment.title}</CardTitle>
              <Badge variant="default">Submitted</Badge>
            </div>
            <CardDescription>
              {(assignment.course as unknown as { name: string })?.name}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-green-50 p-4 text-center dark:bg-green-950/20">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-600" />
              <p className="font-medium">
                You&apos;ve already submitted this assignment.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href={`/student/submissions/${existingSub.id}`}
                className={buttonVariants({ variant: "outline", className: "flex-1" })}
              >
                View Submission
              </Link>
              <Link
                href={`/student/courses/${courseId}/assignments/${assignmentId}?resubmit=true`}
                className={buttonVariants({ className: "flex-1" })}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Resubmit
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Block the upload when the teacher has Canvas auto-submit on but the
  // Canvas assignment doesn't accept the kind of submission we'd post.
  // Non-Canvas students (no canvas_user_id) bypass this — they'd just get
  // a Google Doc anyway, so the type of the Canvas assignment is moot.
  const canvasSupportsText =
    !!assignment.canvas_discussion_topic_id ||
    (assignment.canvas_submission_types ?? []).includes("online_text_entry");
  const blocked =
    hasCanvasId && assignment.canvas_submit_by_default && !canvasSupportsText;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>{assignment.title}</CardTitle>
            {isResubmission && (
              <Badge variant="secondary">
                Resubmission {existingSub?.attempt_number ?? 2}
              </Badge>
            )}
            {!isResubmission && assignment.due_date && (
              <Badge variant="outline">
                Due {new Date(assignment.due_date).toLocaleDateString()}
              </Badge>
            )}
          </div>
          <CardDescription>
            {(assignment.course as unknown as { name: string })?.name}
            {isResubmission && assignment.due_date && (
              <span className="ml-2">
                &middot; Due{" "}
                {new Date(assignment.due_date).toLocaleDateString()}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isResubmission && (
            <div className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
              Starting a new submission. Your previous submission will remain
              unchanged.
            </div>
          )}

          {assignment.description && (
            <p className="mb-4 text-sm text-muted-foreground">
              {assignment.description}
            </p>
          )}

          {blocked ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700/50 dark:bg-amber-950/20">
              <div className="mb-2 flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4" />
                Can&apos;t submit to Canvas
              </div>
              <p className="text-amber-900/90 dark:text-amber-200/90">
                Your teacher set this assignment to auto-submit through
                Handwritten Helper, but the Canvas assignment isn&apos;t
                configured to accept text submissions. Please ask your teacher
                to update the Canvas assignment to allow &quot;Text Entry,&quot;
                or submit your handwritten work directly in Canvas.
              </p>
            </div>
          ) : (
            <>
              <PhotoDropzone
                onFilesSelected={handleUpload}
                disabled={uploading}
              />

              {uploading && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading photos...
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
