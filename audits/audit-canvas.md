# HAH Canvas-integration audit — install / auto-submit / roster / token

Date: 2026-05-21
Auditor: Claude Opus 4.7
Scope: HAH (`handwritten-assignment-helper-v2-SGS`) — Canvas-touching paths only.

Suite-wide themes I checked against: (1) snapshot semantics, (2) state fences,
(3) transactional boundaries, (4) fail-open vs fail-closed, (5) idempotency,
plus HAH-specific concerns (`as_user_id` masquerade, marker robustness,
destination-picker wiring, roster fix completeness, setup-page divergence,
bulk-install correctness, Canvas error categorization).

Findings are ranked by severity at the top of each section. File:line refs are
to `src/...` unless noted.

---

## 1. CRITICAL — Destination picker's "Canvas comment" flag is dead-wired

**Severity:** Critical (UX), Medium (data integrity)

**File:**
- `src/lib/actions/bulk-install.ts:217-225` (writer)
- `src/app/teacher/dashboard/CourseAccordion.tsx:207-216` (badge display)
- `src/app/api/submissions/[id]/confirm/route.ts:228-302` (consumer — **doesn't consume**)

**Scenario:**

The M6.18b 3-checkbox destination picker (Drive / Canvas comment / Canvas
submission) writes all three flags to `assignments.post_to_drive`,
`assignments.post_to_canvas_comment`, `assignments.post_to_canvas_submission`
on bulk-install. The dashboard renders all three badges.

But `confirm/route.ts` does NOT read any of those three columns. It takes the
single legacy field `submitToCanvas` from the request body — which the student
page derives from `assignments.canvas_submit_by_default` (the soon-to-be-
deprecated column kept in sync with `post_to_canvas_submission` only).

A teacher who unchecks "Canvas submission" but checks "Canvas comment":
- DB: `post_to_canvas_submission=false`, `post_to_canvas_comment=true`,
  `canvas_submit_by_default=false`
- Student page: `submitToCanvas=false` (correctly mirrors submission flag)
- Confirm: takes `submitToCanvas=false`, skips Canvas write entirely. **No
  comment is ever posted.** The Canvas client doesn't even have a
  `postSubmissionComment*` method (`grep -rn "postSubmissionComment" src` → 0
  hits). The whole comment-mode pipeline is unwritten.

The migration's COMMENT does call this out:
`'M6.18b: ... Writer not yet implemented for HAH — picker stores intent for
when M6.18b-followup ships the writer.'`
(`supabase/migrations/20260520150000_destination_picker.sql:24-25`)

So it's a known-pending writer. But the UI ships the checkbox today, with no
"Coming soon" affordance — teachers tick it, the dashboard shows a green "C"
badge implying it's active, and nothing fires. **Equivalent of AID's audit
finding 1** ("destination picker half-wired"); same severity, same shape.

**Fix direction:** 
- Either (a) ship the writer (`canvas.postSubmissionComment(courseId,
  assignmentId, asUserId, comment)` via Canvas's
  `POST /api/v1/courses/:cid/assignments/:aid/submissions/:uid` with
  `comment[text_comment]`), OR
- (b) hide / disable the checkbox and badge until the writer lands, with a
  tooltip pointing to M6.18b-followup. Today it's UI-active deception.

---

## 2. CRITICAL — Per-course re-sync has the pre-9b3763e roster bug

**Severity:** Critical (silently repoisons rosters)

**File:** `src/app/api/courses/[id]/sync/route.ts:84-119`

**Scenario:**

The 2026-05-20 roster fix (commit `9b3763e`) patched the bulk setup-wizard
sync (`src/app/api/canvas/courses/sync/route.ts`) but the diff did NOT touch
the per-course sync route. Per-course sync still does:

```
email: cs.email ?? cs.login_id ?? null,
```

The `BackgroundSync` component (`src/components/teacher/background-sync.tsx:30-32`)
fires `POST /api/courses/<id>/sync` for every current-term course on every
teacher-dashboard load. Same canvas-client `getStudents()` does honor the new
`include[]=email` form (good), but if Canvas still hides email for a teacher
or specific install (the original failure mode), the per-course route stores
`login_id` (`"jsmith23"`) as fake email — exactly the bug 9b3763e was
supposed to extinguish suite-wide.

The bulk-sync fix:

```typescript
const rawEmail = (cs.email ?? "").trim().toLowerCase();
if (!rawEmail || !rawEmail.includes("@")) continue;
```

is not present here.

**Worse:** every dashboard load repoisons. A teacher fresh off a bulk-sync
with clean emails will, on next dashboard visit, have BackgroundSync fire
and clobber the email column with `login_id` for affected rows.

This bug then propagates downstream to the auth callback
(`src/app/api/auth/callback/route.ts:35-54`), which matches students by
exact-email — login_id-as-email never matches the student's Google identity,
and they hit "We can't find you on the roster."

**Fix direction:** Lift the bulk-sync rawEmail guard into a shared helper and
use it from both sync routes (and any future Canvas student importer). Mirror
the `enrollment_state[]=active` filter is already in `getStudents` (✓).

---

## 3. HIGH — No idempotency guard on `/api/submissions/[id]/confirm`

**Severity:** High (Canvas duplicate writes, transactional state corruption)

**File:** `src/app/api/submissions/[id]/confirm/route.ts:37-349`

**Scenario:**

The confirm route never checks `submission.status` before running. Re-firing
it (double-click, browser auto-retry, Inngest re-delivery if anything ever
calls it from a job) will:

1. UPDATE `submissions` row → benign, idempotent.
2. Create a NEW Google Doc → **non-idempotent**, `getOrCreateCourseFolder` is
   keyed on `enrollment.id` (idempotent) but `createGoogleDoc(title=...)`
   always creates a new doc. Result: every confirm leaves another transcript
   doc in the student's Drive.
3. Submit to Canvas via `submitTextEntry` → Canvas accepts repeated text-entry
   submissions; for `online_text_entry` the latest replaces the previous (safe).
   For discussion entries via `postDiscussionEntry`, Canvas creates a NEW
   discussion entry each time (**duplicate visible reply**). Documented in
   the file at line 28: SG markers are skipped on discussions because they're
   not student-authored. Multiple confirm-fires here = multiple discussion
   replies posted.
4. Push to super-grader → `pushToSuperGrader` is described as fire-and-forget;
   each call sends a new envelope, so SG sees multiple "finalized" events for
   the same submission.

The student page's UI lockout (`setConfirming(true)` in
`src/app/student/submissions/[submissionId]/page.tsx:412`) is the only guard,
and is bypassable (browser back, network retry, fast clicks before state
flush, or any non-browser invocation of the API).

