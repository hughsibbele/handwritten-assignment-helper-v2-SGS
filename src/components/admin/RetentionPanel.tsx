"use client";

import { useState } from "react";
import { Loader2, Download, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export function RetentionPanel() {
  const [beforeDate, setBeforeDate] = useState("");
  const [confirm, setConfirm] = useState("");
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const url = beforeDate
        ? `/api/admin/retention/export?before=${encodeURIComponent(beforeDate)}`
        : "/api/admin/retention/export";
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Export failed");
      }
      const blob = await res.blob();
      const link = document.createElement("a");
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      const stamp = new Date().toISOString().slice(0, 10);
      link.download = `hah-submissions-${stamp}.csv`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      toast.success("CSV downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete() {
    if (confirm !== "DELETE") {
      toast.error('Type "DELETE" exactly to confirm');
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch("/api/admin/retention/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beforeDate: beforeDate || null }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Delete failed");
      }
      const { deletedSubmissions, deletedPhotos } = await res.json();
      toast.success(
        `Deleted ${deletedSubmissions} submissions, ${deletedPhotos} photos`,
      );
      setConfirm("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="rounded-md border border-stone-200 bg-white">
        <div className="px-5 pt-5">
          <div className="text-base font-medium text-ink leading-snug">Filter (optional)</div>
          <div className="mt-1 text-sm text-stone-500">
            Limit export and delete to submissions older than this date. Leave
            blank to act on every submission in the database.
          </div>
        </div>
        <div className="px-5">
          <div className="grid max-w-sm gap-2">
            <label htmlFor="beforeDate" className="text-sm font-medium">Created before</label>
            <input
              id="beforeDate"
              type="date"
              value={beforeDate}
              onChange={(e) => setBeforeDate(e.target.value)}
              className="w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon disabled:opacity-50"
            />
          </div>
        </div>
      </div>

      <div className="rounded-md border border-stone-200 bg-white">
        <div className="px-5 pt-5">
          <div className="text-base font-medium text-ink leading-snug">Export</div>
          <div className="mt-1 text-sm text-stone-500">
            Downloads a CSV including transcription text, Canvas submission
            text, Google Doc URL, page count, status, and timestamps for each
            submission in scope. UTF-8 BOM prepended so Excel-on-Windows
            imports cleanly.
          </div>
        </div>
        <div className="px-5">
          <button onClick={handleExport} disabled={exporting} className="rounded-md bg-maroon px-3 py-1.5 text-sm font-medium text-white hover:bg-maroon-dark disabled:opacity-50">
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download CSV
          </button>
        </div>
      </div>

      <div className="rounded-md border border-stone-200 bg-white border-destructive/40">
        <div className="px-5 pt-5">
          <div className="text-base font-medium text-ink leading-snug flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-4 w-4" />
            Hard delete
          </div>
          <div className="mt-1 text-sm text-stone-500">
            Permanently removes submissions, their photos, and the linked
            storage objects. Irreversible. Export first if you want a record.
          </div>
        </div>
        <div className="px-5">
          <div className="grid max-w-sm gap-2">
            <label htmlFor="confirm" className="text-sm font-medium">
              Type <span className="font-mono">DELETE</span> to confirm
            </label>
            <input
              id="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              className="w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon disabled:opacity-50"
            />
            <button
              onClick={handleDelete}
              disabled={deleting || confirm !== "DELETE"}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {beforeDate
                ? `Delete everything before ${beforeDate}`
                : "Delete everything"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
