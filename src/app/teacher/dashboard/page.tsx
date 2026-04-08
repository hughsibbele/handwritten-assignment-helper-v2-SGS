import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { BookOpen, Settings, Users } from "lucide-react";
import { BackgroundSync } from "@/components/teacher/background-sync";
import { TeacherGuide } from "@/components/teacher/teacher-guide";

export default async function TeacherDashboard() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: teacher } = await supabase
    .from("teachers")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  if (!teacher) {
    redirect("/setup");
  }

  // Check if Canvas is configured
  if (!teacher.canvas_base_url || !teacher.canvas_api_token) {
    redirect("/setup");
  }

  // Get teacher's courses
  const { data: courses } = await supabase
    .from("courses")
    .select(
      `
      id,
      name,
      short_name,
      term,
      is_active,
      enrollments (count),
      assignments (count)
    `
    )
    .eq("teacher_id", teacher.id)
    .eq("is_active", true);

  const courseIds = courses?.map((c) => c.id) ?? [];

  return (
    <div className="space-y-6">
      <BackgroundSync courseIds={courseIds} />
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

      {!courses || courses.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              No courses synced yet.{" "}
              <Link
                href="/setup"
                className="font-medium text-primary underline"
              >
                Sync your courses from Canvas
              </Link>{" "}
              to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => {
            const enrollmentCount =
              (course.enrollments as unknown as { count: number }[])?.[0]
                ?.count ?? 0;
            const assignmentCount =
              (course.assignments as unknown as { count: number }[])?.[0]
                ?.count ?? 0;

            return (
              <Link key={course.id} href={`/teacher/courses/${course.id}`}>
                <Card className="transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle className="text-lg">
                      {course.short_name && (
                        <span className="mr-2 text-muted-foreground">
                          {course.short_name}
                        </span>
                      )}
                      {course.name}
                    </CardTitle>
                    {course.term && (
                      <p className="text-sm text-muted-foreground">
                        {course.term}
                      </p>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        {enrollmentCount} students
                      </span>
                      <span className="flex items-center gap-1">
                        <BookOpen className="h-4 w-4" />
                        {assignmentCount} assignments
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
