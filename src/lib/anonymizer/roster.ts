import { createAdminClient } from "@/lib/supabase/admin";
import { anonToken } from "./token";
import { buildScrubber, type RosterEntry } from "./scrub";

// Fail-closed policy (Phase 0 of REMEDIATION_PLAN.md): getCourseScrubber
// THROWS RosterMissingError when any link in the (courseId → enrollments →
// students → salt) chain is missing or empty. Callers must catch and refuse
// to write transcript text. The prior "return a noop scrubber and cache it
// for 5 minutes" behavior silently let raw OCR output (including handwritten
// student names) land in submission_photos.raw_transcription. Explicit FERPA
// violation whenever it fired.
//
// Same shape OE M6.19 + AID M6.20 adopted last week.

const CACHE_TTL_MS = 5 * 60 * 1000;

type Cached = {
  expires: number;
  roster: RosterEntry[];
  scrub: (text: string) => string;
};

// Only successful results are cached. Failures bubble out so the next call
// retries without waiting for TTL eviction (matches AID's compiledRosterForCourse).
const cache = new Map<string, Cached>();

/**
 * Thrown by `getCourseScrubber` when the roster used for scrubbing is
 * missing, empty, or unusable (no salt configured). Callers must catch and
 * refuse to call Gemini OR refuse to write Gemini output — emitting
 * unscrubbed text is the FERPA violation Phase 0 closes.
 */
export class RosterMissingError extends Error {
  constructor(public readonly reason: string) {
    super(`roster_missing: ${reason}`);
    this.name = "RosterMissingError";
  }
}

/**
 * Build (and cache) a name-scrubber for a single course. Looks up every
 * enrolled student's display name + (canvas_user_id, email), computes their
 * anon_token, and compiles the regex set once. Subsequent calls within the
 * TTL reuse the compiled function — important when an Inngest worker
 * transcribes many pages of the same submission back-to-back.
 *
 * Throws `RosterMissingError` on: empty `courseId`, missing salt env, DB
 * error, no enrollments rows, all roster entries filtered out. Anonymizer
 * token computation throws separately on short salt (`anonToken`) — those
 * propagate too.
 */
export async function getCourseScrubber(
  courseId: string,
): Promise<(text: string) => string> {
  if (!courseId) {
    throw new RosterMissingError("empty courseId");
  }

  const hit = cache.get(courseId);
  if (hit && hit.expires > Date.now()) return hit.scrub;

  if (!process.env.SUPER_GRADER_SALT) {
    throw new RosterMissingError("SUPER_GRADER_SALT env var is unset");
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("enrollments")
    .select("students!inner ( canvas_user_id, email, display_name )")
    .eq("course_id", courseId);

  if (error) {
    throw new RosterMissingError(
      `enrollments lookup failed for course=${courseId}: ${error.message}`,
    );
  }

  type Row = {
    students: {
      canvas_user_id: number | null;
      email: string | null;
      display_name: string | null;
    };
  };
  const enrollmentRows = (rows as unknown as Row[] | null) ?? [];
  if (enrollmentRows.length === 0) {
    throw new RosterMissingError(
      `no enrollments for course=${courseId} — teacher needs to sync roster`,
    );
  }

  const roster: RosterEntry[] = [];
  for (const row of enrollmentRows) {
    const s = row.students;
    if (!s.canvas_user_id || !s.email || !s.display_name) continue;
    roster.push({
      display_name: s.display_name,
      anon_token: anonToken(s.canvas_user_id, s.email),
    });
  }

  if (roster.length === 0) {
    throw new RosterMissingError(
      `enrollments exist for course=${courseId} but every entry was filtered out (missing canvas_user_id / email / display_name)`,
    );
  }

  const scrub = buildScrubber(roster);
  cache.set(courseId, {
    expires: Date.now() + CACHE_TTL_MS,
    roster,
    scrub,
  });
  return scrub;
}

/**
 * Resolve a submission's course → scrubber in one round-trip. Used by the
 * Inngest OCR worker so the scrub is wired right at the Gemini-output
 * boundary. Throws `RosterMissingError` on every shape of failure
 * (same contract as `getCourseScrubber`).
 */
export async function getScrubberForSubmission(
  submissionId: string,
): Promise<(text: string) => string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("submissions")
    .select("assignments!inner ( course_id )")
    .eq("id", submissionId)
    .single();

  if (error) {
    throw new RosterMissingError(
      `submission lookup failed for submission=${submissionId}: ${error.message}`,
    );
  }
  const courseId =
    (data as unknown as { assignments: { course_id: string } } | null)
      ?.assignments?.course_id ?? null;
  if (!courseId) {
    throw new RosterMissingError(
      `no course_id resolvable for submission=${submissionId}`,
    );
  }
  return getCourseScrubber(courseId);
}

/** Test-only / on-demand invalidation. */
export function clearRosterCache(courseId?: string): void {
  if (courseId) cache.delete(courseId);
  else cache.clear();
}
