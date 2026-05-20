// Marker-block helpers for the install-it-for-you flow.
//
// The teacher's Canvas assignment description is HTML they own. We embed our
// upload card just after a single HTML comment marker so we can find,
// replace, and remove our block without disturbing anything else they wrote:
//
//   <!-- handwritten:card v=1 assignment-id=<uuid> -->
//   <div style="border:..."> ... EHS card ... </div>
//
// Single-marker shape (vs. AI Documenter's begin/end pair) per the suite's
// integration-contract §12 canonical: `<peer>:<artifact> v=N attrs`. The
// block boundary is "marker line + the first `<div>...</div>` that follows
// it (depth-counted)."
//
// Operations are pure (no I/O) so they can be unit-tested in isolation. The
// network-touching install action (read description → patch → PUT) lives in
// the API route.

const MARKER_RE =
  /<!--\s*handwritten:card(\s+[^>]*?)?\s*-->/i;

export type MarkerMeta = {
  assignmentId: string | null;
  schemaVersion: number | null;
};

export type FoundCardBlock = MarkerMeta & {
  /** Index in the source HTML where the block starts (marker position). */
  start: number;
  /** Index immediately after the end of the block (end of div). */
  end: number;
  /** The block's full text as it appeared. */
  raw: string;
};

/**
 * Plain-text strings teachers (or admins) can override per-teacher. The
 * structure of the card (logo, colors, padding, layout) is fixed; only
 * the words change. Each field is plain text — we HTML-escape on insert,
 * so curly quotes and unicode characters pass through but tags do not.
 *
 * M6.15: ported from OE's ExamCardText shape so the editor / preview /
 * resolver code can mirror across apps.
 */
export type HandwrittenCardText = {
  /** Small ALL-CAPS line above the title. */
  kicker: string;
  /** h3 title under the kicker. */
  title: string;
  /** Paragraph body between title and CTA. */
  body: string;
  /** Button label. */
  ctaLabel: string;
  /** Italic line beneath the CTA. */
  footnote: string;
};

/** Suite-default copy. Falls back here if no admin/teacher overrides are
 *  provided. Kept in this file so the package has zero runtime dependency
 *  on Supabase. */
export const DEFAULT_HANDWRITTEN_CARD_TEXT: HandwrittenCardText = {
  kicker: "Handwritten work · Upload to submit",
  title: "Submit your handwritten work",
  body: "Take clear photos of each page, then upload them here. We’ll transcribe your work, save it as a Google Doc in your Drive, and (when your teacher has it turned on) submit the transcript to Canvas for you.",
  ctaLabel: "Upload handwritten work →",
  footnote: "Sign in with your @episcopalhighschool.org Google account.",
};

export type BuildCardArgs = {
  /**
   * App origin where students upload. Used for the CTA href.
   * Example: "https://handwritten-assignment-helper-v2-sg.vercel.app" or
   * "http://localhost:3000". Trailing slash is fine; it's stripped.
   */
  appBaseUrl: string;
  /** HAH internal UUID for the course (the courseId path segment). */
  courseId: string;
  /** HAH internal UUID for the assignment (the assignmentId path segment). */
  assignmentId: string;
  /**
   * Optional plain-text overrides. Resolver typically reads
   * teacher_overrides ?? card_text_defaults and passes the effective shape
   * here. Falls back to DEFAULT_HANDWRITTEN_CARD_TEXT field-by-field.
   */
  text?: Partial<HandwrittenCardText>;
};

const SCHEMA_VERSION = 1;
const UUID_RE = /^[A-Za-z0-9-]+$/;

/**
 * Render the marker + card. Pure string concat — caller must pass the right
 * appBaseUrl for the environment (NEXT_PUBLIC_APP_URL).
 *
 * Output goes into a Canvas assignment description (sanitized HTML). We rely
 * only on tags Canvas's RCE permits: `div`, `img`, `h3`, `p`, `a`, inline
 * `style`. No classes (Canvas may strip them), no data attrs, no JS.
 */
