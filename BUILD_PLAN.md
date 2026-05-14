# Handwritten Helper — Build Plan

Per-phase narrative of what's been built. Quick-reference status lives in
[`CLAUDE.md`](./CLAUDE.md); deeper architecture notes live in code comments
next to the relevant module.

Phases run in order. Each ships independently; the database is consistent
across phase boundaries (no half-applied migrations).

## Phase 0 — Foundations ✅ (pre-2026-04-08)

The original feature set documented in the early CLAUDE.md status section:

- Google OAuth via Supabase + role detection (teacher vs student)
- Teacher setup: Canvas URL + API token, course picker, short display names
- Canvas sync: courses, assignments (with `submission_types` and
  `discussion_topic_id`), student rosters
- Teacher dashboard + course detail page with per-assignment auto-submit
  toggle and re-sync button
- Student dashboard + assignment upload page + submission review page
- Photo upload (drag-drop, camera capture, drag-to-reorder), JPG/PNG/WebP/HEIC/HEIF
- Inngest transcription pipeline (one photo per job, parallel, combined on
  completion)
- Google Doc creation in student's own Drive, per-course folders shared
  with the teacher, folder reuse on resubmit
- Canvas auto-submit (text entry for assignments, discussion entry for
  discussion-type), `as_user_id` masquerade with teacher token
- Class code join flow for students not in Canvas
- Mobile optimization (camera-capture button, touch reorder, responsive nav)
- EHS branding (maroon/gray palette, Lora serif headings, EHS logo)

Migrations 001-019 applied. RLS recursion fixed via SECURITY DEFINER helpers
in 015-016. Production-deployed and tested end-to-end with real students.

## Phase 1 — Transcription guardrails + sort/search + Sentry ✅ (2026-05-13)

Smaller cross-cutting improvements that don't form a single feature:

- **Gemini config tightened** — `maxOutputTokens: 4096` set explicitly
  (Gemini 2.5's thinking tokens count against the same budget; unspecified
  default risks mid-sentence truncation on dense pages). System instruction
  now tells Gemini to skip "Name:", "Date:", "Period:", header blocks at
  the top of the page, and student-name signatures outside the body — so
  the transcribed text starts at the actual work, not at PII metadata.
