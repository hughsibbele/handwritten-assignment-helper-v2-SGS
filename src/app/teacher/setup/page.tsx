"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

export default function TeacherSetupPage() {
  const supabase = createClient();
  const router = useRouter();
  const [canvasUrl, setCanvasUrl] = useState("");
  const [canvasToken, setCanvasToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [hasCourses, setHasCourses] = useState(false);

  useEffect(() => {
    async function checkSetup() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: teacher } = await supabase
        .from("teachers")
        .select("id, canvas_base_url, canvas_api_token")
        .eq("auth_user_id", user.id)
        .single();

      if (teacher?.canvas_base_url) {
        setCanvasUrl(teacher.canvas_base_url);
        setIsConfigured(!!teacher.canvas_api_token);
      }

      if (teacher?.id) {
        const { count } = await supabase
          .from("courses")
          .select("id", { count: "exact", head: true })
          .eq("teacher_id", teacher.id);
        setHasCourses((count ?? 0) > 0);
      }
    }
    checkSetup();
  }, [supabase]);

  async function handleTestCanvas() {
    setTesting(true);
    try {
      const res = await fetch("/api/teacher/setup/canvas/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canvasBaseUrl: canvasUrl.replace(/\/+$/, ""),
          canvasApiToken: canvasToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test failed");
      toast.success(`Connected as ${data.user?.name ?? "Canvas user"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleSaveCanvas() {
    setSaving(true);
    try {
      const res = await fetch("/api/teacher/setup/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canvasBaseUrl: canvasUrl.replace(/\/+$/, ""),
          canvasApiToken: canvasToken,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to save Canvas config");
      }

      setIsConfigured(true);
      toast.success("Canvas configuration saved!");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save config"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncCourses() {
    setSyncing(true);
    try {
      const res = await fetch("/api/canvas/courses/sync", { method: "POST" });
      if (!res.ok) throw new Error("Failed to sync courses");
      const data = await res.json();
      toast.success(`Synced ${data.courses?.length ?? 0} courses from Canvas`);
      setHasCourses((data.courses?.length ?? 0) > 0);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to sync courses"
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Canvas &amp; Drive setup</h1>
        <p className="text-sm text-muted-foreground">
          Connect your Canvas account and (soon) Google Drive. Your day-to-day
          work lives on the{" "}
          <a
            href="/teacher/dashboard"
            className="underline underline-offset-2"
          >
            dashboard
          </a>
          .
        </p>
      </div>

      {/* Section 1: Canvas connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isConfigured && (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            )}
            Canvas connection
          </CardTitle>
          <CardDescription>
            Enter your school&apos;s Canvas URL and your personal API token.
            Generate a token in Canvas under Account &gt; Settings &gt; New
            Access Token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="canvas-url">Canvas URL</Label>
            <Input
              id="canvas-url"
              placeholder="https://yourschool.instructure.com"
              value={canvasUrl}
              onChange={(e) => setCanvasUrl(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="canvas-token">API token</Label>
            <Input
              id="canvas-token"
              type="password"
              placeholder="Paste your Canvas API token"
              value={canvasToken}
              onChange={(e) => setCanvasToken(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={handleTestCanvas}
              disabled={testing || saving || !canvasUrl || !canvasToken}
            >
              {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Test connection
            </Button>
            <Button
              onClick={handleSaveCanvas}
              disabled={saving || testing || !canvasUrl || !canvasToken}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Canvas config
            </Button>
          </div>

          {isConfigured && !hasCourses && (
            <div className="rounded-md border border-dashed bg-muted/40 p-4 text-sm">
              <p className="mb-2 font-medium">
                Pull your courses to get started
              </p>
              <p className="mb-3 text-muted-foreground">
                Syncs your active Canvas courses, assignments, and student
                rosters. You only need to do this once — after that, the
                dashboard keeps things in sync on its own.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSyncCourses} disabled={syncing}>
                  {syncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Sync courses from Canvas
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push("/teacher/dashboard")}
                >
                  Skip and go to dashboard
                </Button>
              </div>
            </div>
          )}

          {isConfigured && hasCourses && (
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              Courses synced. Re-sync happens automatically from the dashboard.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Drive setup (placeholder until M7.6) */}
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