`canvas_submission_id` is also never recorded — the response from
`submitTextEntry` includes the Canvas submission id, but it's discarded
(line 154 returns it, but the consumer at confirm:268 ignores it). With no
recorded id, idempotency-by-record-check isn't even possible later.

**Fix direction:**
- At the top of POST, refetch `submission.status` under admin client and
  reject if already `confirmed` / `submitted`. Race-safe variant: do this as a
  conditional UPDATE (`UPDATE submissions SET status='confirming' WHERE id=?
  AND status='review'` and check affected row count). 
- Record `canvas_submission_id` from `CanvasSubmissionResponse.id` so future
  re-fires can detect "already posted" rather than re-posting.
- For discussion entries: probe the topic for an existing entry with the
  HAH sentinel (or store the returned `entry.id`) before posting again.

---

## 4. HIGH — `bulkUninstallAssignments` doesn't verify assignment ownership

**Severity:** High (cross-teacher state-table tampering; cross-teacher Canvas
write if both teach the same course)

**File:** `src/lib/actions/bulk-install.ts:274-323` (`uninstallOne`)

**Scenario:**

`installOne` (line 170-272) loads the assignment via admin client AND
explicitly checks:

```typescript
if (course.teacher_id !== teacherId) {
  throw new Error("Assignment doesn't belong to this teacher");
}
```

