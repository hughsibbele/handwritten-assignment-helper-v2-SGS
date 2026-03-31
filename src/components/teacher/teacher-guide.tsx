"use client";

import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function TeacherGuide() {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <HelpCircle className="mr-1 h-4 w-4" />
            Guide
          </Button>
        }
      />
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How to Use the Assignment Helper</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground">
          <section>
            <h3 className="mb-1 font-semibold text-foreground">
              1. Sync Your Courses
            </h3>
            <p>
              Click <strong>Setup</strong> to connect your Canvas account and
              select which courses to sync. Students and assignments are pulled
              automatically from Canvas.
            </p>
          </section>

          <section>
            <h3 className="mb-1 font-semibold text-foreground">
              2. Configure Assignments
            </h3>
            <p>
              Click a course to see its assignments. Use the{" "}
              <strong>auto-submit to Canvas</strong> toggle on each assignment
              to control whether student submissions are automatically posted
              back to Canvas.
            </p>
          </section>

          <section>
            <h3 className="mb-1 font-semibold text-foreground">
              3. Students Upload &amp; Submit
            </h3>
            <p>
              Students sign in with their school Google account, select an
              assignment, and upload photos of their handwritten work. The app
              transcribes the text using AI and lets them review before
              confirming.
            </p>
          </section>

          <section>
            <h3 className="mb-1 font-semibold text-foreground">
              4. What Happens on Confirm
            </h3>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                A <strong>Google Doc</strong> is created in the student&apos;s
                Drive, inside a folder shared with you
              </li>
              <li>
                If auto-submit is on, the transcription is{" "}
                <strong>submitted to Canvas</strong> as well
              </li>
              <li>
                Discussion-type assignments are posted as discussion entries
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-1 font-semibold text-foreground">
              5. Re-syncing
            </h3>
            <p>
              Courses sync automatically when you load the dashboard. You can
              also manually re-sync from any course detail page to pick up new
              assignments or students.
            </p>
          </section>

          <section className="rounded-md border border-border bg-muted/50 p-3">
            <h3 className="mb-1 font-semibold text-foreground">
              Tips
            </h3>
            <ul className="list-disc space-y-1 pl-4">
              <li>
                Set a <strong>short name</strong> for each course in Setup
                &mdash; it&apos;s used for the Drive folder name (e.g. &ldquo;FLC
                &ndash; Smith&rdquo;)
              </li>
              <li>
                Students need to sign in with the same Google account that
                matches their Canvas email
              </li>
              <li>
                Photos are stored temporarily and cleaned up after 3 months
                &mdash; transcriptions and Google Docs are kept
              </li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
