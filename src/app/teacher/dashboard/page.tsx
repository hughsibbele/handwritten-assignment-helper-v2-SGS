import { redirect } from "next/navigation";
import Link from "next/link";
import { getServerDbClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { BackgroundSync } from "@/components/teacher/background-sync";
import { TeacherGuide } from "@/components/teacher/teacher-guide";
import { termIsCurrent } from "@/lib/academic-year";
import { CourseAccordion } from "./CourseAccordion";
import type {
  AssignmentRow,
  CourseGroup,
} from "./dashboard.types";
import { bulkSuperGraderScope } from "@/lib/super-grader/scope";

export default async function TeacherDashboard() {
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: teacher } = await supabase
    .from("teachers")
    .select("id, canvas_base_url, canvas_api_token")
    .eq("auth_user_id", user.id)
    .single();
  if (!teacher) redirect("/setup");
  if (!teacher.canvas_base_url || !teacher.canvas_api_token) redirect("/setup");

  // Pull courses + counts. We deliberately keep this RLS-scoped (teacher's
  // own client) — install-state below uses the same client and the RLS policy
  // joins through course.teacher_id.
  const { data: courseRows } = await supabase
    .from("courses")
    .select(
      `
        id,
        name,
        short_name,
        term,
        is_active,
        last_synced_at,
        enrollments (count),
        assignments (
          id,
          title,
          due_date,
          canvas_assignment_id,
          post_to_drive,
          post_to_canvas_comment,
          post_to_canvas_submission,
          canvas_submission_types,
          canvas_discussion_topic_id,
          is_active
        )
      `,
    )
    .eq("teacher_id", teacher.id)
    .eq("is_active", true);

  const courses = courseRows ?? [];

  // Bulk-load install state for every assignment shown. One query keyed on
  // the union of assignment ids beats N round-trips when the teacher has
  // dozens of courses.
  const allAssignmentIds: string[] = [];
  for (const c of courses) {
    const asn = (c.assignments ?? []) as { id: string; is_active: boolean }[];
    for (const a of asn) {
      if (a.is_active) allAssignmentIds.push(a.id);
    }
  }

  const installedSet = new Set<string>();
  if (allAssignmentIds.length > 0) {
    const { data: installRows } = await supabase
      .from("assignment_install_state")
      .select("assignment_id")
      .in("assignment_id", allAssignmentIds);
    for (const r of (installRows ?? []) as { assignment_id: string }[]) {
      installedSet.add(r.assignment_id);
    }
  }

  const groups: CourseGroup[] = courses.map((c) => {
    const studentCount =
      (c.enrollments as unknown as { count: number }[])?.[0]?.count ?? 0;
    const rawAssignments = (c.assignments ?? []) as Array<{
      id: string;
      title: string;
      due_date: string | null;
      canvas_assignment_id: number | null;
      post_to_drive: boolean;
      post_to_canvas_comment: boolean;
      post_to_canvas_submission: boolean;
      canvas_submission_types: string[] | null;
      canvas_discussion_topic_id: number | null;
      is_active: boolean;
    }>;
    const assignments: AssignmentRow[] = rawAssignments
      .filter((a) => a.is_active)
      .map((a) => ({
        id: a.id,
        title: a.title,
        due_date: a.due_date,
        canvas_assignment_id: a.canvas_assignment_id,
        post_to_drive: a.post_to_drive,
        post_to_canvas_comment: a.post_to_canvas_comment,
        post_to_canvas_submission: a.post_to_canvas_submission,
        canvas_submission_types: a.canvas_submission_types,
        canvas_discussion_topic_id: a.canvas_discussion_topic_id,
        installed: installedSet.has(a.id),
        inSuperGraderScope: false, // populated post-map via bulk lookup
      }));
    return {
      id: c.id,
      name: c.name,
      short_name: c.short_name,
      term: c.term,
      last_synced_at: c.last_synced_at,
      studentCount,
      assignments,
      installedCount: assignments.filter((a) => a.installed).length,
    };
  });

  // Active-term filter — courses with mis-matched term names still exist in
  // the data but stay hidden from the accordion view. Re-syncing via the
  // course header re-pulls them; non-current courses can be viewed later by
  // dropping the filter.
  const activeGroups = groups.filter((g) => termIsCurrent(g.term));
  const hiddenCount = groups.length - activeGroups.length;

  // Ask super-grader which assignments it's tracking. Bulk lookup with
  // 5-min cache + fail-open per call. Only check active-term assignments
  // (those are the ones actually rendered).
  const sgScopeIds = activeGroups
    .flatMap((g) => g.assignments)
    .map((a) => a.canvas_assignment_id)
    .filter((id): id is number => id != null);
  const sgScopeMap = await bulkSuperGraderScope(sgScopeIds);
  for (const group of activeGroups) {
    for (const a of group.assignments) {
      if (a.canvas_assignment_id != null) {
        a.inSuperGraderScope =
          sgScopeMap.get(String(a.canvas_assignment_id))?.in_scope ?? false;
      }
    }
  }

  // BackgroundSync expects the raw shape it's always taken.
  const syncCandidates = activeGroups.map((g) => ({
    id: g.id,
    term: g.term ?? null,
  }));

  return (
    <div className="space-y-6">
      <BackgroundSync courses={syncCandidates} />

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Teacher Dashboard</h1>
        <div className="flex gap-2">
          <TeacherGuide />
          <Link href="/setup">
            <Button variant="outline" size="sm">
              <Settings className="mr-1 h-4 w-4" />
              Setup
            </Button>
          </Link>
        </div>
      </div>

      {activeGroups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              No active-term courses synced yet.{" "}
              <Link
                href="/setup"
                className="font-medium text-primary underline"
              >
                Sync your courses from Canvas
              </Link>{" "}
              to get started.
            </p>
            {hiddenCount > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                ({hiddenCount} older course{hiddenCount === 1 ? "" : "s"}{" "}
                hidden by the active-term filter.)
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {activeGroups.map((g) => (
            <CourseAccordion key={g.id} group={g} />
          ))}
          {hiddenCount > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              {hiddenCount} older course{hiddenCount === 1 ? "" : "s"} hidden
              by the active-term filter.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
