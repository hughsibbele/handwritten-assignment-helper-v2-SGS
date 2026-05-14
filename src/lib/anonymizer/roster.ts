import { createAdminClient } from "@/lib/supabase/admin";
import { anonToken } from "./token";
import { buildScrubber, type RosterEntry } from "./scrub";

const CACHE_TTL_MS = 5 * 60 * 1000;

type Cached = {
  expires: number;
  roster: RosterEntry[];
  scrub: (text: string) => string;
};

const cache = new Map<string, Cached>();

/**
 * Build (and cache) a name-scrubber for a single course. Looks up every
 * enrolled student's display name + (canvas_user_id, email), computes their
 * anon_token, and compiles the regex set once. Subsequent calls within the
 * TTL reuse the compiled function — important when an Inngest worker
 * transcribes many pages of the same submission back-to-back.
 *
 * Returns a noop scrubber if SUPER_GRADER_SALT is unset (deferred config) —
 * defense-in-depth, not a hard gate, because the salt only matters when
 * we're actually shipping data out to super-grader.
 */
export async function getCourseScrubber(
  courseId: string,
): Promise<(text: string) => string> {
  const hit = cache.get(courseId);
  if (hit && hit.expires > Date.now()) return hit.scrub;

  if (!process.env.SUPER_GRADER_SALT) {
    const noop = (text: string) => text;
    cache.set(courseId, {
      expires: Date.now() + CACHE_TTL_MS,
      roster: [],
      scrub: noop,
    });
    return noop;
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("enrollments")
    .select("students!inner ( canvas_user_id, email, display_name )")
    .eq("course_id", courseId);

  type Row = {
    students: {
      canvas_user_id: number | null;
      email: string | null;
      display_name: string | null;
    };
  };

  const roster: RosterEntry[] = [];
  for (const row of (rows as unknown as Row[] | null) ?? []) {
    const s = row.students;
    if (!s.canvas_user_id || !s.email || !s.display_name) continue;
    roster.push({
      display_name: s.display_name,
      anon_token: anonToken(s.canvas_user_id, s.email),
    });
  }

  const scrub = buildScrubber(roster);
  cache.set(courseId, {
    expires: Date.now() + CACHE_TTL_MS,
    roster,
    scrub,
  });
  return scrub;
}

/** Test-only / on-demand invalidation. */
export function clearRosterCache(courseId?: string): void {
  if (courseId) cache.delete(courseId);
  else cache.clear();
}
