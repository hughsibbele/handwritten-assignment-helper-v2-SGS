import {
  buildHandwrittenCardBlock,
  type HandwrittenCardText,
} from "@/lib/canvas/install";

/**
 * What students see in Canvas. Built using the same builder the install
 * path uses — single source of truth, no drift.
 *
 * The HTML comment marker is stripped from the preview since it doesn't
 * render visually but muddies the DOM.
 *
 * Stand-in IDs are accepted for preview-only routes (the editor on
 * /admin/card-text and /teacher/setup don't have a real assignment to
 * point at).
 */
export function CardPreview({
  appBaseUrl,
  courseId = "preview-course",
  assignmentId = "preview-assignment",
  text,
}: {
  appBaseUrl: string;
  courseId?: string;
  assignmentId?: string;
  text?: Partial<HandwrittenCardText>;
}) {
  const raw = buildHandwrittenCardBlock({
    appBaseUrl,
    courseId,
    assignmentId,
    text,
  });
  const html = raw.replace(/<!--\s*handwritten:card[^>]*-->\s*/i, "");
  return (
    <div className="rounded border border-stone-200 bg-stone-50 p-3">
      <div className="mb-2 text-[10px] uppercase tracking-wide text-cool-gray">
        Preview — what students see in Canvas
      </div>
      <div
        className="max-w-2xl"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
