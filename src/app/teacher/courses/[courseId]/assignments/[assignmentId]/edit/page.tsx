import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AutoSubmitToggle } from "./AutoSubmitToggle";
import { InstallToggleButton } from "./InstallToggleButton";

type Params = { courseId: string; assignmentId: string };

export default async function AssignmentConfigurePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { courseId, assignmentId } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: teacher } = await supabase
    .from("teachers")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();
  if (!teacher) redirect("/setup");

  // RLS guarantees the teacher owns the course (assignments are filtered
  // through course.teacher_id), so a missing row means bad id or wrong
  // owner — both 404.
  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      `
        id,
        title,
        due_date,
        canvas_assignment_id,
        canvas_submit_by_default,
        canvas_submission_types,
        canvas_discussion_topic_id,
        course:courses!inner ( id, name, short_name )
      `,
    )
    .eq("id", assignmentId)
    .eq("course_id", courseId)
    .single();

  if (!assignment) notFound();

  const course = assignment.course as unknown as {
    id: string;
    name: string;
    short_name: string | null;
  } | null;
  if (!course || course.id !== courseId) notFound();

  const { data: installRow } = await supabase
    .from("assignment_install_state")
    .select("installed_at, canvas_install_url")
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  const installed = !!installRow;
  const isDiscussion = !!assignment.canvas_discussion_topic_id;
  const submissionTypes = assignment.canvas_submission_types ?? [];
  const canSubmit =
    isDiscussion || submissionTypes.includes("online_text_entry");
  const canInstall = !!assignment.canvas_assignment_id;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link href="/teacher/dashboard">
          <Button variant="ghost" size="sm" className="mb-2">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Dashboard
          </Button>
        </Link>
        <h1 className="text-2xl font-bold">{assignment.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {course.short_name && (
            <span className="mr-1 font-medium">{course.short_name}</span>
          )}
          {course.name}
          {assignment.due_date && (
            <span className="ml-2">
              · Due {new Date(assignment.due_date).toLocaleDateString()}
            </span>
          )}
          {isDiscussion && (
            <Badge variant="outline" className="ml-2 text-xs">
              Discussion
            </Badge>
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Canvas card</CardTitle>
          <CardDescription>
            Installs a branded &ldquo;Upload handwritten work&rdquo; card into
            this assignment&apos;s Canvas description. Students click it to
            land directly on the upload page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            {installed ? (
              <Badge variant="default">Installed</Badge>
            ) : (
              <Badge variant="outline">Not installed</Badge>
            )}
            <InstallToggleButton
              assignmentId={assignment.id}
              installed={installed}
              disabled={!canInstall}
            />
          </div>
          {!canInstall && (
            <p className="text-xs text-muted-foreground">
              Assignment is missing its Canvas id. Re-sync the course from
              the dashboard, then install the card.
            </p>
          )}
          {installed && installRow?.canvas_install_url && (
            <p className="break-all text-xs text-muted-foreground">
              CTA URL:{" "}
              <span className="font-mono">{installRow.canvas_install_url}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-submit to Canvas</CardTitle>
          <CardDescription>
            When on, transcribed handwritten work is automatically posted to
            this assignment&apos;s Canvas submission body (or discussion
            reply, for discussions). Students can still review their
            submission before it goes out.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <AutoSubmitToggle
            assignmentId={assignment.id}
            initial={assignment.canvas_submit_by_default}
            disabled={!canSubmit}
          />
          {!canSubmit && (
            <p className="text-xs text-muted-foreground">
              This Canvas assignment doesn&apos;t accept text submissions, so
              auto-submit isn&apos;t available.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
