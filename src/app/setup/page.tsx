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
import { CheckCircle2, Loader2, Square, CheckSquare } from "lucide-react";

interface CanvasCourse {
  id: number;
  name: string;
  term?: string | null;
}

export default function TeacherSetupPage() {
  const supabase = createClient();
  const router = useRouter();
  const [canvasUrl, setCanvasUrl] = useState("");
  const [canvasToken, setCanvasToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);

  // Course selection
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [availableCourses, setAvailableCourses] = useState<CanvasCourse[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<number>>(
    new Set()
  );
  const [syncing, setSyncing] = useState(false);
  const [syncedCourses, setSyncedCourses] = useState<CanvasCourse[]>([]);

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

  async function handleLoadCourses() {
    setLoadingCourses(true);
    try {
      const res = await fetch("/api/canvas/courses");
      if (!res.ok) throw new Error("Failed to load courses");

      const data = await res.json();
      setAvailableCourses(data.courses ?? []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load courses"
      );
    } finally {
      setLoadingCourses(false);
    }
  }

  function toggleCourse(id: number) {
    setSelectedCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSyncSelected() {
    setSyncing(true);
    try {
      const res = await fetch("/api/canvas/courses/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds: Array.from(selectedCourseIds) }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to sync courses");
      }

      const data = await res.json();
      setSyncedCourses(data.courses ?? []);
      toast.success(
        `Synced ${data.courses?.length ?? 0} courses from Canvas`
      );
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
            Enter your school&apos;s Canvas URL and your personal API token. You
            can generate a token in Canvas under Account &gt; Settings &gt; New
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

      {/* Step 2: Select & Sync Courses */}
      {isConfigured && (
        <Card>
          <CardHeader>
            <CardTitle>Step 2: Select Courses</CardTitle>
            <CardDescription>
              Choose which courses to import from Canvas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {availableCourses.length === 0 && syncedCourses.length === 0 && (
              <Button onClick={handleLoadCourses} disabled={loadingCourses}>
                {loadingCourses && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Load Courses from Canvas
              </Button>
            )}

            {availableCourses.length > 0 && syncedCourses.length === 0 && (
              <>
                <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {availableCourses.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => toggleCourse(c.id)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50"
                    >
                      {selectedCourseIds.has(c.id) ? (
                        <CheckSquare className="h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <Square className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1">{c.name}</span>
                      {c.term && (
                        <span className="text-xs text-muted-foreground">
                          {c.term}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                <Button
                  onClick={handleSyncSelected}
                  disabled={syncing || selectedCourseIds.size === 0}
                >
                  {syncing && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Sync {selectedCourseIds.size} Selected Course
                  {selectedCourseIds.size !== 1 ? "s" : ""}
                </Button>
              </>
            )}

            {syncedCourses.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Synced courses:</p>
                <ul className="space-y-1">
                  {syncedCourses.map((c) => (
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
