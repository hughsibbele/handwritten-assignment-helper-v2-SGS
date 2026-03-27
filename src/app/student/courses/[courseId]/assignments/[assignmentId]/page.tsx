"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PhotoDropzone } from "@/components/upload/photo-dropzone";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Assignment {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  course: { name: string } | null;
}

export default function AssignmentUploadPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  const assignmentId = params.assignmentId as string;

  useEffect(() => {
    async function loadAssignment() {
      const { data } = await supabase
        .from("assignments")
        .select("id, title, description, due_date, course:courses(name)")
        .eq("id", assignmentId)
        .single();

      setAssignment(data as unknown as Assignment);
      setLoading(false);
    }
    loadAssignment();
  }, [assignmentId, supabase]);

  async function handleUpload(files: File[]) {
    setUploading(true);
    try {
      // 1. Create submission
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!assignment) {
    return <p className="text-muted-foreground">Assignment not found.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>{assignment.title}</CardTitle>
            {assignment.due_date && (
              <Badge variant="outline">
                Due {new Date(assignment.due_date).toLocaleDateString()}
              </Badge>
            )}
          </div>
          <CardDescription>
            {(assignment.course as unknown as { name: string })?.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assignment.description && (
            <p className="mb-4 text-sm text-muted-foreground">
              {assignment.description}
            </p>
          )}

          <PhotoDropzone onFilesSelected={handleUpload} disabled={uploading} />

          {uploading && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading photos...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