`uninstallOne` (line 274-323) does NOT have this check. It loads the
assignment with the admin client (RLS bypassed), then proceeds directly to
the Canvas read/write and the `assignment_install_state` delete.

If Teacher A invokes the action with an assignment UUID belonging to
Teacher B's course:
- Canvas read attempts use Teacher A's token + Teacher B's canvas_course_id.
  If A doesn't teach that course, Canvas 404s and the action throws before
  the local delete (saving the local row).
- BUT: in a co-teaching / TA scenario where A's token can see B's course,
  Canvas accepts and A strips B's card from B's assignment description.
  Local `assignment_install_state` row for B's assignment is also deleted.
- Local row is also deleted on the rare path where Canvas write succeeds but
  the assignment doesn't belong to A (consistency hazard).

Even in the no-co-teach case, the local `assignment_install_state` row for
B's assignment gets deleted IF the Canvas write somehow doesn't 4xx (e.g.
empty `next === current` short-circuit at line 308 means **no Canvas write
attempts at all**, then the local delete at line 316 runs unconditionally).
A teacher who knows a peer's assignment-UUID could selectively delete peer
install-state rows just by triggering bulkUninstall.

**Fix direction:** Mirror `installOne`'s teacherId check at the top of
`uninstallOne`. Adding the join + comparison costs nothing per call and
closes the loop.

---

## 5. HIGH — Destination flags `post_to_drive` and `post_to_canvas_comment`
are write-only, never consumed