- **Upfront unsupported-assignment block** — when a teacher has Canvas
  auto-submit on but the assignment's `submission_types[]` doesn't include
  `online_text_entry` (and there's no discussion topic), the student
  assignment upload page renders an amber notice instead of the photo
  dropzone. Previously the student uploaded → transcribed → only THEN
  discovered Canvas would reject the body. Non-Canvas students (no
  `canvas_user_id`) bypass the check.
- **Sentry env-gated** — `@sentry/nextjs` wired via `instrumentation.ts`
  (Node + Edge branched on `process.env.NEXT_RUNTIME`) and
  `instrumentation-client.ts` (browser). Init gated on `SENTRY_DSN` /
  `NEXT_PUBLIC_SENTRY_DSN` — missing = no init, no events, no perf
  overhead. `sendDefaultPii: false`, `tracesSampleRate: 0`. `onRequestError`
  funnels server-action / route-handler errors.
- **Active-term Canvas sync filter** — background sync component now
  filters courses by `termIsCurrent()` (substring match on the term name's
  4-digit year). Stale courses still appear in the teacher dashboard but
  don't get hit on every page load. Manual "Re-sync" button on the course
  detail page remains the escape hatch.
- **Proximity sort + search on assignment lists** — `sortByProximity()`
  puts just-passed and upcoming-soon items first (tie-break: past beats
  future at equal distance), distant ones last, no-due-date items always
  last. Teacher course detail and student dashboard both use it. Plus a
  client-side text filter on assignment titles.

Commit: `c291374` — `feat(phase-1)`.

## Phase 2 — Super Grader satellite integration ✅ (2026-05-13)

Wire HAH as a peer per super-grader's `planning/integration-contract.md`.
Three legs: anonymization at the egress boundary, bearer-auth'd inbound
GETs, fire-and-forget outbound webhook on confirm.

### Schema (migrations 020 + 021)

- `students.anon_token TEXT UNIQUE` — HMAC-derived token persisted lazily.
  Nullable because Google-SSO students may arrive without `canvas_user_id`
  resolved. UNIQUE so collisions surface loudly (extremely unlikely at
  ~500-student scale per the contract; ~0.008 expected collisions).
- `submissions.canvas_submission_text TEXT` — the exact text we POSTed to
  Canvas (including the sentinel marker prefix), so the
  `/api/super-grader/result` endpoint can return verbatim without
  re-deriving from current state.
- `prompts(id, owner, key, body, version, updated_at)` — admin-edited
  prompts registry. Currently one row (the OCR prompt). Shape matches
  super-grader's prompts contract so a future cross-tool registry can read
  this verbatim. Public-table grants per the project template; RLS denies
  writes from the user-scoped client (admin edits go through service-role
  behind the proxy gate).

### Anonymizer (`src/lib/anonymizer/`)

HMAC-SHA256 matching super-grader's `planning/integration-contract.md` §2
byte-for-byte:

```
salt   = base64-decoded SUPER_GRADER_SALT (32+ random bytes)
input  = "ehs\0" + canvas_user_id + "\0" + email_lowercased
token  = "Student_" + first 6 hex chars of HMAC-SHA256(salt, input)
```

Same algorithm, same salt → identical token in every ecosystem tool.
`buildScrubber(roster)` compiles a regex set covering full / first / last
name variants plus possessive forms; cached 5 min per course via
`getCourseScrubber(courseId)`. Crucially: **HAH stores transcriptions
un-anonymized** (the transcription is the student's deliverable, shown
back to them and posted to Canvas with their name intact). Anonymization
happens only at the egress boundary — webhook envelope + GET response.

### Peer endpoints (`src/app/api/super-grader/`)

Bearer-auth via `HANDWRITTEN_API_TOKEN`. Loud-500 when the env var is
unset (per the contract — misconfigured satellites should surface in SG's
admin, not 401 silently).

- `GET /api/super-grader/result?canvas_user_id=…&canvas_assignment_id=…`
  → returns `PeerResultEnvelope<HandwrittenSummary>` with anonymized
  `transcript` + `canvas_submission_text`, plus `google_doc_url`,
  `page_count`, `source_tag: "handwritten_helper"`. 404 if no confirmed
  submission. 30-second `Cache-Control: private`.
- `GET /api/super-grader/prompt?key=handwritten_image_transcription`
  → returns `{ owner, key, body, version }` so SG's prompts dashboard
  mirrors our live prompt without seeding a stale copy.

### Outbound webhook (`src/lib/peers/notify.ts`)

Fire-and-forget POST to `<SUPER_GRADER_API_URL>/api/ingest/handwritten`
with `SUPER_GRADER_INGEST_TOKEN` bearer. Same envelope shape as the GET
response. Silent no-op when either env var is missing — the student flow
never blocks on SG plumbing. Fired from `/api/submissions/[id]/confirm`
after the Canvas write succeeds.

### Sentinel marker

Every Canvas text-entry body now starts with:

```
<!-- handwritten:transcription v=1 submission-id=<uuid> -->
```

Super Grader's Canvas-scrape pipeline filters bodies whose first HTML
comment matches `<!--\s*handwritten:` (per contract §12) and treats them
as missing, using the webhook envelope as canonical instead. The marker
is stored in `submissions.canvas_submission_text` as part of the body —
the GET endpoint returns the marker-tagged version so SG sees the same
thing it scraped.

The discussion-entry path does NOT carry the marker — discussion entries
aren't fetched as submissions by SG.

### Admin layer

`ADMIN_EMAILS` comma-separated env-var allowlist. Proxy (`src/proxy.ts`)
checks the authenticated user's email against the allowlist on every
`/admin/*` and `/api/admin/*` request. Redirect to `/` on mismatch.

There's intentionally no `admins` table, no `is_admin()` SECURITY DEFINER
helper, no `INITIAL_ADMIN_EMAIL` self-bootstrap. AI Documenter built that
full apparatus because it has multiple admin surfaces (prompt registry +
retention + rate-limit overrides + analytics). HAH has one prompt editor
and one retention page; one env var carries the same weight without
migration churn. Graduate when there's a second admin or a second admin
surface beyond the prompt editor / retention.

### Admin prompt editor

`/admin/prompts` lists the seeded OCR prompt and lets you edit the body.
`PATCH /api/admin/prompts/[key]` does last-write-wins (single-admin
shape), bumps `version` monotonically, returns the updated row.

`loadPrompt(key, defaultBody)` reads the prompt body from DB with a 10-min
in-process cache TTL per super-grader's `integration-contract` §11. Falls
back to the hardcoded default in `src/lib/gemini/transcribe.ts` if the DB
row is missing or unreachable — the contract requires satellites never
fail an LLM call because the registry is down. `transcribeImage()` calls
`loadPrompt('handwritten_image_transcription', DEFAULT_…)`. Cross-Fluid-
Compute worker invalidation is best-effort: the saving worker's cache
clears immediately; other workers expire on their own TTL.

Commit: `40ca661` — `feat(phase-2)`.

## Phase 3 — Gemini rate limit + admin retention ✅ (2026-05-13)

Ops-hardening pass. Both items live in `/admin/*` (gated by `ADMIN_EMAILS`).

### Per-teacher Gemini daily cap (migration 022)

`teachers.gemini_daily_cap INT` (nullable per-teacher override), falls
back to `GEMINI_DEFAULT_DAILY_CAP` env (or 1000 if unset). 1000 is sized
for one class × ~30 students × ~10 pages = 300 calls with ~3× headroom.

`gemini_usage_daily(teacher_id, date, calls, denials, updated_at)` —
one row per (teacher, date). Atomic check + increment via SECURITY
DEFINER function `check_and_increment_gemini_call(p_teacher_id, p_default_cap)`
with `FOR UPDATE` row lock so concurrent students of the same teacher
can't both squeak past the cap by reading then writing without locking.
Denials counted separately for visibility.

Wired into the Inngest transcription pipeline as a new step before
`call-gemini`: looks up `teacher_id` via `submission → assignment →
course`, calls the RPC. On deny → mark the photo `failed`, return early.
On RPC error → fail open (DB hiccups shouldn't block students; the
limiter is a cost guardrail, not a security boundary).

### Admin retention page

`/admin/retention`:
- Headline counts (submission rows, photo rows, oldest `created_at`)
- Optional `created_at <` date filter
- **Export to CSV** — UTF-8 BOM prepended (Excel-on-Windows otherwise
  reads as cp1252 and mangles curly quotes / accented names / em-dashes).
  Columns: id, status, all three timestamps, attempt_number, student
  name+email+canvas_user_id, course name+short_name+canvas_course_id,
  assignment title+canvas_assignment_id, transcription text, Canvas body
  text (with sentinel marker), `canvas_submission_url`, `gdoc_url`. RFC
  4180 quoting throughout.
- **Hard delete** — "type DELETE" confirm + the same optional date filter.
  Chunked at 200/batch: list submission ids → pull storage paths → batch-
  remove storage objects (Storage and DB are separate backends; cascading
  the DB row doesn't free the photo blob) → cascade-delete submissions
  in chunks (Supabase statement timeout would otherwise bite on big
  bulks). `submission_photos` has `ON DELETE CASCADE` from submissions.

Commit: `863e80f` — `feat(phase-3)`.

## Pending deploy work

Code is shipped; production isn't. To get Phase 1-3 live:

1. **Set new env vars on the HAH Vercel project**:
   - `SUPER_GRADER_SALT` — copy from AI Documenter's Vercel (ecosystem-shared)
   - `HANDWRITTEN_API_TOKEN` — generate fresh (`openssl rand -hex 32`).
     Also set the same value on Super Grader's Vercel under the same name
     when SG deploys.
   - `ADMIN_EMAILS` — comma-separated email allowlist for `/admin/*` access
   - *(optional)* `GEMINI_DEFAULT_DAILY_CAP` — defaults to 1000 if unset
   - *(optional)* `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` — wire when there's a Sentry project
   - *(skip until SG deploys)* `SUPER_GRADER_API_URL` + `SUPER_GRADER_INGEST_TOKEN`
2. **`vercel deploy --prod`** to push Phase 1-3 code.
3. **Smoke-test in production**:
   - `/admin/prompts` — edit body, save, version bumps, Inngest job picks up the new body within ~10 min
   - `/admin/retention` — CSV downloads with UTF-8 BOM (try opening in Excel)
   - One real submission flow → confirm the Canvas body has the sentinel marker prefix
   - One real submission flow with `SUPER_GRADER_INGEST_URL` unset → confirm the webhook silent-no-op logs `skipped: true` without erroring

## Future phases (not scoped yet)

- **GitHub template repo** — generic branding, setup guide, repo-as-template button for other schools to self-host
- **Admin layer graduation** — only when there's a second admin or surface; pattern is AI Documenter's `admins` table + `is_admin()` + `INITIAL_ADMIN_EMAIL` bootstrap. See `~/.claude/projects/-Users-hughkoeze-Code-handwritten-assignment-helper/memory/project_admin_layer_deferred.md`.
- **Per-provider transcript ingestion** — N/A for HAH (no AI-tool transcripts to ingest); this is an AI-Documenter-specific phase.
- **Resend-to-Canvas retry surface** — AI Documenter built one for failed submission attempts. HAH could too if the Canvas write turns out to be flaky in production. Track in the retention page's stats first to see whether it's worth building.