export function buildHandwrittenCardBlock(args: BuildCardArgs): string {
  const base = args.appBaseUrl.replace(/\/+$/, "");
  if (!base) {
    throw new Error("buildHandwrittenCardBlock: appBaseUrl is required");
  }
  const courseId = safeUuidLike(args.courseId, "courseId");
  const assignmentId = safeUuidLike(args.assignmentId, "assignmentId");
  const uploadUrl = escapeHtmlAttr(
    `${base}/student/courses/${courseId}/assignments/${assignmentId}`,
  );
  const logoUrl = escapeHtmlAttr(`${base}/ehs-logo.webp`);
  const text: HandwrittenCardText = {
    kicker: args.text?.kicker ?? DEFAULT_HANDWRITTEN_CARD_TEXT.kicker,
    title: args.text?.title ?? DEFAULT_HANDWRITTEN_CARD_TEXT.title,
    body: args.text?.body ?? DEFAULT_HANDWRITTEN_CARD_TEXT.body,
    ctaLabel: args.text?.ctaLabel ?? DEFAULT_HANDWRITTEN_CARD_TEXT.ctaLabel,
    footnote: args.text?.footnote ?? DEFAULT_HANDWRITTEN_CARD_TEXT.footnote,
  };
  return [
    `<!-- handwritten:card v=${SCHEMA_VERSION} assignment-id=${assignmentId} -->`,
    `<div style="border:2px solid #7a1e46;border-radius:4px;padding:28px;margin:16px 0;background:#ffffff;font-family:Georgia,'Times New Roman',serif;">`,
    `<img src="${logoUrl}" alt="Episcopal High School" style="display:block;height:50px;width:auto;margin-bottom:18px;" />`,
    `<div style="color:#54565b;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">${escapeHtmlText(text.kicker)}</div>`,
    `<h3 style="margin:0 0 10px 0;color:#1a1a1a;font-size:20px;font-weight:normal;line-height:1.3;">${escapeHtmlText(text.title)}</h3>`,
    `<p style="margin:0 0 22px 0;color:#333;font-size:15px;line-height:1.6;">${escapeHtmlText(text.body)}</p>`,
    `<a href="${uploadUrl}" style="display:inline-block;padding:12px 26px;background:#7a1e46;color:#ffffff;border-radius:3px;text-decoration:none;font-family:Georgia,'Times New Roman',serif;font-weight:bold;font-size:15px;letter-spacing:0.3px;">${escapeHtmlText(text.ctaLabel)}</a>`,
    `<p style="margin:14px 0 0 0;color:#54565b;font-size:12px;font-style:italic;">${escapeHtmlText(text.footnote)}</p>`,
    `</div>`,
  ].join("\n");
}

/**
 * Locate the first marker-and-div block in `html`. Returns null if absent.
 * If the marker has no following `<div>`, returns null (orphan marker is
 * treated as "not present" so a subsequent install repairs it).
 */
export function findCardMarkerBlock(html: string): FoundCardBlock | null {
  const markerMatch = MARKER_RE.exec(html);
  if (!markerMatch) return null;
  const start = markerMatch.index;
  const afterMarker = start + markerMatch[0].length;

  // Find the next <div> opening (skipping any whitespace).
  const openTagRe = /<div\b[^>]*>/gi;
  openTagRe.lastIndex = afterMarker;
  const openMatch = openTagRe.exec(html);
  if (!openMatch) return null;

  // Ensure only whitespace sits between the marker and the div (nothing
  // unrelated). This keeps us from accidentally swallowing a teacher's own
  // content following an orphan marker.
  const between = html.slice(afterMarker, openMatch.index);
  if (between.replace(/\s+/g, "") !== "") return null;

  const closeEnd = findMatchingDivClose(html, openMatch.index + openMatch[0].length);
  if (closeEnd < 0) return null;

  const meta = parseMarkerAttrs(markerMatch[1] ?? "");
  return {
    ...meta,
    start,
    end: closeEnd,
    raw: html.slice(start, closeEnd),
  };
}

export function hasCardMarkerBlock(html: string): boolean {
  return findCardMarkerBlock(html) !== null;
}

/**
 * Locate our card via marker first, then via comment-stripped fallback:
 * find an `<a>` whose href points at `/student/courses/<cid>/assignments/<aid>`
 * and walk outward to the enclosing `<div>`. Canvas's HTML sanitizer drops
 * comments on some edit paths — without this fallback an uninstall after a
 * paste-through-the-editor would leave the card stranded.
 */
export function findCardBlock(
  html: string,
  locator?: { courseId: string; assignmentId: string },
): FoundCardBlock | null {
  const marker = findCardMarkerBlock(html);
  if (marker) return marker;
  if (!locator) return null;
  return findCardBlockByAnchorUrl(html, locator.courseId, locator.assignmentId);
}

/**
 * Strip every block we own from the description: marker-wrapped blocks AND
 * (with the locator) bare cards by anchor URL. Used by install/uninstall
 * to converge on "exactly zero of our blocks" so duplicates get cleaned up.
 */
function stripAllBlocks(
  html: string,
  locator?: { courseId: string; assignmentId: string },
): string {
  let out = html ?? "";
  const drain = (find: () => FoundCardBlock | null) => {
    while (true) {
      const m = find();
      if (!m) break;
      const before = out.slice(0, m.start).replace(/\s+$/, "");
      const after = out.slice(m.end).replace(/^\s+/, "");
      if (before === "") out = after;
      else if (after === "") out = before;
      else out = before + "\n\n" + after;
    }
  };
  drain(() => findCardMarkerBlock(out));
  if (locator) {
    drain(() =>
      findCardBlockByAnchorUrl(out, locator.courseId, locator.assignmentId),
    );
  }
  return out;
}

