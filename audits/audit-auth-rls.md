# HAH Audit — Auth / Authz / RLS / Storage / Admin / IDOR

Date: 2026-05-21
Branch: main
Audit scope: every layer that gates "who can read or change what" — proxy, OAuth callback, admin gate, RLS policies, storage policies, every `createAdminClient()` call site, IDOR on submission routes, super-grader bearer ingress, Google-token storage, join-code attack surface.

Severity legend:
- **CRITICAL** — exploitable privilege escalation / cross-user data exposure with low pre-conditions.
- **HIGH** — exploitable with modest pre-conditions, or stored secrets exposed beyond their need-to-know set.
- **MEDIUM** — fail-open or hardening gap that could be combined with another bug, or low-impact IDOR.
- **LOW** — defense-in-depth gap, no current exploit path.
- **INFO** — observation worth recording.

---

## 1. CRITICAL — Any authenticated user can self-promote to teacher

**Files**
- `src/app/api/teacher/setup/canvas/route.ts:11-60`
- `supabase/migrations/010_allow_teacher_self_insert.sql:1-5` (`Users can register as teacher` RLS policy with `WITH CHECK (auth_user_id = auth.uid())`)

**Scenario**
Any signed-in user (including any random Google account that can pass the OAuth allowlist) can POST `/api/teacher/setup/canvas` with their own Canvas base URL + token. The route does not enforce any domain, allowlist, or admin-invite gate. It writes a row into `teachers` keyed on `auth_user_id`. The teacher RLS INSERT policy (migration 010) accepts this because `WITH CHECK (auth_user_id = auth.uid())` is the only constraint.

Once promoted, the user passes the teacher-layout gate (`src/app/teacher/layout.tsx:22-30`) and the proxy's `/teacher/*` gate (`src/lib/supabase/proxy.ts:65-77`). They can then:
- Create courses (RLS allows: `Teachers can manage own courses`).
- Create assignments inside their courses.
- Sync students by-Canvas — calling Canvas API with their own token, but **migration 011** also lets them INSERT students directly with WITH CHECK (true) — see Finding 2.
- Insert enrollments tying any student row to their course (RLS only checks course_id is theirs; `student_id` is unconstrained).

**Roles coexistence**
The same `auth_user_id` can also be a row in `students` (the auth callback creates one for any non-teacher), so a single account can be in both tables simultaneously. Nothing prevents a "student" account from invoking `/api/teacher/setup/canvas` and gaining the teacher capability.

**Fix direction**
- Allowlist by email domain on the route (e.g. `episcopalhighschool.org`) or require an `INITIAL_TEACHER_EMAIL`-style invite/bootstrap parallel to admins.
- Drop the `Users can register as teacher` policy and have all teacher INSERTs go through a vetted server route that checks the allowlist.
- Bind teacher creation to the admin gate (require an existing admin to mint teachers).

---

## 2. CRITICAL — Teacher-INSERT policy on `students` is `WITH CHECK (true)`; combine with Finding 1 for full account hijack of any pre-Canvas student

**Files**
- `supabase/migrations/011_fix_insert_policies.sql:57-60`
  ```sql
  CREATE POLICY "Teachers can insert students" ON students FOR INSERT WITH CHECK (true);
  ```
- `src/app/api/auth/callback/route.ts:33-55` (by-email rebind path)

**Scenario**
Combined with Finding 1, an attacker:

1. Signs into HAH with any Google account → becomes "student" (auth callback inserts student row).
2. POSTs `/api/teacher/setup/canvas` → becomes "teacher" too (Finding 1).
3. As a teacher, uses the user-scoped client to `INSERT INTO students (email, display_name, ...)` for `victim@episcopalhighschool.org` with `auth_user_id = NULL`. The `WITH CHECK (true)` policy permits this.
4. Enrolls that student row into the attacker's own course (RLS lets teachers manage enrollments in their courses).
5. Victim signs in for the first time. Auth callback (`route.ts:33-55`) tries `auth_user_id=user.id` first (no hit), then **by email** (lines 35-39), finds the attacker-controlled row, and binds the victim by writing `auth_user_id = victim.id` into the malicious row (lines 45-53).
6. From that moment, victim's submissions, Google access/refresh tokens, transcriptions all attach to a `students` row that the attacker can SELECT via the "Teachers can view students in their courses" policy (migration 016 lines 58-61).

**Impact**
Full read of victim's Google access tokens and refresh tokens → attacker impersonates victim against Drive/Docs. Plus reads all of victim's transcriptions (their actual schoolwork — FERPA).

