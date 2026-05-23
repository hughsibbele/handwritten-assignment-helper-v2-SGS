"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { sortByProximity } from "@/lib/assignment-sort";

type AssignmentRow = {
  id: string;
  title: string;
  due_date: string | null;
  course: { id: string; name: string } | null;
};

type SubmissionRef = { id: string; status: string };

export function UpcomingAssignments({
  assignments,
  submissionByAssignment,
}: {
  assignments: AssignmentRow[];
  submissionByAssignment: Record<string, SubmissionRef>;
}) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? assignments.filter((a) => a.title.toLowerCase().includes(q))
      : assignments;
    return sortByProximity(filtered);
  }, [assignments, search]);

  if (assignments.length === 0) {
    return <p className="text-sm text-cool-gray">No assignments yet</p>;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cool-gray" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search assignments…"
          className="pl-8"
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-cool-gray">
          No assignments match &ldquo;{search}&rdquo;.
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((a) => {
            const sub = submissionByAssignment[a.id];
            const inProgress =
              sub && ["draft", "processing", "review"].includes(sub.status);
            const isDone =
              sub && ["confirmed", "submitted"].includes(sub.status);

            const primaryHref =
              inProgress && sub!.status !== "draft"
                ? `/student/submissions/${sub!.id}`
                : isDone
                  ? `/student/submissions/${sub!.id}`
                  : `/student/courses/${a.course?.id}/assignments/${a.id}`;

            return (
              <li key={a.id}>
                <div className="rounded-lg border p-3 transition-colors hover:bg-muted/50">
                  <Link href={primaryHref} className="block">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{a.title}</p>
                      {inProgress && (
                        <Badge variant="outline">In Progress</Badge>
                      )}
                      {isDone && <Badge variant="default">Submitted</Badge>}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-cool-gray">
                      <span>{a.course?.name}</span>
                      {a.due_date && (
                        <>
                          <span>&middot;</span>
                          <span>
                            Due {new Date(a.due_date).toLocaleDateString()}
                          </span>
                        </>
                      )}
                    </div>
                  </Link>
                  {inProgress && sub!.status !== "draft" && (
                    <div className="mt-2">
                      <Link
                        href={`/student/submissions/${sub!.id}`}
                        className="text-sm font-medium text-maroon hover:underline"
                      >
                        Continue Working
                      </Link>
                    </div>
                  )}
                  {isDone && (
                    <div className="mt-2">
                      <Link
                        href={`/student/courses/${a.course?.id}/assignments/${a.id}?resubmit=true`}
                        className="text-sm font-medium text-maroon hover:underline"
                      >
                        Resubmit
                      </Link>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
