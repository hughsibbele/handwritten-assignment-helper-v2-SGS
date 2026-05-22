# HAH PII-scrubbing + Gemini-OCR-boundary + roster audit

Audit date: 2026-05-21. Auditor: Claude (Opus 4.7, 1M ctx).

Theme: trace every Gemini-bound string from origin to call site, look for the
same fail-open scrub bug that the OE and AID audits surfaced last week, and
characterise HAH-specific risks (student's own handwritten name on the page,
roster snapshot semantics, retry idempotency).

Findings are ranked by severity. File:line references are to the repo state
at HEAD (commit `6c34d08`).

---

## Bug map (TL;DR)

| # | Severity | One-line                                                                                      |
|---|----------|-----------------------------------------------------------------------------------------------|
| 1 | CRITICAL | OCR worker never invokes the scrubber — raw `transcription_text` (with the student's own name as the page header) is stored to Postgres and forwarded to Canvas + Google Docs. |
| 2 | CRITICAL | Roster scrubber fails open on missing salt and silently no-ops; same fail-open shape that bit OE/AID, but it does not actually matter here because nothing on the Gemini boundary calls it (Finding #1). It WILL matter the moment Finding #1 is fixed wrong. |
| 3 | CRITICAL | Empty-roster fail-open: `getCourseScrubber` caches a noop scrubber for 5 min when the roster query returns 0 rows OR errors silently, with no distinction between "roster lookup failed" and "roster legitimately empty". |
| 4 | HIGH     | OCR call doesn't pass roster/scrub at all — the Gemini *prompt body* and the *generated transcript* live entirely outside the scrubbing layer. Page header may include "Name: Hugh Koeze" and Gemini will see it verbatim. |
| 5 | HIGH     | `/api/test-transcribe` is an unauthenticated public POST that proxies any image straight to Gemini with the OCR prompt. Both an open Gemini-spend hole and an unscrubbed-PII egress. |
| 6 | HIGH     | No retry idempotency for the OCR step. `step.run("call-gemini", …)` re-invokes Gemini on every Inngest retry; if the scrubber is later wired into the pre-OCR path (Finding #4), retry semantics need to be re-considered (first attempt scrubbed via cold cache, second attempt with mutated cache, etc.). |
| 7 | MEDIUM   | `clearRosterCache` is exported but never called. Course-roster sync routes do NOT invalidate the cache, so a new student enrolling mid-class won't be scrubbed for up to 5 minutes. |
| 8 | MEDIUM   | Prompt-loader fail-open is benign today, but the default OCR prompt explicitly tells Gemini about identifying headers — proving that the *prompt* author already considered the PII channel. The scrub layer wasn't wired up; the OCR prompt is doing all the work alone. |
| 9 | MEDIUM   | Snapshot-vs-live roster mismatch: a photo uploaded today and OCR'd 30 min later (Inngest backoff, weekend deferral) uses whatever roster is in the cache *at OCR time*, not at upload time. If a student transfers out, their name is no longer in the roster and would pass through un-scrubbed. (Theoretical today — moot because of Finding #1.) |
| 10| LOW      | Anonymizer drift: HAH uses a per-roster-entry "every word part" scrubber, while SG/OE/AID use a longest-first variant set with stricter word boundaries and structured-field PII keys. Token output is contract-compliant (verify-anonymizer-drift.sh passes), but the *scrubber* output is not — HAH will scrub middle-name fragments that SG won't, producing divergent text. Acceptable for now; flagged for awareness. |
| 11| LOW      | No tests at all under `src/lib/anonymizer/`. The "tests that would catch the fail-open" rubric noted in the audit brief: there are no tests to lock in OR catch the bug. |
| 12| LOW      | Rate-limit fail-open is correctly scoped (cost guardrail, not a PII gate), but the comment in `rate-limit.ts:25` ("not a security boundary") only holds because no PII gate is downstream — which is itself the bug. |

---

## Finding 1 — CRITICAL: OCR worker never scrubs the transcript before storing it

**Severity:** Critical (FERPA-grade PII reaches Gemini and lands raw in Postgres).

**Files / lines:**
- `src/lib/inngest/functions/transcribe-photo.ts:109–130`
- `src/lib/gemini/transcribe.ts:29–60`

**Scenario:**
1. Student photographs their own handwritten page. The page typically has the
   student's name + period + date at the top (the prompt at
   `src/lib/gemini/transcribe.ts:17–20` proves the team knows this).
2. The image arrives at `transcribePhoto` (Inngest), which downloads it and
   sends it through `transcribeImage(imageBase64, mimeType)`.
3. `transcribeImage()` calls Gemini with the system instruction "skip the
   identifying header" — Gemini *usually* obeys, but this is best-effort
   instruction-following, not a guarantee. Any failure mode here lands the
   raw student name in `transcription`.
4. The returned string is written to `submission_photos.raw_transcription`
   verbatim (`transcribe-photo.ts:125`).
5. When all pages complete, `transcribe-photo.ts:177–188` joins
   `raw_transcription` values into `submissions.transcription_text` —
   still raw.
6. From there it flows to:
   - the student's review screen,
   - Google Docs creation (`confirm/route.ts:188`),
   - Canvas submission as text-entry HTML (`confirm/route.ts:250–276`),
   - the super-grader webhook envelope (`peers/envelope.ts:125` — this one
     IS scrubbed, but it's reading from `transcription_text` which is the
     un-scrubbed value).

**Why this matches OE/AID's bug shape:**
The audit brief calls this out: "missing roster → scrub silently no-ops →
raw PII reaches Gemini". HAH's variant is worse — the scrubber isn't even
*invoked* on the Gemini boundary. The roster module exists, the envelope
builder uses it, but the worker that actually sends bytes to Gemini doesn't
import `getCourseScrubber` at all (`grep -n getCourseScrubber
src/lib/inngest/functions/transcribe-photo.ts` returns nothing).

The comment in `envelope.ts:29–31` rationalises this:
> The stored `transcription_text` keeps the student's real name intact (it's
> their own work shown back to them); only what we hand to super-grader
> gets anonymized.

That posture is defensible for the *student review screen* and for the
*Canvas submission* (which is supposed to be the student's own text). But
the *Gemini call itself* sends raw bytes through Gemini's pipeline. Gemini's
response is the transcript; Gemini's *input* is the image — Gemini already
saw the name, regardless of whether the post-OCR text gets scrubbed.

**The deeper hole:** Gemini OCR is the egress event. The bytes leave the
EHS premises the moment they're sent to Google. By the time we're talking
about scrubbing the *output*, Gemini has already seen the input image with
the name on it. Scrubbing the output is necessary-but-not-sufficient.

**Fix direction:**
- Short-term (defence-in-depth on the OUTPUT): in
  `transcribe-photo.ts:109–111`, after `transcribeImage()` returns, look up
  the course id (already available via the submissions → assignments →
  courses join used for the rate-limit step) and run
  `await getCourseScrubber(courseId)` on the result before writing to
  `raw_transcription`. Apply the same scrub to the concatenated
  `transcription_text` in the same step where it's joined
  (`transcribe-photo.ts:177–188`). Acceptable trade: student sees their own
  name as `Student_xxxxxx` on the review screen — verifiably the same
  posture OE chose for transcripts and a reasonable FERPA stance.
- Better (cuts the actual egress): pre-OCR step that crops or masks the top
  N% of the image (where headers live) before sending to Gemini. Less
  reliable than telling Gemini to skip it, but it's enforced rather than
  hoped-for.
- Hard-coded: change the noop fallback in `roster.ts:32–40` to throw —
  same fail-closed posture OE/AID will adopt. See Finding 2.

---

## Finding 2 — CRITICAL: Roster scrubber fails open on missing salt

**Severity:** Critical (architectural).

**Files / lines:**
- `src/lib/anonymizer/roster.ts:32–40`

**Code:**
```ts
if (!process.env.SUPER_GRADER_SALT) {
  const noop = (text: string) => text;
  cache.set(courseId, {
    expires: Date.now() + CACHE_TTL_MS,
    roster: [],
    scrub: noop,
  });
  return noop;
}
```

This is the exact shape of the OE/AID bug. The comment on line 22–24 even
admits it:
> Returns a noop scrubber if SUPER_GRADER_SALT is unset (deferred config) —
> defense-in-depth, not a hard gate, because the salt only matters when
> we're actually shipping data out to super-grader.

That reasoning is wrong. The scrubber is the FERPA gate to Gemini — silent
no-op means raw names hit Gemini whenever the salt isn't loaded (env var
typo, secret rotation in progress, Vercel preview without the env wired,
local dev that doesn't have the secret). The fact that no caller currently
uses it on the Gemini boundary (Finding 1) means this is a latent bug
waiting for someone to "fix" Finding 1 by importing `getCourseScrubber` and
trusting it.

**Fix direction:**
```ts
if (!process.env.SUPER_GRADER_SALT) {
  throw new Error(
    "SUPER_GRADER_SALT is not set — cannot build name-scrubber. " +
    "Refusing to OCR/transcribe content without a working anonymizer.",
  );
}
```
The token module already does exactly this (`token.ts:18–23`). The
inconsistency between the two modules in the same anonymizer/ directory is
the most obvious form of the bug — the developer who wrote `token.ts` knew
the right answer; the developer who wrote `roster.ts` chose otherwise. Note
that as of today, fail-closed here is harmless — every code path that
constructs envelopes ALREADY verifies submissions exist, so a missing salt
would simply 500 the super-grader endpoint rather than silently leak.

---

## Finding 3 — CRITICAL: Empty-roster fail-open with 5-min stale cache

**Severity:** Critical (subset of Finding 2 but distinct mechanism).

**Files / lines:**
- `src/lib/anonymizer/roster.ts:42–73`

The supabase query at `roster.ts:43–46` has no error handling — it
destructures `{ data: rows }` and discards the error. If the query throws
or returns null, `rows ?? []` collapses to an empty array, the loop at line
57 produces an empty roster, `buildScrubber([])` returns a no-op (because
`patterns` is empty), and the cache stores that no-op for 5 minutes for
that `courseId`. From then on, even if the DB recovers, no PII gets
scrubbed for that course until 5 minutes later.

The same hole exists when a course legitimately has zero students (rare,
but possible during a sync gap): scrubber is a no-op, gets cached, and the
moment students get added by the roster-sync route nothing invalidates the
cache (Finding 7).

**Fix direction:**
- Destructure `{ data, error }` and treat any error as fail-closed (throw,
  do not cache).
- Don't cache an empty-roster result. If `roster.length === 0`, either
  (a) refuse to scrub (throw) so the caller knows something is wrong, or
  (b) return the noop but DON'T cache it, so a subsequent call gets a
  fresh DB read.
- Pair with Finding 7: roster-sync routes should call `clearRosterCache(id)`.

---

## Finding 4 — HIGH: Page-header student name lands in Gemini input

**Severity:** High.

**Files / lines:**
- `src/lib/gemini/transcribe.ts:29–60`
- `supabase/migrations/021_prompts_table.sql:42–46` (the default prompt)

The current mitigation is purely prompt-level: lines 16–20 tell Gemini "if
the top of the page has Name:/Student:/Date:/Period:, skip it". This is
LLM instruction-following, not enforcement. Failure modes:
- Student writes their name in the *body* of the work (e.g., an essay
  about themselves, signing a poem, "I, John Smith, hereby…").
- Student writes their name in the margin instead of the top.
- Gemini ignores the instruction (low rate, but non-zero — happens more
  often on the long-tail of edge layouts, multi-column pages, sticky
  notes).
- The admin edits the prompt via `/admin/prompts` and accidentally weakens
  or removes the skip-header section. There's no test pinning it.

The image itself is the *primary* PII channel. Gemini OCR sees the name in
the photo regardless of whether it transcribes it.

**Fix direction:**
- Treat the image as PII. Document this explicitly in CLAUDE.md ("the
  photograph itself is PII that crosses the Google boundary, and HAH's
  privacy posture relies on EHS's enterprise agreement with Google
  Gemini, not on anonymization").
- Post-scrub the OCR output regardless (Finding 1's short-term fix).
- Consider an admin-prompts safeguard that refuses to save a prompt body
  missing the header-skip clause — or at least flags it visually.
- Optional: an image-crop pre-processor that drops the top 8% (typical
  header band) before sending. Bypassable on margin/handwritten-mid-page
  names but raises the floor.

---

## Finding 5 — HIGH: Unauthenticated `/api/test-transcribe` endpoint

**Severity:** High (security + PII).

**Files / lines:**
- `src/app/api/test-transcribe/route.ts:4–29`

The route accepts a multipart upload and proxies the image straight to
`transcribeImage()` with no auth check, no rate-limit, no PII scrubbing.
Anyone on the public internet can:
- Upload arbitrary images and have them OCR'd on your Gemini bill.
- Use your deployment as a generic OCR service.
- Use your deployment to exfiltrate Gemini-OCR'd text from any image
  (third-party PII, doxxed documents, etc.) without any audit trail.

There's no per-teacher rate-limit gate here — the rate-limit RPC is only
invoked from the Inngest worker, not from this route.

**Fix direction:**
- Delete the route. It's a dev-debug holdover; the real OCR path is
  Inngest.
- If kept (admin smoke-test), gate behind `isAdmin()` like the other
  admin routes, and invoke `checkAndIncrementGeminiCall(teacherId)`
  before the Gemini call.

---

## Finding 6 — HIGH: Inngest retry semantics + Gemini call duplication

**Severity:** High.

**Files / lines:**
- `src/lib/inngest/functions/transcribe-photo.ts:109–111` (`call-gemini` step)
- `src/lib/inngest/functions/transcribe-photo.ts:7–13` (function config: `retries: 3`)

Inngest's `step.run("call-gemini", fn)` will checkpoint the output and not
re-run on subsequent retries of *later* steps. But if `call-gemini` itself
throws (Gemini API error, timeout, rate-limit on Google's side), Inngest
retries it — and the rate-limit RPC at step 3a has already incremented the
counter. So a Gemini retry storm can over-count against the teacher's daily
cap without actually OCRing anything.

More important for this audit: if Finding 1 is fixed by scrubbing inside
`call-gemini` (correct), and the scrub call depends on the roster cache
state at execution time, retries that span a cache-invalidation event will
get different scrub behaviour. The cached scrub closure is captured in
process memory at step start; if the function gets cold-started across a
retry, the new process re-fetches the roster — fine. But within a single
warm process, retries are deterministic.

The bug today is mostly the rate-limit double-counting. The latent risk is
non-deterministic scrub-on-retry once Finding 1 is fixed.

**Fix direction:**
- Move the Gemini-cost increment to a non-checkpointed wrapper around the
  Gemini call so failures don't permanently consume cap headroom.
  (Specifically: bump only on success, or use an atomic decrement on
  failure.)
- When wiring scrub into the OCR step, fetch the roster INSIDE the same
  `step.run("call-gemini", …)` block so the scrub closure is captured
  alongside the Gemini call — retries either re-fetch + re-scrub or
  reuse the checkpointed output, not a mix.

---

## Finding 7 — MEDIUM: Roster cache is never invalidated on roster changes

**Severity:** Medium.

**Files / lines:**
- `src/lib/anonymizer/roster.ts:76–79` (`clearRosterCache` defined)
- `src/app/api/courses/[id]/sync/route.ts` (callers — `grep clearRosterCache`
  in src finds zero hits)

`clearRosterCache(courseId)` is exported as "test-only / on-demand
invalidation". Roster-sync API routes (`/api/courses/[id]/sync`,
`/api/canvas/courses/sync`) upsert the `enrollments` and `students` tables
but never invalidate the scrubber cache. After a sync:
- New student enrolls → their name is missing from the cached scrubber for
  up to 5 minutes.
- Student removed from course → their name stays in the scrubber, which is
  harmless (over-scrubbing).
- Student's display name corrected → old name stays in the scrubber, new
  name passes through un-scrubbed.

Combined with Finding 1 (no scrubber on the OCR path), this is theoretical
today. Combined with Findings 1+3 it becomes a real "5 minute attack
window" — a student who just joined the course and uploads a photo before
the cache refreshes is un-scrubbed.

**Fix direction:**
- After every successful upsert into `students` or `enrollments` in a sync
  route, call `clearRosterCache(courseId)`.
- Or: drop the 5-min TTL and use a per-row signature-based cache (hash of
  `enrollments` rows for the course; invalidate on signature change).

---

## Finding 8 — MEDIUM: Prompt-loader fail-open relies on hardcoded default

**Severity:** Medium.

**Files / lines:**
- `src/lib/prompts/load.ts:22–49`
- `src/lib/gemini/transcribe.ts:6–27`

The DB-backed prompt loader falls back to a hardcoded default if the row
is missing or unreachable. The hardcoded default is currently identical to
the seeded DB row (per `migrations/021_prompts_table.sql:42–46`), and
correctly tells Gemini to skip identifying headers. So the fallback is
safe today.

The risk: an admin updates the DB-stored prompt (legit feature), then a
deployment regresses the hardcoded default (e.g., refactor strips the
"skip identifying headers" section). On the next prompts-table outage, the
fallback prompt is suddenly less safe than the admin-edited one. There's
no test pinning the fallback prompt's content.

**Fix direction:**
- Add a smoke-test asserting the fallback prompt contains the
  header-skip clause (or at least the substrings `"Name:"`, `"Student:"`,
  `"identifying"`).
- Consider a build-time check that the seed in
  `migrations/021_prompts_table.sql` matches the hardcoded default
  byte-for-byte, with drift surfaced loudly.

---

## Finding 9 — MEDIUM: Snapshot-vs-live roster mismatch

**Severity:** Medium (latent — depends on Finding 1 fix).

**Files / lines:**
- `src/lib/anonymizer/roster.ts:26–73`

The scrubber is fetched at OCR time, not at upload time. If a student is
removed from the roster between photo upload and OCR completion (Inngest
backoff up to 3 retries × default backoff = potentially hours), the
roster used is the *current* roster, not the upload-time roster. A
removed student's name passes through un-scrubbed.

The reverse case (student added between upload and OCR) is benign for the
scrubber but creates a different question: does the system's audit story
say "we OCR'd this with the roster as it was at upload" or "as it was at
OCR"? Today the answer is implicitly "at OCR time" — but with no record
of which roster version was used.

**Fix direction:**
- Snapshot roster signature on `photo.uploaded` event payload (cheap —
  just a short hash) and have the OCR step refuse to proceed if the
  current signature differs significantly. Or:
- Accept "live roster at OCR time" as the documented semantic and write
  it into CLAUDE.md.
- Out of scope for fixing today; flagging because the suite-wide audit
  campaign explicitly listed snapshot semantics as Root Cause #1.

---

## Finding 10 — LOW: Anonymizer drift vs SG/OE/AID/HH

**Severity:** Low (acceptable trade-off, flagged for awareness).

**Files / lines:**
- `src/lib/anonymizer/scrub.ts:35–79`
- compare to `super-grader-v2-SGS/packages/anonymizer/src/scrub.ts`

HAH's scrubber generates a regex per word-part of each display name and
runs them serially in longest-pattern-first order. SG/OE/AID generate
nameVariants() with full/first/last/hyphen-piece, use unicode-aware word
boundaries (`(?<![\\p{L}\\p{N}_])` lookbehinds with the `u` flag), and
include a structured-field scrubber (`scrubStructured`) that recognises
PII keys in JSON objects.

Differences:
- HAH uses ASCII-only `\\b` boundaries, which won't correctly match
  Unicode-letter-adjacent names (a name "François" beside an accented
  word might not get scrubbed). Low-impact at EHS today but real.
- HAH has no structured-field scrubber. Not needed for OCR output (which
  is free text), but if HAH ever sends a JSON body to Gemini (e.g., new
  prompt that includes a roster table), the SG/OE/AID structured layer
  would catch what the free-text layer misses.
- HAH scrubs every word-part of every name, including middle-name
  fragments. SG/OE/AID skip those by design (longer variant set, but
  capped at full/first/last/hyphen-pieces). Result: HAH may over-scrub
  ("May" inside "May 12, 2025" → `Student_xxxxxx`), SG/AID/OE may
  under-scrub ("Aoife", "Naomi" used as middle names).

Token output matches the contract (verify-anonymizer-drift.sh passes per
the suite scripts), so cross-tool joins are fine. The scrubber-output
divergence is a different layer.

**Fix direction:**
- M5 consolidation candidate: lift `packages/anonymizer/` from SG into a
  shared workspace package the satellites depend on. Eliminates drift
  by construction.
- Until then: document the drift in CLAUDE.md.

---

## Finding 11 — LOW: No tests under `src/lib/anonymizer/`

**Severity:** Low.

`find src/lib/anonymizer -name "*.test.ts"` returns nothing. The audit
brief specifically asked whether existing tests would "catch the
fail-open patterns or HIDE them (a test asserting 'scrub is a no-op when
roster empty' would lock in the bug)". There are no tests at all in this
layer.

**Fix direction:**
- After the Finding 2 + 3 fixes, add tests:
  - Salt missing → throws (or whatever fail-closed shape is chosen).
  - DB error → throws (does NOT cache a noop).
  - Empty roster → throws OR returns un-cached noop (whichever is
    chosen).
  - Roster populated → scrubs full name, first name, last name, and
    possessive forms.
  - Cache hit within TTL returns same closure.
- Add an integration test that imports `transcribe-photo.ts`'s OCR step
  and verifies the scrub IS called between Gemini and the DB write.

---

## Finding 12 — LOW: Rate-limit fail-open posture is fine, but the "not a security boundary" comment depends on Finding 1

**Severity:** Low (informational).

**Files / lines:**
- `src/lib/gemini/rate-limit.ts:23–26`

Comment says:
> The rate-limiter is a cost guardrail, not a security boundary — over-
> serving on rare DB errors is preferable to blocking a class from
> finishing their assignment.

That posture is correct as long as the rate-limit isn't the only thing
between unbounded Gemini spend and the world. Today, the only "auth"
between an attacker and Gemini is whether they're hitting Inngest
(unreachable from outside) or `/api/test-transcribe` (Finding 5: publicly
reachable). Fixing Finding 5 removes the external Gemini-spend vector;
then the comment here is genuinely fine.

---

## Cross-reference table: every Gemini-bound string

| Origin                                        | File:line                                                | Scrubbed before Gemini? | Notes |
|-----------------------------------------------|----------------------------------------------------------|-------------------------|-------|
| Image bytes (photo upload)                    | `transcribe-photo.ts:39–65` → `transcribe.ts:48–56`     | N/A (image)             | Image goes to Gemini OCR raw — student's name on the page goes with it. Finding 4. |
| OCR system instruction (default)              | `transcribe.ts:6–27`                                     | N/A (no PII in prompt)  | Tells Gemini to skip headers; relies on prompt-level mitigation only. |
| OCR system instruction (DB-loaded)            | `prompts/load.ts:22–49` → `transcribe.ts:33–36`         | N/A (no PII)            | Admin-editable; no safeguard against PII-introducing edits. |
| OCR "user turn" text                          | `transcribe.ts:55`                                       | N/A (boilerplate)       | Static string. |
| OCR response (the transcript)                 | `transcribe-photo.ts:109–111`                            | **NO** — Finding 1      | Lands raw in `submission_photos.raw_transcription`. |
| Joined transcript                             | `transcribe-photo.ts:176–179`                            | **NO** — Finding 1      | Lands raw in `submissions.transcription_text`. |
| Student review screen render                  | `student/submissions/[submissionId]/page.tsx:323+`       | N/A (back to student)   | Acceptable to show student their own name. |
| Canvas submission body                        | `confirm/route.ts:250–276`                               | N/A (back to teacher's Canvas) | Acceptable — Canvas is the source of truth for the student's identity anyway. |
| Google Doc body                               | `confirm/route.ts:185–192`                               | N/A (student's own Drive)| Acceptable. |
| Super-grader webhook envelope `transcript`    | `peers/envelope.ts:125`                                  | **YES** — scrub() called| Only path that actually scrubs today. Good. |
| Super-grader webhook envelope `canvas_submission_text` | `peers/envelope.ts:127`                          | **YES** — scrub() called| Same. |
| `/api/super-grader/result` GET                | `super-grader/result/route.ts:27–30`                     | **YES** — via envelope  | Same. |
| `/api/super-grader/prompt` GET                | `super-grader/prompt/route.ts:22–28`                     | N/A (returns prompt body, no student text) | Fine. |
| `/api/test-transcribe` POST                   | `test-transcribe/route.ts:17`                            | **NO** — Finding 5      | Plus unauthenticated. |

---

## Suggested fix order

1. **Delete or gate `/api/test-transcribe`** (Finding 5). One-line change;
   removes the unauthenticated Gemini-egress hole.
2. **Change `roster.ts`'s salt branch to throw** (Finding 2). One-line
   change; matches `token.ts` and removes the latent fail-open before any
   refactor wires the scrubber into the OCR path.
3. **Handle DB errors / empty roster in `getCourseScrubber`** (Finding 3).
   ~10 lines; either throw or skip caching.
4. **Wire `getCourseScrubber` into the OCR step** (Finding 1). The
   meaningful fix. Pair with Finding 6 — fetch the roster inside the same
   `step.run("call-gemini", …)` so retries are deterministic.
5. **Invalidate cache on roster sync** (Finding 7).
6. **Add tests** (Finding 11).
7. **Document the image-as-PII reality** (Finding 4) in CLAUDE.md so the
   privacy posture is explicit rather than implicit.
8. **Image cropping pre-processor** (Finding 4, optional defence-in-depth).
9. **Snapshot semantics** (Finding 9) — explicit M6.x phase, not a quick
   fix.
10. **M5 anonymizer consolidation** (Finding 10).