/**
 * Insert the block, ensuring exactly one of our blocks ends up in the
 * description. Strips any pre-existing block (marker-wrapped or
 * comment-stripped-by-anchor) before inserting fresh.
 */
export function replaceOrAppendCardBlock(
  existingHtml: string,
  newBlockHtml: string,
  locator?: { courseId: string; assignmentId: string },
): string {
  const stripped = stripAllBlocks(existingHtml ?? "", locator);
  const trimmed = stripped.replace(/\s+$/, "").replace(/^\s+/, "");
  if (trimmed === "") return newBlockHtml;
  return trimmed + "\n\n" + newBlockHtml;
}

/**
 * Strip every block we own from the description and tidy whitespace. With
 * the locator, also catches comment-stripped cards.
 */
export function removeCardBlock(
  existingHtml: string,
  locator?: { courseId: string; assignmentId: string },
): string {
  const stripped = stripAllBlocks(existingHtml ?? "", locator);
  if (stripped === (existingHtml ?? "")) return existingHtml ?? "";
  return stripped.replace(/\s+$/, "").replace(/^\s+/, "");
}

// ---------------------------------------------------------------------------
// Comment-stripped fallback: find a bare card by its CTA anchor.

function findCardBlockByAnchorUrl(
  html: string,
  courseId: string,
  assignmentId: string,
): FoundCardBlock | null {
  const cid = safeUuidLike(courseId, "courseId");
  const aid = safeUuidLike(assignmentId, "assignmentId");

  // Anchor whose href contains `/student/courses/<cid>/assignments/<aid>`.
  const hrefRe = new RegExp(
    `<a\\b[^>]*\\bhref="[^"]*\\/student\\/courses\\/${cid}\\/assignments\\/${aid}\\b[^"]*"[^>]*>[\\s\\S]*?<\\/a\\s*>`,
    "i",
  );
  const aMatch = hrefRe.exec(html);
  if (!aMatch) return null;
  const aStart = aMatch.index;
  const aEnd = aStart + aMatch[0].length;

  // Find all <div> openings before the anchor; try innermost first.
  const beforeA = html.slice(0, aStart);
  const opens: Array<{ index: number; end: number }> = [];
  const openTagRe = /<div\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = openTagRe.exec(beforeA)) !== null) {
    opens.push({ index: m.index, end: m.index + m[0].length });
  }
  if (opens.length === 0) return null;

  for (let i = opens.length - 1; i >= 0; i--) {
    const open = opens[i];
    const closeEnd = findMatchingDivClose(html, open.end);
    if (closeEnd < 0) continue;
    if (closeEnd >= aEnd) {
      return {
        assignmentId: aid,
        schemaVersion: null,
        start: open.index,
        end: closeEnd,
        raw: html.slice(open.index, closeEnd),
      };
    }
  }
  return null;
}

/** Walk forward from `fromPos` counting <div>/</div> nesting; return the
 * position right after the matching </div>, or -1 if not found. */
function findMatchingDivClose(html: string, fromPos: number): number {
  let pos = fromPos;
  let depth = 1;
  const tagRe = /<(\/?)div\b[^>]*>/gi;
  while (depth > 0) {
    tagRe.lastIndex = pos;
    const m = tagRe.exec(html);
    if (!m) return -1;
    pos = m.index + m[0].length;
    if (m[1] === "/") {
      depth--;
      if (depth === 0) return pos;
    } else {
      depth++;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------

function parseMarkerAttrs(attrText: string): MarkerMeta {
  // attrText looks like " v=1 assignment-id=abc..."
  const meta: MarkerMeta = {
    assignmentId: null,
    schemaVersion: null,
  };
  const ATTR_RE = /([a-z][a-z0-9-]*)\s*=\s*("([^"]*)"|([^\s]+))/gi;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrText)) !== null) {
    const key = m[1]?.toLowerCase();
    const value = m[3] ?? m[4] ?? "";
    if (key === "assignment-id") meta.assignmentId = value;
    else if (key === "v") {
      const n = Number(value);
      meta.schemaVersion = Number.isFinite(n) ? n : null;
    }
  }
  return meta;
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Escape user-supplied plain text for inclusion inside an HTML element.
 *  Quotes are fine inside text content; only the structural chars matter. */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Marker attrs are inside an HTML comment — restrict to URL-safe chars. */
function safeUuidLike(s: string, label: string): string {
  if (!UUID_RE.test(s)) {
    throw new Error(
      `${label} must match /^[A-Za-z0-9-]+$/. Got: ${JSON.stringify(s)}`,
    );
  }
  return s;
}
