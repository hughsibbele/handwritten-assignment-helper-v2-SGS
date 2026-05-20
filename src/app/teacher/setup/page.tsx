import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  loadCardTextDefaults,
  loadTeacherCardOverrides,
} from "@/lib/card-text/resolve";
import { CanvasConnectionSection } from "./CanvasConnectionSection";
import { CardTextEditor } from "./CardTextEditor";

export default async function TeacherSetupPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  // Bulk-load everything in parallel — keeps the page snappy and avoids
  // the old useEffect waterfall.
  const admin = createAdminClient();
  const teacherP = admin
    .from("teachers")
    .select("id, canvas_base_url, canvas_api_token")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const defaultsP = loadCardTextDefaults();
  const [{ data: teacher }, defaults] = await Promise.all([
    teacherP,
    defaultsP,
  ]);

  const teacherId = teacher?.id as string | undefined;
  const isConfigured = Boolean(teacher?.canvas_api_token);
  const canvasUrl = (teacher?.canvas_base_url as string | undefined) ?? "";

  const [{ count }, overrides] = await Promise.all([
    teacherId
      ? admin
          .from("courses")
          .select("id", { count: "exact", head: true })
          .eq("teacher_id", teacherId)
      : Promise.resolve({ count: 0 }),
    teacherId
      ? loadTeacherCardOverrides(teacherId)
      : Promise.resolve({
          card_kicker: null,
          card_title: null,
          card_body: null,
          card_cta_label: null,
          card_footnote: null,
        }),
  ]);
  const hasCourses = (count ?? 0) > 0;

  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Canvas &amp; Drive setup</h1>
        <p className="text-sm text-muted-foreground">
          Connect your Canvas account, customize the card students see in
          Canvas, and (soon) configure Google Drive. Your day-to-day work
          lives on the{" "}
          <a
            href="/teacher/dashboard"
            className="underline underline-offset-2"
          >
            dashboard
          </a>
          .
        </p>
      </div>

      <CanvasConnectionSection
        initialCanvasUrl={canvasUrl}
        initialIsConfigured={isConfigured}
        initialHasCourses={hasCourses}
      />

      <CardTextEditor
        defaults={defaults}
        overrides={overrides}
        appBaseUrl={appBaseUrl}
      />

      <Card>
        <CardHeader>
          <CardTitle>Google Drive</CardTitle>
          <CardDescription>
            Where transcribed Google Docs are saved. Folder template and
            sharing scope coming soon.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Today, each student&apos;s transcribed work lands in a per-course
            folder in their own Drive, shared with you. Teacher-side Drive
            customization (folder template, sharing scope) ships later.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
