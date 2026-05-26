"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  CheckSquare,
  Loader2,
  Square,
} from "lucide-react";

interface CanvasCourse {
  id: number;
  name: string;
  term?: string | null;
}

/**
 * Multi-step course picker — ported from the legacy /setup wizard
 * (M4.11d). Renders inline on /teacher/setup once Canvas is connected
 * and no courses have been synced yet. Three states:
 *
 *   1. Pre-load: "Load courses from Canvas" button.
 *   2. Pick: checkbox list of available courses → "Next: Name courses".
 *   3. Name + sync: short-name input per selected course → "Sync".
 *
 * After a successful sync, the section shows a confirmation list with a
 * "Go to dashboard" CTA.
 */
export function CoursePickerSection() {
  const router = useRouter();
  const [loadingCourses, setLoadingCourses] = useState(false);
  const [availableCourses, setAvailableCourses] = useState<CanvasCourse[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<number>>(
    new Set(),
  );
  const [courseShortNames, setCourseShortNames] = useState<
    Record<number, string>
  >({});
  const [showNaming, setShowNaming] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncedCourses, setSyncedCourses] = useState<CanvasCourse[]>([]);

  async function handleLoadCourses() {
    setLoadingCourses(true);
    try {
      const res = await fetch("/api/canvas/courses");
      if (!res.ok) throw new Error("Failed to load courses");
      const data = await res.json();
      setAvailableCourses(data.courses ?? []);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load courses",
      );
    } finally {
      setLoadingCourses(false);
    }
  }

  function toggleCourse(id: number) {
    setSelectedCourseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSyncSelected() {
    const missing = Array.from(selectedCourseIds).filter(
      (id) => !courseShortNames[id]?.trim(),
    );
    if (missing.length > 0) {
      toast.error("Please enter a display name for every selected course.");
      return;
    }

    setSyncing(true);
    try {
      const courses = Array.from(selectedCourseIds).map((id) => ({
        id,
        shortName: courseShortNames[id].trim(),
      }));
      const res = await fetch("/api/canvas/courses/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courses }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to sync courses");
      }
      const data = await res.json();
      setSyncedCourses(data.courses ?? []);
      toast.success(`Synced ${data.courses?.length ?? 0} courses from Canvas`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to sync courses",
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="rounded-md border border-stone-200 bg-white">
      <div className="px-5 pt-5">
        <div className="text-base font-medium text-ink leading-snug">Pull your courses</div>
        <div className="mt-1 text-sm text-stone-500">
          Choose which courses to import from Canvas. You only need to do this
          once — after that, the dashboard keeps things in sync on its own.
        </div>
      </div>
      <div className="px-5 space-y-4">
        {availableCourses.length === 0 && syncedCourses.length === 0 && (
          <button className="rounded-md bg-maroon px-3 py-1.5 text-sm font-medium text-white hover:bg-maroon-dark disabled:opacity-50" onClick={handleLoadCourses} disabled={loadingCourses}>
            {loadingCourses && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Load courses from Canvas
          </button>
        )}

        {availableCourses.length > 0 &&
          syncedCourses.length === 0 &&
          !showNaming && (
            <>
              <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border p-2">
                {availableCourses.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => toggleCourse(c.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-stone-50"
                  >
                    {selectedCourseIds.has(c.id) ? (
                      <CheckSquare className="h-4 w-4 shrink-0 text-maroon" />
                    ) : (
                      <Square className="h-4 w-4 shrink-0 text-cool-gray" />
                    )}
                    <span className="flex-1">{c.name}</span>
                    {c.term && (
                      <span className="text-xs text-cool-gray">
                        {c.term}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <button
                className="rounded-md bg-maroon px-3 py-1.5 text-sm font-medium text-white hover:bg-maroon-dark disabled:opacity-50"
                onClick={() => setShowNaming(true)}
                disabled={selectedCourseIds.size === 0}
              >
                Next: Name courses
              </button>
            </>
          )}

        {showNaming && syncedCourses.length === 0 && (
          <>
            <p className="text-sm text-cool-gray">
              Give each course a short display name. This will be used to name
              Google Drive folders for student work (e.g. &quot;FLC&quot; or
              &quot;Chekhov&quot;).
            </p>
            <div className="space-y-3">
              {availableCourses
                .filter((c) => selectedCourseIds.has(c.id))
                .map((c) => (
                  <div key={c.id} className="space-y-1">
                    <label className="text-xs font-medium text-cool-gray">
                      {c.name}
                    </label>
                    <input
                      className="w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon disabled:opacity-50"
                      placeholder="Short name, e.g. FLC"
                      value={courseShortNames[c.id] ?? ""}
                      onChange={(e) =>
                        setCourseShortNames((prev) => ({
                          ...prev,
                          [c.id]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
            </div>
            <div className="flex gap-2">
              <button className="rounded-md border border-stone-300 px-3 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50" onClick={() => setShowNaming(false)}>
                Back
              </button>
              <button className="rounded-md bg-maroon px-3 py-1.5 text-sm font-medium text-white hover:bg-maroon-dark disabled:opacity-50" onClick={handleSyncSelected} disabled={syncing}>
                {syncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sync {selectedCourseIds.size} course
                {selectedCourseIds.size !== 1 ? "s" : ""}
              </button>
            </div>
          </>
        )}

        {syncedCourses.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Synced courses:</p>
            <ul className="space-y-1">
              {syncedCourses.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  {c.name}
                  {c.term && (
                    <span className="text-cool-gray">({c.term})</span>
                  )}
                </li>
              ))}
            </ul>
            <button
              className="rounded-md bg-maroon px-3 py-1.5 text-sm font-medium text-white hover:bg-maroon-dark disabled:opacity-50 mt-4"
              onClick={() => router.push("/teacher/dashboard")}
            >
              Go to dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
