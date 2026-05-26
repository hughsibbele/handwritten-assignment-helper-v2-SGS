"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { sortByProximity } from "@/lib/assignment-sort";
import {
  bulkInstallAssignments,
  bulkUninstallAssignments,
  type BulkResult,
} from "@/lib/actions/bulk-install";
import type { AssignmentRow, CourseGroup } from "./dashboard.types";

// Persist open/closed in sessionStorage so the user's selection survives a
// router.refresh() after install/uninstall.
function useSessionFlag(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    if (typeof window === "undefined") return initial;
    const raw = sessionStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return initial;
  });
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? group.assignments.filter((a) => a.title.toLowerCase().includes(q))
      : group.assignments;
    return sortByProximity(list);
  }, [group.assignments, search]);

  function toggleSelection(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  const selectedAssignments = useMemo(
    () => filtered.filter((a) => selectedIds.has(a.id)),
    [filtered, selectedIds],
  );

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
            <div className="truncate text-sm text-ink">
              {group.short_name && (
                <span className="mr-2 font-semibold text-maroon">{group.short_name}</span>
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
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
              {group.installedCount} installed
            </span>
          )}
          <button
            className="rounded-md px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-50"
            onClick={handleResync}
            disabled={syncing}
          >
            <RefreshCw
              className={`mr-1 inline h-3 w-3 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing…" : "Re-sync"}
          </button>
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
              {selectedIds.size > 0 && (
                <div className="border-b border-stone-100 bg-stone-50 px-4 py-3 text-xs">
                  <BulkActions
                    courseId={group.id}
                    selectedIds={Array.from(selectedIds)}
                    selectedAssignments={selectedAssignments}
                    onClearSelection={clearSelection}
                  />
                </div>
              )}

              <div className="flex items-center gap-2 border-b border-stone-100 px-4 py-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search assignments…"
                    className="w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 pl-8 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon disabled:opacity-50"
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
                      assignment={a}
                      courseId={group.id}
                      checked={selectedIds.has(a.id)}
                      onToggle={() => toggleSelection(a.id)}
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
  assignment,
  courseId,
  checked,
  onToggle,
}: {
  assignment: AssignmentRow;
  courseId: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const isDiscussion = !!assignment.canvas_discussion_topic_id;
  const canInstall = !!assignment.canvas_assignment_id;

  // Compact destination summary: D / C / S characters lit when active.
  const destChars: { char: string; active: boolean; label: string }[] = [
    { char: "D", active: assignment.post_to_drive, label: "Drive" },
    {
      char: "C",
      active: assignment.post_to_canvas_comment,
      label: "Canvas draft comment",
    },
    {
      char: "S",
      active: assignment.post_to_canvas_submission,
      label: isDiscussion ? "Canvas discussion reply" : "Canvas submission",
    },
  ];

  return (
    <li className="flex items-center gap-3 px-4 py-2 hover:bg-stone-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={!canInstall}
        className="h-4 w-4 shrink-0"
        title={canInstall ? "Select" : "No Canvas id — re-sync this course"}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-stone-900">
          {assignment.title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
          {assignment.due_date && (
            <span>Due {new Date(assignment.due_date).toLocaleDateString()}</span>
          )}
          {isDiscussion && (
            <span className="shrink-0 rounded-full border border-stone-300 px-2 py-0.5 text-[10px] text-stone-500">
              Discussion
            </span>
          )}
          {assignment.installed ? (
            <>
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                Card installed
              </span>
              <a
                href={`/student/courses/${courseId}/assignments/${assignment.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-dark-blue underline-offset-2 hover:underline"
              >
                Preview
              </a>
            </>
          ) : (
            <span className="text-stone-400">Not installed</span>
          )}
          {assignment.inSuperGraderScope && (
            <span
              className="shrink-0 rounded-full bg-[#7a1e46] px-2 py-0.5 text-[10px] font-medium text-white"
              title="This assignment is tracked in super-grader. HAH still writes to Drive, but skips its own Canvas submit — super-grader owns the final post."
            >
              ↗ super-grader
            </span>
          )}
          {canInstall && (
            <span
              className="ml-1 inline-flex gap-0.5 font-mono text-[10px]"
              title="D = Drive · C = Canvas draft comment · S = Canvas submission"
            >
              {destChars.map((d) => (
                <span
                  key={d.char}
                  className={
                    d.active
                      ? "rounded bg-maroon/15 px-1 text-maroon"
                      : "rounded bg-stone-100 px-1 text-stone-400"
                  }
                  title={`${d.label}: ${d.active ? "on" : "off"}`}
                >
                  {d.char}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function BulkActions({
  courseId,
  selectedIds,
  selectedAssignments,
  onClearSelection,
}: {
  courseId: string;
  selectedIds: string[];
  selectedAssignments: AssignmentRow[];
  onClearSelection: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // M6.18b defaults: Drive ✓ (locked-on), Submission ✓, Comment ✗. The
  // first selected row's saved destination is honored ONLY when that row
  // has actually been installed before — otherwise the bar shows the
  // per-app defaults. (The migration's backfill from canvas_submit_by_default
  // inherited "off" onto rows that were never installed, so those rows have
  // post_to_canvas_submission=false in the DB even though the teacher never
  // chose that — falling through to defaults gives the right initial state.)
  const first = selectedAssignments[0];
  const useSaved = first?.installed ?? false;
  const [postToDrive, _setPostToDrive] = useState(true); // locked-on for HAH
  const [postToComment, setPostToComment] = useState(
    useSaved ? (first?.post_to_canvas_comment ?? false) : false,
  );
  const [postToSubmission, setPostToSubmission] = useState(
    useSaved ? (first?.post_to_canvas_submission ?? true) : true,
  );
  // Avoid "unused setter" warning while keeping the symbol around for the
  // future "unlock per-school admin override" path.
  void _setPostToDrive;

  const someInstalled = selectedAssignments.some((a) => a.installed);

  // M3.8 / M6.18b: when every selected assignment is in super-grader's
  // scope, SG owns the Canvas write — disable the Canvas checkboxes to
  // mirror what HAH actually does at confirm time. Drive stays on (and
  // remains locked-on per HAH's M6.18 spec).
  const allInSuperGraderScope =
    selectedAssignments.length > 0 &&
    selectedAssignments.every((a) => a.inSuperGraderScope);
  const someInSuperGraderScope =
    selectedAssignments.some((a) => a.inSuperGraderScope);
  const effectiveComment = allInSuperGraderScope ? false : postToComment;
  const effectiveSubmission = allInSuperGraderScope ? false : postToSubmission;

  function run(op: "install" | "uninstall") {
    startTransition(async () => {
      let result: BulkResult;
      if (op === "install") {
        result = await bulkInstallAssignments(courseId, selectedIds, {
          drive: postToDrive,
          comment: effectiveComment,
          submission: effectiveSubmission,
        });
      } else {
        if (
          !window.confirm(
            `Uninstall the card from ${selectedIds.length} assignment${selectedIds.length === 1 ? "" : "s"}?`,
          )
        )
          return;
        result = await bulkUninstallAssignments(courseId, selectedIds);
      }
      if (result.failureCount === 0) {
        toast.success(
          `${result.successCount} assignment${result.successCount === 1 ? "" : "s"} ${op === "install" ? "installed" : "uninstalled"}`,
        );
        onClearSelection();
        router.refresh();
      } else {
        toast.error(
          `${result.successCount} succeeded, ${result.failureCount} failed`,
        );
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="font-semibold text-stone-700">
        {selectedIds.length} selected
      </span>

      <fieldset className="inline-flex items-center gap-3 text-stone-600">
        <legend className="text-[11px] uppercase tracking-wide text-stone-500">
          Transcript submitted to:
        </legend>
        <DestinationCheckbox
          label="Drive"
          checked={postToDrive}
          onChange={() => {
            /* locked-on for HAH */
          }}
          disabled={true}
          title="Student transcripts always land in their own Drive folder — this is HAH's core feature and can't be turned off."
        />
        <DestinationCheckbox
          label="Canvas as draft comment"
          checked={effectiveComment}
          onChange={setPostToComment}
          disabled={pending || allInSuperGraderScope}
          title={
            allInSuperGraderScope
              ? "Routed via super-grader — SG owns the final Canvas post; HAH will skip this write."
              : "Reserved — draft comment writer ships in a follow-up. Checkbox stores intent now so existing installs are ready when the writer goes live."
          }
        />
        <DestinationCheckbox
          label="Canvas as submission"
          checked={effectiveSubmission}
          onChange={setPostToSubmission}
          disabled={pending || allInSuperGraderScope}
          title={
            allInSuperGraderScope
              ? "Routed via super-grader — SG owns the final Canvas post; HAH will skip this write."
              : "Post the transcript as the student's submission body. For discussion topics this becomes a discussion reply."
          }
        />
      </fieldset>

      <button
        type="button"
        onClick={onClearSelection}
        disabled={pending}
        className="rounded-md px-2 py-1 text-stone-600 hover:bg-stone-100 disabled:opacity-50"
      >
        Cancel
      </button>
      {someInstalled && (
        <button
          type="button"
          onClick={() => run("uninstall")}
          disabled={pending}
          className="rounded-md border border-stone-300 px-3 py-1 font-semibold text-stone-700 hover:bg-stone-100 disabled:opacity-50"
        >
          {pending ? "Working…" : "Uninstall"}
        </button>
      )}
      <button
        type="button"
        onClick={() => run("install")}
        disabled={
          pending ||
          (!postToDrive && !postToComment && !postToSubmission)
        }
        className="rounded-md bg-maroon px-3 py-1 font-semibold text-white hover:bg-maroon/90 disabled:opacity-50"
      >
        {pending ? (
          <>
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            Installing…
          </>
        ) : someInstalled ? (
          "Reinstall"
        ) : (
          "Install card"
        )}
      </button>

      <p className="basis-full text-[11px] italic text-stone-500">
        {describeDestination({
          drive: postToDrive,
          comment: effectiveComment,
          submission: effectiveSubmission,
        })}
        {allInSuperGraderScope && (
          <span className="ml-1 not-italic text-[#7a1e46]">
            · routed via super-grader (Canvas write suppressed; Drive still happens)
          </span>
        )}
        {!allInSuperGraderScope && someInSuperGraderScope && (
          <span className="ml-1 not-italic text-amber-700">
            · mixed scope — only some selected are in super-grader; review per-row
          </span>
        )}
      </p>
    </div>
  );
}

function DestinationCheckbox({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  title: string;
}) {
  return (
    <label className="inline-flex items-center gap-1.5" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-3.5 w-3.5 rounded border-stone-300 accent-primary disabled:opacity-50"
      />
      <span className="text-xs">{label}</span>
    </label>
  );
}

function describeDestination(d: {
  drive: boolean;
  comment: boolean;
  submission: boolean;
}): string {
  const targets: string[] = [];
  if (d.drive) targets.push("a Google Doc in the student's Drive folder");
  if (d.comment) targets.push("a Canvas draft comment");
  if (d.submission) targets.push("the student's Canvas submission body");
  if (targets.length === 0) {
    return "Nothing checked — transcript won't be saved anywhere. Pick at least one destination.";
  }
  if (targets.length === 1) {
    return `Transcript will be saved to ${targets[0]}.`;
  }
  if (targets.length === 2) {
    return `Transcript will be saved to ${targets[0]} and ${targets[1]}.`;
  }
  return `Transcript will be saved to ${targets[0]}, ${targets[1]}, and ${targets[2]}.`;
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
