"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { sortByProximity } from "@/lib/assignment-sort";
import type { AssignmentRow, CourseGroup } from "./dashboard.types";

// Persist open/closed in sessionStorage so the user's selection survives a
// router.refresh() after install/uninstall.
function useSessionFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const raw = sessionStorage.getItem(key);
    if (raw === "1") setValue(true);
    else if (raw === "0") setValue(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function set(v: boolean) {
    setValue(v);
    sessionStorage.setItem(key, v ? "1" : "0");
  }
  return [value, set] as const;
}

export function CourseAccordion({ group }: { group: CourseGroup }) {
  const [open, setOpen] = useSessionFlag(`hah:course-${group.id}:open`, false);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? group.assignments.filter((a) => a.title.toLowerCase().includes(q))
      : group.assignments;
    return sortByProximity(list);
  }, [group.assignments, search]);

  async function handleResync() {
    setSyncing(true);
    try {
      const res = await fetch(`/api/courses/${group.id}/sync`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Sync failed");
      const data = await res.json();
      toast.success(
        `Synced ${data.assignmentCount ?? 0} assignments and ${data.studentCount ?? 0} students`,
      );
      router.refresh();
    } catch {
      toast.error("Failed to sync from Canvas");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="rounded-md border bg-white transition-colors hover:border-stone-300">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
        >
          <Chevron open={open} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-stone-900">
              {group.short_name && (
                <span className="mr-2 text-stone-500">{group.short_name}</span>
              )}
              {group.name}
            </div>
            <div className="mt-0.5 truncate text-[11px] text-stone-500">
              {group.term ?? "No term"} ·{" "}
              {group.assignments.length} assignment
              {group.assignments.length === 1 ? "" : "s"} ·{" "}
              {group.studentCount} student
              {group.studentCount === 1 ? "" : "s"} ·{" "}
              {formatSyncTime(group.last_synced_at)}
            </div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          {group.installedCount > 0 && (
            <Badge variant="secondary" className="text-[11px]">
              {group.installedCount} installed
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResync}
            disabled={syncing}
          >
            <RefreshCw
              className={`mr-1 h-3 w-3 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing…" : "Re-sync"}
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-stone-200">
          {group.assignments.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-stone-500">
              No assignments synced yet for this course.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search assignments…"
                    className="pl-8"
                  />
                </div>
                <span className="text-[11px] text-stone-500">
                  {filtered.length === group.assignments.length
                    ? `${group.assignments.length} total`
                    : `${filtered.length} of ${group.assignments.length}`}
                </span>
              </div>

              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-stone-500">
                  No assignments match &ldquo;{search}&rdquo;.
                </div>
              ) : (
                <ul className="divide-y divide-stone-100">
                  {filtered.map((a) => (
                    <AssignmentRowItem
                      key={a.id}
                      courseId={group.id}
                      assignment={a}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function AssignmentRowItem({
  courseId,
  assignment,
}: {
  courseId: string;
  assignment: AssignmentRow;
}) {
  const router = useRouter();
  const [installPending, startInstall] = useTransition();
  const [togglePending, startToggle] = useTransition();
  const isDiscussion = !!assignment.canvas_discussion_topic_id;
  const submissionTypes = assignment.canvas_submission_types ?? [];
  const canSubmit =
    isDiscussion || submissionTypes.includes("online_text_entry");

  function flipInstall() {
    const verb = assignment.installed ? "DELETE" : "POST";
    startInstall(async () => {
      try {
        const res = await fetch(
          `/api/teacher/assignments/${assignment.id}/install`,
          { method: verb },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Install failed");
        }
        toast.success(
          assignment.installed
            ? "Card removed from Canvas"
            : "Card installed on Canvas",
        );
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Install failed");
      }
    });
  }

  function flipToggle(next: boolean) {
    startToggle(async () => {
      try {
        const res = await fetch(`/api/assignments/${assignment.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canvas_submit_by_default: next }),
        });
        if (!res.ok) throw new Error();
        router.refresh();
      } catch {
        toast.error("Failed to update assignment setting");
      }
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-stone-50">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-stone-900">
          {assignment.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
          {assignment.due_date && (
            <span>Due {new Date(assignment.due_date).toLocaleDateString()}</span>
          )}
          {isDiscussion && (
            <Badge variant="outline" className="text-[10px]">
              Discussion
            </Badge>
          )}
          {assignment.installed && (
            <Badge variant="secondary" className="text-[10px]">
              Card installed
            </Badge>
          )}
        </div>
      </div>

      <label className="inline-flex shrink-0 items-center gap-1.5 text-xs text-stone-600">
        <input
          type="checkbox"
          checked={assignment.canvas_submit_by_default}
          disabled={!canSubmit || togglePending}
          onChange={(e) => flipToggle(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        {canSubmit
          ? isDiscussion
            ? "Auto-post"
            : "Auto-submit"
          : "Not supported"}
      </label>

      <Button
        variant={assignment.installed ? "outline" : "default"}
        size="sm"
        onClick={flipInstall}
        disabled={installPending || !assignment.canvas_assignment_id}
        title={
          assignment.canvas_assignment_id
            ? undefined
            : "Re-sync this course to populate Canvas IDs"
        }
      >
        {installPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {assignment.installed ? "Uninstall" : "Install card"}
      </Button>

      <Link
        href={`/teacher/courses/${courseId}/assignments/${assignment.id}/edit`}
        className="inline-flex items-center gap-1 text-xs text-stone-600 hover:text-stone-900"
      >
        <Settings2 className="h-3.5 w-3.5" />
        Configure
      </Link>
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 20 20"
      className={`shrink-0 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path
        d="M7 5l6 5-6 5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function formatSyncTime(iso: string | null): string {
  if (!iso) return "never synced";
  const then = new Date(iso).getTime();
  const ago = Date.now() - then;
  const min = Math.floor(ago / 60_000);
  if (min < 1) return "synced just now";
  if (min < 60) return `synced ${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `synced ${hr}h ago`;
  return `synced ${new Date(iso).toLocaleDateString()}`;
}
