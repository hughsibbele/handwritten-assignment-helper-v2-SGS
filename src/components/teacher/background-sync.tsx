"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Fires a background Canvas sync for each course when mounted.
 * Refreshes the page data when all syncs complete (no loading state shown).
 * Only syncs once per page load.
 */
export function BackgroundSync({ courseIds }: { courseIds: string[] }) {
  const router = useRouter();
  const didSync = useRef(false);

  useEffect(() => {
    if (didSync.current || courseIds.length === 0) return;
    didSync.current = true;

    Promise.allSettled(
      courseIds.map((id) =>
        fetch(`/api/courses/${id}/sync`, { method: "POST" })
      )
    ).then(() => {
      // Refresh server component data so counts update
      router.refresh();
    });
  }, [courseIds, router]);

  return null;
}