**Severity:** High (deceptive UX, partially overlaps with #1)

**File:**
- `src/lib/actions/bulk-install.ts:217-225` (writer)
- `src/app/api/submissions/[id]/confirm/route.ts` (does NOT read)
- `grep -rn "post_to_drive" src` confirms no consumer outside dashboard
  display.

**Scenario:**

In addition to the comment flag (finding #1), the `post_to_drive` flag is
also never consumed. The Drive write happens unconditionally in
`confirm/route.ts:170-208` (wrapped in a single try/catch that demotes a
failure to a warning). A teacher who unchecks "Drive" still gets a Google
Doc created for every confirm.

For HAH, the migration COMMENT (`migrations/20260520150000_destination_picker.sql:22-23`)
explicitly says "Always on for HAH today — locked-on in the dashboard picker."
That's by-design — but the bulk-install action still writes the field, and
nothing enforces that locked-on contract. If a future writer respects the
field but a stale row stored `post_to_drive=false`, the Drive write would
suddenly stop.

**Fix direction:** Either gate the Drive write on the column (preferred —
honors the picker as designed and makes the data layer truth-bearing), or
force `post_to_drive=true` in `bulk-install.ts` regardless of input (matches
the "locked-on" contract).

---

## 6. HIGH — Setup-page divergence: legacy `/setup` lets any authenticated
user become a teacher

**Severity:** High (privilege escalation surface)

**File:** `src/app/setup/page.tsx` + `src/lib/supabase/proxy.ts:36-77`

**Scenario:**

HAH has two setup pages: the new `src/app/teacher/setup/page.tsx` (server-
rendered, used by M6.x dashboard nav) and the legacy `src/app/setup/page.tsx`
(client-side wizard). The proxy guards only `/teacher/*` (except
`/teacher/setup`), not `/setup`. Even the `/teacher/setup` carveout means a
non-teacher can land on `/teacher/setup` AND `/setup`.

Both pages POST to `/api/teacher/setup/canvas`, which:
- Checks `user` exists (any authenticated identity) — **no teacher-role gate**
- Upserts a `teachers` row with `auth_user_id = user.id`
- After upsert: the proxy on the next request sees a teachers row and lets
  the user into `/teacher/dashboard`

Net effect: any signed-in user (including a student in a class-code-only
account) can self-promote to teacher by submitting their own Canvas URL and
token. They then have a `teachers` row with their identity, can sync their
own courses, install cards on their own Canvas, etc.

For EHS this is probably mitigated by Google-OAuth-only sign-in for the EHS
domain (no random outside accounts), but ANY signed-in account at the
domain (student, alum, etc.) can self-promote.

Suite-wide memory note `feedback_app-setup-consistency.md` flags this exact
divergence — HAH's legacy `/setup` shouldn't survive M7.2.

**Fix direction:**
- Add a teacher-role gate to `/api/teacher/setup/canvas` (e.g. check the
  user's email against an allow-list, an `is_teacher` column, or restrict
  to users explicitly added by an admin). Today the role is self-asserted.
- Delete `src/app/setup/page.tsx` once `/teacher/setup` is fully ported, per
  M7.2.

---

## 7. MEDIUM — Snapshot semantics: card text only refreshes on reinstall

**Severity:** Medium (documented, but no UI affordance)

**File:**
- `src/lib/card-text/resolve.ts:36-84` (resolver called at install time only)
- `src/lib/actions/bulk-install.ts:76,236-242` (bulk install reads once)
- `src/app/api/teacher/assignments/[id]/install/route.ts:103,110` (single
  install reads once)

**Scenario:**

`resolveCardTextForTeacher` is called inside install paths only. After
install, the card body (kicker, title, body, CTA, footnote) is FROZEN in
the Canvas description until a future reinstall. If a teacher edits
`teachers.card_*` via `/teacher/setup`, existing installed cards keep the
OLD text — only fresh installs (or reinstalls) pick up the new values.

This is correct architecturally — we don't poll Canvas to refresh every
card on every edit — but the teacher-side editor has no "Reinstall all"
button or "X cards need refresh" badge. A teacher edits the card text,
sees the preview update, and reasonably believes the live cards in Canvas
updated. They didn't.

The CTA URL is fine — it's a fixed `/student/courses/<cid>/assignments/<aid>`
which never changes. Only the static text in the description is stale.

**Fix direction:** Add a teacher-visible affordance: "Cards installed before
the most recent text edit show the older copy. Reinstall to refresh."
Optionally a "Bulk reinstall all" button. Tracking via
`assignment_install_state.updated_at` < `teachers.updated_at` would identify
the affected rows.

---

## 8. MEDIUM — Confirm path doesn't honor in-flight super-grader-scope changes

**Severity:** Medium (5-minute write-skew window)

**File:** `src/lib/super-grader/scope.ts:23-25` (5-min in-process cache),
`src/app/api/submissions/[id]/confirm/route.ts:215`

**Scenario:**

`isAssignmentInSuperGraderScope` caches results in-process for 5 minutes per
`canvas_assignment_id`. If a teacher disables SG-scope at t=0:00 (intending
"HAH should submit to Canvas directly from now on"), HAH instances with
cached `in_scope: true` will still skip the Canvas write for up to 5 minutes.
Conversely, enabling SG-scope mid-cycle has the same lag in the other
direction.

Symptom from the teacher's POV: "I just turned off SG routing — why is
Canvas not getting the transcript?"

Defensible (the cache is to keep dashboard rendering fast), but
under-documented for support. Same shape as suite-wide ~5min freshness
quirks.

**Fix direction:** Drop the TTL to 30-60s, or add a cache-purge admin
endpoint, or trigger a purge when the teacher edits the SG-scope config
in the super-grader app via an inter-app webhook.

---

## 9. MEDIUM — Canvas error categorization is undifferentiated

**Severity:** Medium (operational, no retries on transient 429/5xx)

**File:** `src/lib/canvas/client.ts:25-39, 70-72, 100-105, 149-154, 179-183`

**Scenario:**

All Canvas non-2xx responses are clumped:

```typescript
if (!res.ok) {
  throw new Error(`Canvas API error: ${res.status} ${res.statusText}`);
}
```

Consequences:
- **429 Too Many Requests:** Canvas's standard rate limit. No
  retry-with-backoff anywhere. A bulk install of 20 assignments that hits
  429 on assignment 12 will throw and leave the install in a partial state
  (12 installed, 8 failed-with-no-retry; subsequent retry needed by hand).
- **502/503/504 transient gateway errors:** Same — instant throw.
- **401 token-revoked / expired:** Same generic message; teacher gets "Canvas
  API error: 401" with no actionable "your token may have been rotated" hint.
- **403 permission errors** (e.g. teacher lost course access mid-term): also
  generic.

`bulkInstallAssignments` does handle per-assignment failures gracefully via
the `results` array — but the failure messages it bubbles up to the UI are
just `"Canvas API error: 429"`-style strings.

**Fix direction:**
- Detect 429 and 5xx, retry with exponential backoff (Canvas's
  `Retry-After` header when present).
- Surface specific user-facing messages for 401 ("Reconnect Canvas") vs 403
  ("You may have lost access to this course") vs 429 (auto-retry happening).
- Consider a small reusable `canvasFetch()` wrapper instead of inline `fetch`
  in 5+ methods.

---

## 10. MEDIUM — Token validity not verified at install time

**Severity:** Medium (poor failure UX, but no security impact)

**File:** `src/app/api/teacher/assignments/[id]/install/route.ts:79-129`

**Scenario:**

The install POST loads the teacher's `canvas_api_token` from `teachers` and
constructs a `CanvasClient` directly. If the token was rotated/revoked
between save and use:

- `getAssignment` returns 401 → "Canvas API error: 401" thrown
- POST route catches it and returns `{ error: "Canvas API error: 401" }` 502.

The teacher sees "Canvas API error: 401" with no actionable next step. There's
a `/api/teacher/setup/canvas/test` route that exists exactly for "is the token
still good?" checks but it's only called from the setup wizard, not from
install paths.

**Fix direction:** Either (a) accept this as good enough and improve the
error message at install time (translate 401 → "Your Canvas token may have
been revoked — visit Setup to reconnect"), or (b) call
`testCanvasConnection()` once per session and store a `last_verified_at`
column to short-circuit.

---

## 11. LOW — Marker-detection robustness is fine, but `installed_by`
becomes stale on co-teach reinstall

**Severity:** Low

**File:**
- `src/lib/canvas/install.ts:135-291` (marker + anchor-fallback finder)
- `src/app/api/teacher/assignments/[id]/install/route.ts:136-148`

**Marker detection is good** — `findCardBlock` accepts an
`{ courseId, assignmentId }` locator and falls back to an anchor-URL search
when Canvas's HTML sanitizer strips the comment. This is the suite-wide
sanitizer-strip workaround (memory note
`reference_canvas-html-sanitizer-strips-comments.md`); HAH's implementation
correctly mirrors AID's.

But: the install upsert (`install/route.ts:137-147`) overwrites `installed_by`
with the current teacher every reinstall. In a co-teach scenario where
teacher B reinstalls a card teacher A originally installed, the audit trail
loses A's identity. The `installed_at` default (`DEFAULT now()`) ONLY
applies on INSERT, not on UPDATE — so it correctly preserves the original
install timestamp, but `installed_by` is mutated.

**Fix direction:** Add `installed_by: existing.installed_by ?? teacherId` via
a two-step (SELECT then upsert), or split into "first install" (INSERT) vs
"reinstall" (UPDATE without touching `installed_by`). Low priority — affects
analytics, not behavior.

---

## 12. LOW — `assignment_install_state` doesn't track the destination flags
at install time

**Severity:** Low (audit/reconciliation, no behavior impact today)

**File:** `migrations/024_assignment_install_state.sql:10-16`

**Scenario:**

The install-state row records `canvas_install_url, installed_at, installed_by,
updated_at` — but NOT the destination flag values at install time.
`assignments.post_to_*` could be edited after install with no record of
what the teacher had configured when the card was first written.

Combined with finding #7 (cards frozen in Canvas), this makes it impossible
to audit "what destination did this card promise students at the time of
install" vs "what destination is the picker currently saying."

**Fix direction:** Optional — snapshot the destination triple into
`assignment_install_state` at install. Lets the dashboard surface
"installed-at" vs "current" destination mismatch as a yellow badge.

---

## 13. LOW — Auth-callback email match is exact-case-sensitive

**Severity:** Low (mitigated by Google OAuth normalization)

**File:** `src/app/api/auth/callback/route.ts:35-39`

**Scenario:**

```typescript
const { data: studentByEmail } = await admin
  .from("students")
  .select("id, auth_user_id")
  .eq("email", userEmail)
  .single();
```

`userEmail` comes from `data.session.user.email`. Supabase Auth normalizes
to lowercase, AND the roster sync now lowercases too. So in practice the
match is reliable. But if any path ever surfaces a mixed-case `userEmail`
(e.g. a future Apple-Sign-In integration that doesn't normalize, or a
manually-inserted students row), the match silently fails and the student
gets routed to "new student" path.

**Fix direction:** Defensive lowercasing on both sides at query time.

---

## 14. LOW — `bulk-install.ts` revalidatePath fires even on full-failure

**Severity:** Low

**File:** `src/lib/actions/bulk-install.ts:104, 158`

**Scenario:** `revalidatePath("/teacher/dashboard")` runs regardless of
whether the bulk-install succeeded or every assignment failed. Wasted work
on full-failure path; no correctness issue. Could skip when
`successCount === 0`.

---

## 15. LOW — `submitTextEntry` doesn't honor partial submission types

**Severity:** Low (correct, but a fragile assumption)

**File:** `src/app/api/submissions/[id]/confirm/route.ts:246-281`

**Scenario:**

The branch logic is:

```typescript
const supportsTextEntry = submissionTypes.includes("online_text_entry");
if (isDiscussion && ...) post discussion
else if (supportsTextEntry) submit text entry
else "doesn't accept text submissions — skipped"
```

If an assignment accepts BOTH `online_text_entry` AND `online_upload`, the
text entry wins — correct. But if assignment accepts ONLY `online_upload`,
HAH skips and warns "doesn't accept text submissions." Good fail-closed
behavior, but the warning could be clearer ("This Canvas assignment is
file-upload only — your Google Doc is created but not submitted to Canvas
automatically").

No bug; tidy-up only.

---

## Cross-cutting observations

**`as_user_id` masquerade is correct.** Every Canvas-write call that targets
a student's submission (`submitTextEntry`, `postDiscussionEntry` in
`src/lib/canvas/client.ts:127-185`) sets `as_user_id: studentCanvasUserId`
in the body. The confirm route refuses to call them when
`student.canvas_user_id` is null (`confirm/route.ts:234-236`). No path
writes to a student's submission AS the teacher.

The install path correctly writes the assignment description AS the teacher
(no masquerade) — that's the intended permission.

**Token decrypt failure: N/A.** Tokens are stored in plaintext in
`teachers.canvas_api_token`. There's no decrypt step that could fail.
Plaintext storage is a separate suite-wide concern (siblings do the same)
not specific to this audit.

**Auto-install:** HAH does NOT have an auto-install on Canvas sync. Install
is purely manual (POST /api/teacher/assignments/[id]/install) or via the
bulk-install action. No cron-driven race with manual install. ✓

**Roster filter:** `getStudents` uses
`enrollment_type[]=student&enrollment_state[]=active&include[]=email&per_page=100`.
Matches the documented suite shape. ✓ (in the canvas-client; per-course sync
route's downstream handling is still buggy — finding #2.)

**No body-mode vs comment-mode branching in confirm.** Today HAH only
supports body-mode (text entry / discussion entry). Comment-mode is the
unimplemented writer (finding #1).

---

## Suggested priority order for fixes

1. Finding #2 (roster sync regression) — silent data corruption, affects
   every dashboard load. Should ship in the next bug-fix batch.
2. Finding #3 (idempotency) — double-fire confirm = duplicate discussion
   posts + extra Google Docs per student. User-visible.
3. Finding #1 + #5 (destination picker dead-wired) — fix or hide the
   checkbox; UX deception today.
4. Finding #4 (uninstall ownership check) — small change, closes a real if
   narrow privilege gap.
5. Finding #6 (legacy /setup self-promotion) — M7.2 should kill `/setup`;
   meanwhile add a teacher-role allow-list on `/api/teacher/setup/canvas`.
6. Finding #9 (429 / token-revoked handling) — quality-of-life;
   `Retry-After` + categorized errors.
7. Findings #7, #8, #10-15 — followups when M6.18b-writer ships.
