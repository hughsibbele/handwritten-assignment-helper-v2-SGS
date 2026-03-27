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
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [courses, setCourses] = useState<
    { id: number; name: string; term?: string }[]
  >([]);

  useEffect(() => {
    async function checkSetup() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: teacher } = await supabase
        .from("teachers")
        .select("canvas_base_url, canvas_api_token")
        .eq("auth_user_id", user.id)
        .single();

      if (teacher?.canvas_base_url) {
        setCanvasUrl(teacher.canvas_base_url);
        setIsConfigured(!!teacher.canvas_api_token);
      }
    }
    checkSetup();
  }, [supabase]);

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
      setCourses(data.courses ?? []);
      toast.success(`Synced ${data.courses?.length ?? 0} courses from Canvas`);
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
      <h1 className="text-2xl font-bold">Setup</h1>

      {/* Step 1: Canvas Config */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {isConfigured && (
              <CheckCircle2 className="h-5 w-5 text-green-600" />
            )}
            Step 1: Connect Canvas
          </CardTitle>
          <CardDescription>
            Enter your school&apos;s Canvas URL and your personal API token.
            You can generate a token in Canvas under Account &gt; Settings &gt;
            New Access Token.
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
            <Label htmlFor="canvas-token">API Token</Label>
            <Input
              id="canvas-token"
              type="password"
              placeholder="Paste your Canvas API token"
              value={canvasToken}
              onChange={(e) => setCanvasToken(e.target.value)}
            />
          </div>
          <Button
            onClick={handleSaveCanvas}
            disabled={saving || !canvasUrl || !canvasToken}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Canvas Config
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: Sync Courses */}
      {isConfigured && (
        <Card>
          <CardHeader>
            <CardTitle>Step 2: Sync Courses</CardTitle>
            <CardDescription>
              Pull your courses, assignments, and student rosters from Canvas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleSyncCourses} disabled={syncing}>
              {syncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sync Courses from Canvas
            </Button>

            {courses.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Synced courses:</p>
                <ul className="space-y-1">
                  {courses.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      {c.name}
                      {c.term && (
                        <span className="text-muted-foreground">
                          ({c.term})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-4"
                  onClick={() => router.push("/teacher/dashboard")}
                >
                  Go to Dashboard
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