**Fix direction**
- Tighten the policy to `WITH CHECK (NOT EXISTS (SELECT 1 FROM students WHERE email = NEW.email))` — block teachers from creating rows for already-claimed emails, or
- Better: route ALL `students` writes through server code that uses the admin client and validates server-side. Remove the teacher-INSERT policy entirely. Canvas sync (the only legitimate teacher-insert path) already uses `createAdminClient()`.
- The auth callback's by-email rebind needs to also verify that no other student row already has the same `auth_user_id` and ideally that the row was created very recently by Canvas sync rather than by a generic teacher INSERT.

---

## 3. HIGH — Plaintext Google OAuth tokens readable by teachers via RLS

**Files**
- `supabase/migrations/003_create_students.sql:9-16` (token columns)
- `supabase/migrations/016_fix_rls_recursion_v2.sql:58-61` (`Teachers can view students in their courses` returns whole row)
- `src/lib/google/auth.ts:9-22`

**Scenario**
`students.google_access_token` and `google_refresh_token` are stored in plaintext. The teacher RLS SELECT policy on `students` is `id IN (SELECT auth_teacher_student_ids())` — it doesn't column-restrict. Any teacher can `select google_access_token, google_refresh_token from students where id = ...` for any student enrolled in their course.

With Finding 1 (anyone → teacher), this becomes: anyone with a HAH login can read Google tokens of any student they can manage to enroll in any course they create (combine with Finding 2 to force an enrollment without the victim's involvement).

Even without Finding 1, a legitimate teacher with a curiosity moment can read tokens for any of their actual students and impersonate them on Drive — well beyond what the design intends.

**Fix direction**
- Move tokens to a `student_google_tokens` table that no teacher can SELECT (only service-role + the owning student via `student_id = auth_student_id()`).
- Encrypt at rest (pgsodium or app-level AES-GCM with a key only the service-role server holds).
- Drop the token columns from `students`.

---

## 4. HIGH — Bearer-token comparison uses `===`, not constant-time compare

**File**
- `src/lib/peers/auth.ts:21`
  ```ts
  if (!match || match[1] !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  ```

**Scenario**
The super-grader ingress (`/api/super-grader/result`, `/api/super-grader/prompt`) compares the supplied bearer to `HANDWRITTEN_API_TOKEN` with a plain `!==`. JavaScript string equality on V8 is short-circuit (returns as soon as it finds a mismatching character) which is a textbook timing oracle. With enough requests an attacker can byte-by-byte recover the token. The token's blast radius is read of any student's transcript + Canvas submission text + Google Doc URL for any (canvas_user_id, canvas_assignment_id) pair — FERPA-grade content.

**Fix direction**
Use `crypto.timingSafeEqual` over Buffers of the same length (with length-pad to avoid the length leak). Also confirm `HANDWRITTEN_API_TOKEN` is ≥32 bytes of true entropy.

```ts
import { timingSafeEqual } from "node:crypto";
const a = Buffer.from(match[1]);
const b = Buffer.from(expected);
if (a.length !== b.length || !timingSafeEqual(a, b)) { ... }
```

---

## 5. HIGH — PostgREST `or()` filter injection via `user.email`

**File**
- `src/app/student/courses/[courseId]/assignments/[assignmentId]/layout.tsx:52-56`
  ```ts
  const { data: student } = await admin
    .from("students")
    .select("id")
    .or(`auth_user_id.eq.${user.id},email.eq.${user.email}`)
    .maybeSingle();
  ```

**Scenario**
`user.email` is interpolated raw into the PostgREST `or` clause. PostgREST uses commas to separate predicates and dots to separate `column.operator.value` tuples. If an attacker can register a Google/Supabase-Auth identity whose email contains a comma or other PostgREST control characters — quoted local-parts are technically RFC-5322-legal, and some IdP flows accept them — they can splice additional predicates into the OR.

Example exploit email (illustrative): `x@y,id.not.is.null` would render as:
```
auth_user_id.eq.<uuid>,email.eq.x@y,id.not.is.null
```
…which is three predicates OR'd, the third matching every row. `.maybeSingle()` then returns whatever student the planner picks first, and the enrollment check below it joins via that student_id — granting access to whichever course happens to be linked.

Supabase Auth currently rejects most weird emails, but layering on a regex check in the IdP isn't a guaranteed barrier — and the codebase shouldn't depend on it.

**Fix direction**
Avoid `.or()` with interpolation. Do two queries (by `auth_user_id`, then by `email`) and merge in JS, or use parameterized RPC. If keeping `.or()`, validate `user.email` matches a strict regex (`/^[a-z0-9._+-]+@[a-z0-9.-]+$/i`) before interpolating, or URL-encode the comma/period.

---

## 6. HIGH — `/api/admin/retention/delete` has no "type DELETE" server-side guard

**File**
- `src/app/api/admin/retention/delete/route.ts:1-96`
- `src/app/admin/retention/page.tsx:38` (UX text claims a "type DELETE" confirm exists)

**Scenario**
The retention page tells users "Delete is irreversible — there's a 'type DELETE' confirm before it runs." The API route accepts `{ beforeDate?: string | null }` and performs the destructive op as long as `isAdmin()` returns true. There is no server-side confirm token. An admin who clicks the panel's confirm dialog correctly is fine, but:

- A CSRF-shaped browser bug, an XSS in `/admin/*`, or a curious admin running a quick `curl` with their session cookie can wipe the whole `submissions` + `submission_photos` corpus with one POST and an empty body.
- `beforeDate` is optional and `null` means "delete everything" — there's no minimum-age safety floor.

Compared to the typical bulk-delete pattern (require `confirm === "DELETE"` in the body), this is fail-open.

**Fix direction**
- Require `confirm: "DELETE"` in the body and reject otherwise.
- Reject `beforeDate === null` unless an explicit `wipe_all: true` flag is set.
- Optionally require a fresh `isAdmin()` re-check that hits the DB rather than the cached `getCurrentAdminEmail()` (currently `cache()`-wrapped — fine for a request, but the safety value is in the verb of the user-facing confirm).

---

## 7. HIGH — `submission-photos` storage bucket missing UPDATE and DELETE policies

**File**
- `supabase/migrations/008_create_storage_bucket.sql:1-28`

**Scenario**
The migration only declares INSERT and SELECT policies for `storage.objects` on `submission-photos`. The user-scoped client at `src/app/api/submissions/[id]/photos/route.ts:49,77` calls `supabase.storage.from("submission-photos").remove(...)` and `.upload(..., { upsert: true })` — both of which silently fail under RLS because there is no DELETE or UPDATE policy. The Inngest job uses the service-role client (line 144 of transcribe-photo.ts) so the happy path still works, but:

- The user's "clear stale photos before re-upload" cleanup at `photos/route.ts:49` is a no-op — orphan blobs accumulate in `auth.uid()/submissionId/N.jpg`. Not a privacy leak (the SELECT policy still gates reads to the owner), but a quota and cost leak.
- `upsert: true` on `.upload()` requires UPDATE permission when an object already exists — the second upload to the same path will fail under RLS, which silently drops a photo.

**Functional bug masquerading as a security concern.** No cross-user read path because the SELECT policy still keys on `(storage.foldername(name))[1] = auth.uid()::text`. Storage path naming `${user.id}/${submissionId}/${pageNumber}.${ext}` is UUID-prefixed → not enumeration-friendly.

**Fix direction**
```sql
CREATE POLICY "Users can update own photos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'submission-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Users can delete own photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'submission-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
```

---

## 8. MEDIUM — Open-redirect via login `next=` accepting protocol-relative URLs

**Files**
- `src/app/login/page.tsx:20-22`
- `src/app/api/auth/callback/route.ts:8,103-107`
- `src/lib/supabase/proxy.ts:52-56`

**Scenario**
Login filters `next` to "starts with `/`". A protocol-relative URL `//evil.com/path` starts with `/`. The callback then redirects to `${origin}${next}` → `https://app.com//evil.com/path`. Most modern Next.js / Node fetch + browsers normalize that to `https://app.com/evil.com/path` (single slash), which is same-origin, BUT `NextResponse.redirect` constructs a URL via `new URL(target)` and `new URL("https://app.com//evil.com/path")` keeps the double-slash. Some downstream clients (older curl, some bot stacks, browsers under specific embedding) interpret `//evil.com` as protocol-relative.

`backslash-slash` variants (`/\evil.com`) and other slip-throughs are also worth checking — though browsers usually treat `\` differently from `/`.

The proxy at `proxy.ts:52-56` propagates the same loose check (uses `request.nextUrl.pathname` and `search` which is fine when read from the actual request, but the callback's redirect interpolates the user-supplied `next`).

**Fix direction**
After `next.startsWith("/")`, also enforce `!next.startsWith("//")` and `!next.startsWith("/\\")`. Even safer: parse as `new URL(next, origin)` and verify the result's `origin === origin`.

---

## 9. MEDIUM — Predictable join codes; no rate limiting on `/api/courses/join`

**Files**
- `src/app/api/canvas/courses/sync/route.ts:67`
  ```ts
  const joinCode = `${cc.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}-${cc.id}`.toUpperCase();
  ```
- `src/app/api/courses/join/route.ts:34-39`

**Scenario**
Join codes are generated as `<first 8 alphanumeric chars of course name>-<canvas_course_id>`. For typical EHS course names ("AP Bio 101", "English Honors") with mostly-public Canvas IDs (small integers, often guessable in order), an attacker who knows or guesses the course name and the rough Canvas course-id range can brute-force join codes very quickly. The route returns a clear "Invalid class code" or success in under a second and has no rate limit, no captcha, no exponential backoff. After joining, the attacker becomes "enrolled" in someone else's course → reads roster, assignments, and the teacher can't easily tell.

Because RLS for students on assignments / courses keys on enrollment, joining a foreign course = lateral access to course content.

**Fix direction**
- Use a 6-8 char random base32 code (`crypto.randomBytes(5).toString("base32")`), not derived from the name.
- Rate-limit `/api/courses/join` per IP and per auth user (e.g. 10 attempts / hour).
- Track failed-join counts on `courses` and lock out after N misses on the same code.

---

## 10. MEDIUM — Stale roster sync route still has `email ?? login_id` fallback bug

**File**
- `src/app/api/courses/[id]/sync/route.ts:92`
  ```ts
  email: cs.email ?? cs.login_id ?? null,
  ```

**Scenario**
CLAUDE.md flags this exact bug as "fixed across all 5 apps 2026-05-20" (HAH commit `9b3763e`). The newer `/api/canvas/courses/sync` route is fixed (lines 121-124 reject rows without an `@` and skip them); this older per-course `/api/courses/[id]/sync` route still has the broken fallback. When Canvas returns null `email` for a student, this code stores `login_id` (e.g. `"jsmith23"`) in the email column. That breaks the auth callback's by-email rebind (the user signs in with `jsmith23@episcopalhighschool.org`, the row has email = `jsmith23`, no match → a duplicate `students` row gets created with no Canvas linkage).

**Fix direction**
Port the fix from `/api/canvas/courses/sync/route.ts:121-124` to this route — also call Canvas's `/courses/:id/users?include[]=email` for emails and stitch by user_id, rejecting rows without `@`.

---

## 11. MEDIUM — Teacher install-state delete missing teacher-ownership check

**File**
- `src/lib/actions/bulk-install.ts:274-323` (`uninstallOne`)

**Scenario**
`installOne` checks `course.teacher_id !== teacherId` (line 203) before doing anything. `uninstallOne` (line 274 onward) loads the assignment but never re-verifies that the assignment's parent course belongs to the calling teacher. The Canvas write would fail because the teacher's token can't see foreign courses, but the local `admin.from("assignment_install_state").delete()` at line 316 IS unrestricted (service-role bypasses RLS) — so a teacher could delete another teacher's install-state row, causing the dashboard to falsely show "not installed" for the foreign teacher's assignment.

Low-impact today (no data loss; just dashboard inconsistency for the victim), but a missed gate that should match `installOne`.

**Fix direction**
Add the same `course.teacher_id !== teacherId` check in `uninstallOne`, or hoist the check into a shared helper.

---

## 12. MEDIUM — Submissions INSERT allowed without enrollment check

**File**
- `supabase/migrations/006_create_submissions.sql:25-31` and migration 016 lines 100-104
- `src/app/api/submissions/route.ts:49-57`

**Scenario**
The `Students can manage own submissions` policy only checks `student_id = auth_student_id()` — not whether the student is actually enrolled in the assignment's course. The submissions API also doesn't verify enrollment. A student who knows or guesses a UUID for an assignment they're NOT enrolled in (e.g. found via a leaked URL, a screenshot, or a previous course they've since been removed from) can POST `/api/submissions` and create a submission row. The FK constraint to `assignments(id)` passes; no RLS on the INSERT path stops it.

The student can't read the assignment text (SELECT RLS keys on enrollment), but they can pollute teacher dashboards and force the teacher to see a submission for a student they never invited.

**Fix direction**
Add enrollment check to the submissions WITH CHECK clause:
```sql
WITH CHECK (
  student_id = auth_student_id()
  AND EXISTS (
    SELECT 1 FROM enrollments e
    JOIN assignments a ON a.course_id = e.course_id
    WHERE e.student_id = auth_student_id()
      AND a.id = submissions.assignment_id
      AND e.is_active = true
  )
)
```
Or enforce in the API route via a quick enrollment lookup before INSERT.

---

## 13. LOW — `students.UPDATE` policy missing `WITH CHECK` (defense-in-depth)

**File**
- `supabase/migrations/003_create_students.sql:30-32`

**Scenario**
The student-self-update policy uses `USING (auth_user_id = auth.uid())` only — no `WITH CHECK`. Postgres falls back to USING for WITH CHECK in that case, so a student trying to update their `auth_user_id` to another user's UUID would still be rejected (the new row would fail USING). But a student CAN currently update mutable columns like `email`, `display_name`, `canvas_user_id`, `google_access_token`, `google_refresh_token`. The first two are harmless; the latter three create avenues for self-inflicted breakage (e.g., overwriting your `canvas_user_id` with someone else's value temporarily — UNIQUE will eventually reject, but the time window between read-and-write could be weaponized). Low severity but a hardening miss.

**Fix direction**
Add explicit `WITH CHECK (auth_user_id = auth.uid())`. Also consider column-level grants that prevent students from updating `canvas_user_id` or `auth_user_id` at all (those should only be system-set).

---

## 14. LOW — Login `next` parameter sniffing via callback `forwardedHost`

**File**
- `src/app/api/auth/callback/route.ts:99-108`

**Scenario**
The callback respects `x-forwarded-host` for non-local environments. On Vercel behind their proxy this is fine (Vercel sets it from the verified host header), but if HAH ever sits behind any other ingress that doesn't strip it, an attacker could send `X-Forwarded-Host: evil.com` and the post-OAuth redirect would land on `https://evil.com/...` — combined with Finding 8 (`next` accepting `/path` from the attacker's choice) to leak the auth session's just-set cookie. Low risk today on Vercel, worth a comment.

**Fix direction**
Allowlist `x-forwarded-host` against a hardcoded set (`process.env.NEXT_PUBLIC_APP_URL`'s host), or just drop the fallback and always use `origin`. Vercel's `request.url` already reflects the verified host.

---

## 15. INFO — `prompts` SELECT policy is `true` for any authenticated

**File**
- `supabase/migrations/021_prompts_table.sql:29-32`

The OCR prompt body isn't sensitive — students can already infer it from outputs — but the policy is broader than needed. Could restrict to teachers and admins for tidiness; not a finding worth fixing on its own.

---

## 16. INFO — Admin-bootstrap path is sound

`src/lib/auth/admin.ts:34-50` only fires the bootstrap INSERT when:
- The user has a valid email,
- That email matches `INITIAL_ADMIN_EMAIL` exactly (case-insensitive),
- AND the `admins` table is currently empty.

A blank or wildcard env var can't match a real email. The empty-table precondition is checked via the admin client, so it's not RLS-vulnerable. The only residual risk is the standard "anyone with OAuth at the bootstrap email becomes admin" — which is the design contract. No bug here, just confirming the threat model.

---

## 17. INFO — `/api/admin/*` gate coverage

All three `/api/admin/*` routes call `isAdmin()` at the top:
- `src/app/api/admin/prompts/[key]/route.ts:15`
- `src/app/api/admin/retention/delete/route.ts:13`
- `src/app/api/admin/retention/export/route.ts:14`

Server actions that mutate admin-owned data (`updateCardTextDefaults` at `src/lib/card-text/actions.ts:48`) also gate on `isAdmin()`. The `/admin/*` page tree is gated by `/admin/layout.tsx:11-12` which redirects non-admins. Per-route gating is intact across the surface I audited.

---

## 18. INFO — Submission IDOR routes are clean

- `/api/submissions/[id]/confirm` — `route.ts:105` explicitly verifies `student.auth_user_id !== user.id` after admin-load.
- `/api/submissions/[id]/reset` — `route.ts:49` does the same.
- `/api/submissions/[id]/photos` — uses the user-scoped client; RLS gates ownership.

These three look correct. The IDOR concern is moot for the routes that load via admin client + recheck ownership.

---

## Summary of suggested fix ordering

1. Findings 1 + 2 (teacher promotion + students INSERT-any) ship together as one allowlist + policy change.
2. Finding 3 (token storage) — separate table + encryption migration; coordinate with auth callback.
3. Finding 4 (timingSafeEqual) — one-liner.
4. Finding 5 (`.or()` injection) — two-query refactor.
5. Finding 6 (retention-delete confirm) — body validation.
6. Finding 7 (storage policies) — two-line migration.
7. Findings 8-12 — cleanup pass.
13-14 — defense-in-depth.
