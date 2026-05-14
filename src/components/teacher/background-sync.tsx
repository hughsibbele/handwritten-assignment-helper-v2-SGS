"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { termIsCurrent } from "@/lib/academic-year";

/**
 * Fires a background Canvas sync for each course when mounted. Skips courses
 * whose Canvas term doesn't match the current academic year — those still
 * appear in the dashboard, we just don't waste API calls re-pulling their
 * assignments and rosters on every page load. The manual "Re-sync" button
 * remains the escape hatch for forcing a sync on an older course.
 */
export function BackgroundSync({
  courses,
}: {
  courses: { id: string; term: string | null }[];
}) {
  const router = useRouter();
  const didSync = useRef(false);

  useEffect(() => {
    if (didSync.current) return;
    didSync.current = true;

    const active = courses.filter((c) => termIsCurrent(c.term));
    if (active.length === 0) return;

    Promise.allSettled(
      active.map((c) =>
        fetch(`/api/courses/${c.id}/sync`, { method: "POST" })
      )
    ).then(() => {
      router.refresh();
    });
  }, [courses, router]);

  return null;
}
