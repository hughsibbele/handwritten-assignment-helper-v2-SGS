import { createServerSupabase } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { BookOpen, Clock } from "lucide-react";

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
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              You are not enrolled in any courses yet. Ask your teacher to add
              you to a course.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
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

  const { data: assignments } = await supabase
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
    .order("due_date", { ascending: false });

  // Get recent submissions
  const { data: submissions } = await supabase
    .from("submissions")
    .select(
      `
      id,
      status,
      created_at,
      assignment:assignments (
        title,
        course:courses (name)
      )
    `
    )
    .eq("student_id", student.id)
    .order("created_at", { ascending: false })
    .limit(5);

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
                  return (
                    <li key={a.id}>
                      <Link
                        href={`/student/courses/${course?.id}/assignments/${a.id}`}
                        className="block rounded-lg border p-3 transition-colors hover:bg-muted/50"
                      >
                        <p className="font-medium">{a.title}</p>
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
