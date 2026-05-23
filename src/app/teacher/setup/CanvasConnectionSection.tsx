"use client";

import { useState } from "react";
import { toast } from "sonner";
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
import { CheckCircle2, Loader2 } from "lucide-react";

/**
 * Canvas connection card — extracted from the old all-client setup page
 * so the parent can be a server component (M6.15). Bootstraps from
 * server-fetched initial state instead of useEffect.
 */
export function CanvasConnectionSection({
  initialCanvasUrl,
  initialIsConfigured,
  initialHasCourses,
}: {
  initialCanvasUrl: string;
  initialIsConfigured: boolean;
  initialHasCourses: boolean;
}) {
  const [canvasUrl, setCanvasUrl] = useState(initialCanvasUrl);
  const [canvasToken, setCanvasToken] = useState("");
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isConfigured, setIsConfigured] = useState(initialIsConfigured);
  // hasCourses is no longer used inside this section (the parent page
  // renders the dedicated CoursePickerSection when needed). Kept in the
  // prop signature for backward-compat; remove in a follow-up cleanup.
  void initialHasCourses;

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
        err instanceof Error ? err.message : "Failed to save config",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
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

      </CardContent>
    </Card>
  );
}
