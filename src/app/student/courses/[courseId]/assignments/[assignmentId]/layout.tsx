import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerDbClient } from "@/lib/supabase/server";
import { createAdminDbClient } from "@/lib/supabase/admin";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button-variants";

// Server-side gate for student upload pages reached via the Canvas card.
// Verifies (a) signed-in, (b) we have a `students` row for this email, and
// (c) the student is enrolled in the course this assignment belongs to.
// The proxy already redirects unauthenticated users to /login?next=...; the
// session check here is defense-in-depth and also computes a clean ?next=
// from this layout's full URL.
//
// Failure modes render an inline friendly card rather than a hard 404 — the
// student followed a teacher-supplied Canvas link and needs guidance, not
// a stack trace.

type Params = { courseId: string; assignmentId: string };

export default async function StudentAssignmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<Params>;
}) {
  const { courseId, assignmentId } = await params;
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    const next = `/student/courses/${courseId}/assignments/${assignmentId}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  // Use the service-role client so we can resolve students by email even
  // when a row hasn't been linked to an auth_user_id yet (Canvas-synced
  // students start with NULL auth_user_id; the auth callback links them
  // on first sign-in). Looking up by auth_user_id alone misses freshly
  // synced rows.
  //
  // Phase 0b of REMEDIATION_PLAN.md: previously this used PostgREST .or()
  // with the email interpolated as a string — a comma in a quoted local-
  // part spliced extra OR predicates and could match any student. We now
  // run two narrow lookups and union client-side (.eq is parameter-safe,
  // no string interpolation into the filter language).
  const admin = createAdminDbClient();

  const byAuthIdPromise = admin
    .from("students")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const byEmailPromise = admin
    .from("students")
    .select("id")
    .eq("email", user.email)
    .maybeSingle();
  const [byAuthId, byEmail] = await Promise.all([
    byAuthIdPromise,
    byEmailPromise,
  ]);
  const student = byAuthId.data ?? byEmail.data;

  if (!student) {
    return (
      <NoticeCard
        title="No student record yet"
        body={
          <>
            We don&apos;t see a student record for{" "}
            <span className="font-mono">{user.email}</span> in this app yet.
            Ask your teacher to sync their Canvas roster, then try again.
          </>
        }
      />
    );
  }

  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id")
    .eq("student_id", student.id)
    .eq("course_id", courseId)
    .eq("is_active", true)
    .maybeSingle();

  if (!enrollment) {
    return (
      <NoticeCard
        title="You’re not enrolled in this course"
        body={
          <>
            <span className="font-mono">{user.email}</span> isn&apos;t on the
            roster for this course. If you&apos;ve recently joined, ask your
            teacher to re-sync their Canvas roster.
          </>
        }
      />
    );
  }

  return <>{children}</>;
}

function NoticeCard({
  title,
  body,
}: {
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/student/dashboard" className={buttonVariants({ variant: "outline" })}>
            Back to your dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
