"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter (optional)</CardTitle>
          <CardDescription>
            Limit export and delete to submissions older than this date. Leave
            blank to act on every submission in the database.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid max-w-sm gap-2">
            <Label htmlFor="beforeDate">Created before</Label>
            <Input
              id="beforeDate"
              type="date"
              value={beforeDate}
              onChange={(e) => setBeforeDate(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export</CardTitle>
          <CardDescription>
            Downloads a CSV including transcription text, Canvas submission
            text, Google Doc URL, page count, status, and timestamps for each
            submission in scope. UTF-8 BOM prepended so Excel-on-Windows
            imports cleanly.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleExport} disabled={exporting}>
            {exporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download CSV
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Hard delete
          </CardTitle>
          <CardDescription>
            Permanently removes submissions, their photos, and the linked
            storage objects. Irreversible. Export first if you want a record.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid max-w-sm gap-2">
            <Label htmlFor="confirm">
              Type <span className="font-mono">DELETE</span> to confirm
            </Label>
            <Input
              id="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
            />
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || confirm !== "DELETE"}
            >
              {deleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {beforeDate
                ? `Delete everything before ${beforeDate}`
                : "Delete everything"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
