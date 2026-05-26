import { getServerDbClient } from "@/lib/supabase/server";
import Link from "next/link";
import { BookOpen, Clock } from "lucide-react";
import { UpcomingAssignments } from "@/components/student/UpcomingAssignments";

export default async function StudentDashboard() {
  const supabase = await getServerDbClient();
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
        <div className="rounded-md border border-stone-200 bg-white">
          <div className="px-5 space-y-3 py-8">
            <p className="text-cool-gray">
              We don&apos;t see you on any course roster yet. To get started,
              ask your teacher to:
            </p>
            <ol className="ml-5 list-decimal space-y-1 text-sm text-cool-gray">
              <li>Install the &ldquo;Upload handwritten work&rdquo; card on
                your Canvas assignment.</li>
              <li>Sync their Canvas roster from the teacher dashboard.</li>
            </ol>
            <p className="pt-2 text-sm text-cool-gray">
              Then open the card in Canvas and you&apos;ll land back here
              signed in.
            </p>
            <p className="text-sm text-cool-gray">
              Are you a teacher?{" "}
              <Link
                href="/setup"
                className="font-medium text-maroon underline"
              >
                Set up your account
              </Link>
            </p>
          </div>
        </div>
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

  const { data: assignmentRows } = courseIds.length > 0
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
    : { data: [] };

  const assignments = (assignmentRows ?? []).map((a) => ({
    id: a.id as string,
    title: a.title as string,
    due_date: (a.due_date as string | null) ?? null,
    course: (a.course as unknown as { id: string; name: string } | null) ?? null,
  }));

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

  // Build lookup map for assignment badges (plain object so it serializes
  // cleanly when passed to the client component below).
  const submissionByAssignment: Record<string, { id: string; status: string }> =
    {};
  for (const s of allSubmissions ?? []) {
    if (s.assignment_id && !submissionByAssignment[s.assignment_id]) {
      submissionByAssignment[s.assignment_id] = {
        id: s.id,
        status: s.status,
      };
    }
  }

  const submissions = allSubmissions ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Your work</h1>
        <p className="text-sm text-cool-gray">
          Recent uploads and what&apos;s coming up. Start a new upload from
          the &ldquo;Upload handwritten work&rdquo; card on the Canvas
          assignment.
        </p>
      </div>

      <div className="rounded-md border border-stone-200 bg-white">
        <div className="px-5 pt-5">
          <div className="text-base font-medium text-ink leading-snug flex items-center gap-2 text-lg">
            <Clock className="h-5 w-5" />
            Upcoming assignments
          </div>
        </div>
        <div className="px-5">
          <UpcomingAssignments
            assignments={assignments}
            submissionByAssignment={submissionByAssignment}
          />
        </div>
      </div>

      <div className="rounded-md border border-stone-200 bg-white">
        <div className="px-5 pt-5">
          <div className="text-base font-medium text-ink leading-snug flex items-center gap-2 text-lg">
            <BookOpen className="h-5 w-5" />
            Your submissions
          </div>
        </div>
        <div className="px-5">
          {submissions.length === 0 ? (
            <p className="text-sm text-cool-gray">
              No submissions yet.
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
                      className="block rounded-lg border p-3 transition-colors hover:bg-stone-50"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-medium">
                          {assignment?.title ?? "Unknown"}
                        </p>
                        <StatusBadge status={s.status} />
                      </div>
                      <p className="mt-1 text-sm text-cool-gray">
                        {assignment?.course?.name}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    draft: "shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800",
    processing: "shrink-0 rounded-full border border-stone-300 px-2 py-0.5 text-xs text-stone-500",
    review: "shrink-0 rounded-full bg-maroon px-2 py-0.5 text-xs font-medium text-white",
    confirmed: "shrink-0 rounded-full bg-maroon px-2 py-0.5 text-xs font-medium text-white",
    submitted: "shrink-0 rounded-full bg-maroon px-2 py-0.5 text-xs font-medium text-white",
  };

  const labels: Record<string, string> = {
    draft: "Draft",
    processing: "Transcribing...",
    review: "Ready for Review",
    confirmed: "Confirmed",
    submitted: "Submitted",
  };

  return (
    <span className={variants[status] ?? "shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800"}>
      {labels[status] ?? status}
    </span>
  );
}
