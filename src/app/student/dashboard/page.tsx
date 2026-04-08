import { createServerSupabase } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { BookOpen, Clock } from "lucide-react";
import { JoinCourseForm } from "@/components/student/join-course-form";

export default async function StudentDashboard() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Get student's enrolled courses
  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("auth_user_id", user!.id)
    .single();

  if (!student) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Welcome!</h1>
        <Card>
          <CardContent className="space-y-4 py-8">
            <p className="text-muted-foreground">
              Enter your class code to join a course.
            </p>
            <JoinCourseForm />
            <p className="text-sm text-muted-foreground">
              Your teacher will give you the class code.
            </p>
            <p className="text-sm text-muted-foreground">
              Are you a teacher?{" "}
              <Link
                href="/setup"
                className="font-medium text-primary underline"
              >
                Set up your account
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(
      `
      id,
      course:courses (
        id,
        name,
        term
      )
    `
    )
    .eq("student_id", student.id)
    .eq("is_active", true);

  // Get upcoming assignments across all courses
  const courseIds =
    enrollments
      ?.map((e) => {
        const course = e.course as unknown as { id: string } | null;
        return course?.id;
      })
      .filter(Boolean) ?? [];

  const { data: assignments } = courseIds.length > 0
    ? await supabase
        .from("assignments")
        .select(
          `
        id,
        title,
        due_date,
        course:courses (
          id,
          name
        )
      `
        )
        .in("course_id", courseIds)
        .eq("is_active", true)
        .order("due_date", { ascending: false })
    : { data: [] };

  // Get all submissions for this student (used for assignment badges + recent list)
  const { data: allSubmissions } = await supabase
    .from("submissions")
    .select(
      `
      id,
      status,
      assignment_id,
      created_at,
      assignment:assignments (
        title,
        course:courses (name)
      )
    `
    )
    .eq("student_id", student.id)
    .order("created_at", { ascending: false });

  // Build lookup map for assignment badges
  const submissionByAssignment = new Map<
    string,
    { id: string; status: string }
  >();
  for (const s of allSubmissions ?? []) {
    if (s.assignment_id && !submissionByAssignment.has(s.assignment_id)) {
      submissionByAssignment.set(s.assignment_id, {
        id: s.id,
        status: s.status,
      });
    }
  }

  const submissions = (allSubmissions ?? []).slice(0, 5);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Your Dashboard</h1>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Upcoming assignments */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5" />
              Assignments
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!assignments || assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No assignments yet
              </p>
            ) : (
              <ul className="space-y-3">
                {assignments.map((a) => {
                  const course = a.course as unknown as {
                    id: string;
                    name: string;
                  } | null;
                  const sub = submissionByAssignment.get(a.id);
                  const inProgress =
                    sub &&
                    ["draft", "processing", "review"].includes(sub.status);
                  const isDone =
                    sub &&
                    ["confirmed", "submitted"].includes(sub.status);

                  // Primary link: upload page for new/draft, review page for in-progress/done
                  const primaryHref =
                    inProgress && sub.status !== "draft"
                      ? `/student/submissions/${sub.id}`
                      : isDone
                        ? `/student/submissions/${sub.id}`
                        : `/student/courses/${course?.id}/assignments/${a.id}`;

                  return (
                    <li key={a.id}>
                      <div className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
                        <Link href={primaryHref} className="block">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium">{a.title}</p>
                            {inProgress && (
                              <Badge variant="outline">In Progress</Badge>
                            )}
                            {isDone && (
                              <Badge variant="default">Submitted</Badge>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{course?.name}</span>
                            {a.due_date && (
                              <>
                                <span>&middot;</span>
                                <span>
                                  Due{" "}
                                  {new Date(a.due_date).toLocaleDateString()}
                                </span>
                              </>
                            )}
                          </div>
                        </Link>
                        {/* Action links */}
                        {inProgress && sub.status !== "draft" && (
                          <div className="mt-2">
                            <Link
                              href={`/student/submissions/${sub.id}`}
                              className="text-sm font-medium text-primary hover:underline"
                            >
                              Continue Working
                            </Link>
                          </div>
                        )}
                        {isDone && (
                          <div className="mt-2">
                            <Link
                              href={`/student/courses/${course?.id}/assignments/${a.id}?resubmit=true`}
                              className="text-sm font-medium text-primary hover:underline"
                            >
                              Resubmit
                            </Link>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent submissions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookOpen className="h-5 w-5" />
              Recent Submissions
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!submissions || submissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No submissions yet
              </p>
            ) : (
              <ul className="space-y-3">
                {submissions.map((s) => {
                  const assignment = s.assignment as unknown as {
                    title: string;
                    course: { name: string };
                  } | null;
                  return (
                    <li key={s.id}>
                      <Link
                        href={`/student/submissions/${s.id}`}
                        className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="flex items-center justify-between">
                          <p className="font-medium">
                            {assignment?.title ?? "Unknown"}
                          </p>
                          <StatusBadge status={s.status} />
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {assignment?.course?.name}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Join another course</CardTitle>
        </CardHeader>
        <CardContent>
          <JoinCourseForm />
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    draft: "secondary",
    processing: "outline",
    review: "default",
    confirmed: "default",
    submitted: "default",
  };

  const labels: Record<string, string> = {
    draft: "Draft",
    processing: "Transcribing...",
    review: "Ready for Review",
    confirmed: "Confirmed",
    submitted: "Submitted",
  };

  return (
    <Badge variant={variants[status] ?? "secondary"}>
      {labels[status] ?? status}
    </Badge>
  );
}
