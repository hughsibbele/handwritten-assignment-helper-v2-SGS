"use client";

import { useState } from "react";
import { toast } from "sonner";
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
    <div className="rounded-md border border-stone-200 bg-white">
      <div className="px-5 pt-5">
        <div className="text-base font-medium text-ink leading-snug flex items-center gap-2">
          {isConfigured && (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          )}
          Canvas connection
        </div>
        <div className="mt-1 text-sm text-stone-500">
          Enter your school&apos;s Canvas URL and your personal API token.
          Generate a token in Canvas under Account &gt; Settings &gt; New
          Access Token.
        </div>
      </div>
      <div className="px-5 space-y-4">
        <div className="space-y-2">
          <label htmlFor="canvas-url" className="text-sm font-medium">Canvas URL</label>
          <input
            id="canvas-url"
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon disabled:opacity-50"
            placeholder="https://yourschool.instructure.com"
            value={canvasUrl}
            onChange={(e) => setCanvasUrl(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="canvas-token" className="text-sm font-medium">API token</label>
          <input
            id="canvas-token"
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon disabled:opacity-50"
            type="password"
            placeholder="Paste your Canvas API token"
            value={canvasToken}
            onChange={(e) => setCanvasToken(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
            onClick={handleTestCanvas}
            disabled={testing || saving || !canvasUrl || !canvasToken}
          >
            {testing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Test connection
          </button>
          <button
            className="rounded-md bg-maroon px-3 py-1.5 text-sm font-medium text-white hover:bg-maroon-dark disabled:opacity-50"
            onClick={handleSaveCanvas}
            disabled={saving || testing || !canvasUrl || !canvasToken}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Canvas config
          </button>
        </div>

      </div>
    </div>
  );
}
