"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Users, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sortByProximity } from "@/lib/assignment-sort";

interface Course {
  id: string;
  name: string;
  short_name: string | null;
  term: string | null;
}

interface Assignment {
  id: string;
  title: string;
  due_date: string | null;
  canvas_submit_by_default: boolean;
  canvas_submission_types: string[] | null;
  canvas_discussion_topic_id: number | null;
}

export default function TeacherCoursePage() {
  const params = useParams();
  const courseId = params.courseId as string;

  const [course, setCourse] = useState<Course | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [studentCount, setStudentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const visibleAssignments = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? assignments.filter((a) => a.title.toLowerCase().includes(q))
      : assignments;
    return sortByProximity(filtered);
  }, [assignments, search]);

  async function loadCourse() {
    const res = await fetch(`/api/courses/${courseId}`);
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = await res.json();
    setCourse(data.course);
    setAssignments(data.assignments);
    setStudentCount(data.studentCount);
    setLoading(false);
  }

  useEffect(() => {
    loadCourse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  async function handleResync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/courses/${courseId}/sync`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Sync failed");
      const data = await res.json();
      toast.success(
        `Synced ${data.assignmentCount} assignments and ${data.studentCount} students`
      );
      await loadCourse();
    } catch {
      toast.error("Failed to sync from Canvas");
    } finally {
      setSyncing(false);
    }
  }

  async function toggleCanvasSubmit(assignmentId: string, current: boolean) {
    setTogglingId(assignmentId);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvas_submit_by_default: !current }),
      });

      if (!res.ok) throw new Error("Failed to update");

      setAssignments((prev) =>
        prev.map((a) =>
          a.id === assignmentId
            ? { ...a, canvas_submit_by_default: !current }
            : a
        )
      );
    } catch {
      toast.error("Failed to update assignment setting");
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!course) {
    return <p className="text-muted-foreground">Course not found.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/teacher/dashboard">
          <Button variant="ghost" size="sm" className="mb-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Dashboard
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">
          {course.short_name && (
            <span className="mr-2 text-muted-foreground">
              {course.short_name}
            </span>
          )}
          {course.name}
        </h1>
        <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            {studentCount} students
          </span>
          {course.term && <span>· {course.term}</span>}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResync}
            disabled={syncing}
          >
            <RefreshCw
              className={`mr-1 h-3 w-3 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing..." : "Re-sync from Canvas"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Assignments</CardTitle>
          <CardDescription>
            Toggle Canvas submission to set the default for students. They can
            still change it per-submission.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No assignments synced yet.
            </p>
          ) : (
            <>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search assignments…"
                  className="pl-8"
                />
              </div>
              {visibleAssignments.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No assignments match &ldquo;{search}&rdquo;.
                </p>
              )}
              <div className="divide-y">
                {visibleAssignments.map((a) => {
                const isDiscussion = !!a.canvas_discussion_topic_id;
                const submissionTypes = a.canvas_submission_types ?? [];
                const canSubmit =
                  isDiscussion ||
                  submissionTypes.includes("online_text_entry");

                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{a.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        {a.due_date && (
                          <span className="text-xs text-muted-foreground">
                            Due{" "}
                            {new Date(a.due_date).toLocaleDateString()}
                          </span>
                        )}
                        {isDiscussion && (
                          <Badge variant="outline" className="text-xs">
                            Discussion
                          </Badge>
                        )}
                      </div>
                    </div>
                    <label className="flex shrink-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={a.canvas_submit_by_default}
                        disabled={!canSubmit || togglingId === a.id}
                        onChange={() =>
                          toggleCanvasSubmit(
                            a.id,
                            a.canvas_submit_by_default
                          )
                        }
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      <span className="text-xs text-muted-foreground">
                        {canSubmit
                          ? isDiscussion
                            ? "Auto-post"
                            : "Auto-submit"
                          : "Not supported"}
                      </span>
                    </label>
                  </div>
                );
              })}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
