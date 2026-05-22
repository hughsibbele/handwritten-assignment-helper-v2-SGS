# HAH audit — cross-system seams (webhook / ingress / Inngest / Drive / retention / crypto)

Date: 2026-05-21
Scope: `src/lib/peers/*`, `src/app/api/super-grader/*`, `src/lib/inngest/*`, `src/app/api/inngest/*`, `src/lib/google/*`, `src/app/api/admin/retention/*`, `src/lib/telemetry/sentry-init.ts`, `src/lib/supabase/*`, `src/lib/super-grader/scope.ts`, `src/proxy.ts`, `src/app/api/test-transcribe/route.ts`, confirm route, photos route.

Severity legend: **P0** = exploitable / silently destructive / privacy-poisoning, **P1** = production-realistic incident, **P2** = degraded state / cleanup, **P3** = nit.

---

## P0 — Public, unauth'd, cost-shaped endpoint: `/api/test-transcribe`

**File:** `src/app/api/test-transcribe/route.ts:4-29`, `src/lib/supabase/proxy.ts:41-43`

The proxy explicitly allow-lists every path under `/test-` and `/api/test-` to bypass the session check ("Allow auth routes, public routes, and system-to-system endpoints"). The route itself has no `getUser()` / `isAdmin()` / `checkSuperGraderBearer()` guard either — it just reads `formData.get("photo")` and calls `transcribeImage(base64, mimeType)` directly. No teacher-cap RPC, no rate limiter, no per-IP throttle, no recaptcha.

**Scenario.** Anyone with the deploy URL can POST a 5 MB image and the request hits Gemini on the project's API key. Posting a script with a few thousand requests in parallel runs up the Gemini bill against whichever Vercel project this lands on. Worse, the response includes raw Gemini error strings so the endpoint also serves as a diagnostic oracle ("is the API key configured / valid").

This is the same shape as the `INSTALL_TOKEN` cost-abuse class of bug; it just doesn't pretend to be a system-to-system endpoint. The proxy comment claims `/api/test-` is for system-to-system traffic but the route is not gated.

**Fix direction.** Two paths, take both:
1. Tighten the proxy matcher: remove the blanket `/test-` and `/api/test-` allow-list; allow only `/api/test-` under a hard gate (`NODE_ENV !== "production"`).
2. Inside `route.ts`: hard-return 404 in production (`if (process.env.VERCEL_ENV === "production") return new Response(null, { status: 404 })`), and require `isAdmin()` otherwise.

---

## P0 — Retention sweep has no state fence; can hard-delete in-progress and `submitted` work

**File:** `src/app/api/admin/retention/delete/route.ts:29-55, 76-90`; UI: `src/components/admin/retention-panel.tsx:60`

The `POST` body is `{ beforeDate?: string | null }`. The handler:

```ts
let listQuery = admin.from("submissions").select("id");
if (before) listQuery = listQuery.lt("created_at", before);
```

There is no `.in("status", ["confirmed", "submitted"])` filter, no "older than completed_at + 30 days" filter, no "not currently referenced by an open Inngest run" check. If the admin clicks "Delete everything" with `beforeDate=null` (which the UI allows — `JSON.stringify({ beforeDate: beforeDate || null })`), every submission in the database goes away, regardless of state, including:
- `draft` rows the user is currently editing
- `processing` rows where Inngest is mid-transcription (race: Inngest's `mark-processing` / `save-transcription` steps then write into a dead row — silent FK / no-op writes; transcripts vanish before super-grader can fetch them)
- `review` rows the student is about to confirm
- `confirmed` / `submitted` rows that super-grader has not yet pulled via `/api/super-grader/result` (the envelope build returns null, SG sees 404, the partnership-contract data is gone)

The UI even labels this clearly ("Delete everything before {date}" or "Delete everything") so it's a known capability, but there is no guard against deleting a `processing` row whose Inngest run is checkpointed and on retry. The admin button is a single-keystroke incident.

**Scenario.** Mid-year cleanup. Admin types `DELETE`, clicks button, deletes everything before 2025-12-31. Three students are currently in the upload flow (`processing`). Their photos are removed from storage, then the rows are deleted, then Inngest's next step writes a transcription to a row that no longer exists and silently succeeds with 0 rows updated. The submission appears stuck to the student. Worse, photos were just uploaded today (2026-05-21) but `created_at` is irrelevant to the delete query when `beforeDate=null`.

**Fix direction.**
1. Require `beforeDate` to be non-null (reject `{ beforeDate: null }` at the schema level — `z.string().date()`).
2. Add a state fence: `.in("status", ["confirmed", "submitted"])` so the sweep only touches terminal-state rows.
3. Add a "completed at least N days ago" floor: `.lt("confirmed_at", before)` AND `confirmed_at IS NOT NULL`.
4. UI: show the count that *would* be deleted before the confirm button enables.

This is the same shape as M6.19 Phase 1's stale-session sweep fix on OE — fence by state and by age, not just by raw `created_at`.

---

## P0 — Google access + refresh tokens stored in plaintext

**File:** `src/app/api/auth/callback/route.ts:84-96`, `src/lib/google/auth.ts:12-55`, students table

OAuth `provider_token` and `provider_refresh_token` are written directly into `students.google_access_token` / `students.google_refresh_token`. No column-level encryption, no `pgcrypto`, no envelope encryption. On read in `getStudentGoogleClient`, they're handed to `OAuth2.setCredentials` verbatim. The same admin clients that other routes use (Inngest, retention export) can read every student's refresh token in clear.

The refresh token is the high-blast-radius credential here: it can mint fresh access tokens until the user revokes the consent. Any service-role compromise (leaked `.env.local`, leaked Vercel env, dumped DB backup, retention CSV exfil) exposes long-lived access to *every student's Drive*.

**Scenario.** A backup of the Supabase project is shared with a contractor for debugging. The contractor or a downstream compromise gains the refresh tokens. Tokens are usable for months until each student happens to revoke or change password.

**Fix direction.**
1. Encrypt at rest. Either: `pgsodium` / `vault` / `pgcrypto` with a server-side KMS key, or app-level AES-GCM with a key in `process.env.GOOGLE_TOKEN_ENC_KEY` (rotatable, not committed). The retention export and any other reader should be unable to decrypt.
2. Treat retention CSV export rules accordingly — exclude these columns from any export.
3. Minimum scope check: confirm the OAuth scope is Drive-file-create only (not full `drive` scope) so even a leak is bounded.

---

## P1 — `checkSuperGraderBearer` uses non-constant-time `!==` comparison

**File:** `src/lib/peers/auth.ts:21`

```ts
if (!match || match[1] !== expected) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

`!==` short-circuits on first byte mismatch. Behind a public endpoint this is a textbook timing-attack target. The expected token is rotated rarely (shared with SG; per CLAUDE.md, only on incident), so the attacker has time and motive to brute it.

**Fix direction.** Replace with `crypto.timingSafeEqual(Buffer.from(match[1]), Buffer.from(expected))`. Guard against length mismatch first (`timingSafeEqual` throws on unequal lengths).

This is also the bearer used to read `/api/super-grader/prompt` and `/api/super-grader/result` — a successful brute lets an attacker pull *every* student's transcript text + their student email + canvas_user_id. Note that `email` and `canvas_user_id` are surfaced in the envelope (`envelope.ts:108`).

---

## P1 — Confirm flow has no transactional boundary; partial failures leave inconsistent state

**File:** `src/app/api/submissions/[id]/confirm/route.ts:147-340`

The route is a sequence of independent writes against four backends:
1. `UPDATE submissions SET status='confirmed'` (DB; line 148)
2. `getStudentGoogleClient` → `getOrCreateCourseFolder` (Drive create) → `createGoogleDoc` (Drive + Docs API) → `UPDATE submissions SET gdoc_id/gdoc_url` (DB; lines 169-208)
3. `CanvasClient.submitTextEntry` / `postDiscussionEntry` → `UPDATE submissions SET status='submitted'` (Canvas + DB; lines 228-302)
4. `pushToSuperGrader(canvasUserId, canvasAssignmentId)` (outbound webhook; lines 335-340)

There is no compensating action when a later step fails. Realistic failure scenarios:

- Step 1 succeeds, Drive token revoked → Doc not created, row says `confirmed`. SG webhook fires, super-grader sees envelope with `google_doc_url=null`. The student has to know to "re-login with Google" (warning text), but the submission is already confirmed and ready to push to Canvas. Mismatch.
- Step 2 succeeds (doc created), Canvas down → row says `confirmed` with a Drive doc URL, but `submitted_to_canvas_at` is null. Webhook fires. SG sees `summary.google_doc_url` set, infers it's done. Teacher sees nothing in Canvas. Student sees "confirmed" but no Canvas link. Confusing for the teacher, who now needs to manually post.
- Step 3 succeeds, SG webhook times out → row says `submitted`, but SG never receives the event (notify is fire-and-forget, 5s timeout, no retry). SG must poll-fetch via `/api/super-grader/result` to catch up. Per the contract that's fine — but only if SG knows to look.
- Step 4 succeeds, Step 3 already submitted to Canvas, but row write of `submitted_to_canvas_at` lost in between (rare DB hiccup) → super-grader sees `submitted_to_canvas_at: null`, considers the work not-yet-canvas. If SG's scrape later sees the body, it'll be flagged correctly via the sentinel marker — but the in-app dashboards diverge.

The bigger structural issue: the row is flipped to `confirmed` *before* the Drive doc is created. The window between `status='confirmed'` and `gdoc_url` being written is narrow on success but unbounded on failure. Any retry loop in front (e.g. user double-clicks the confirm button) will hit the auth-route's idempotency model: nothing prevents a second invocation, which will create a *second* Drive doc (no `gdoc_id IS NULL` check at line 169).

**Fix direction.**
1. Reorder: create the Drive doc *first*, then flip status. If Drive fails, status stays `review` and the student sees a clean retry.
2. Guard against double-create: `if (submission.gdoc_id) skip drive creation` early.
3. Lock the route via a `confirming` intermediate status, set with a SELECT FOR UPDATE-ish RPC, to prevent two parallel confirms.
4. SG webhook: keep it fire-and-forget (right call), but consider an Inngest event for proper retry+backoff instead of a single 5s `fetch` — and make sure `pushToSuperGrader` is itself idempotent (super-grader's `/api/ingest/handwritten` upsert is presumably keyed on (canvas_user_id, canvas_assignment_id) — verify on the SG side).

---

## P1 — Inngest cron `cleanup-old-photos` state fence is inverted (deletes *only* finished work)

**File:** `src/lib/inngest/functions/cleanup-photos.ts:14-29`

The query:
```ts
.in("submissions.status", ["confirmed", "submitted"])
```

This is *backwards*. The intent (per the inline comment: "Safety net: clean up any orphaned photos older than 1 week (photos are normally deleted immediately after transcription)") is to clean up photos whose transcription succeeded but whose storage-delete step (`transcribe-photo.ts:135-149`) failed.

But by filtering to `confirmed | submitted`, the cron does nothing for:
- Photos in `draft` or `review` submissions that got abandoned (the dominant orphan source — student uploads photos, sees the transcription, never clicks confirm)
- Photos in `processing` submissions stuck on a permanent failure (Inngest retried 3× and gave up)
- Photos whose `submission_id` row was deleted directly (FK CASCADE leaves photos behind only if there are extra rows somehow — but the inner-join would skip those too)

Net: the cron only deletes blobs whose owning submission is already in a clean final state, where photos are already most-likely deleted because `transcribe-photo` ran the storage `.remove()` on step 5. So the cron is doing close to zero work and the actual orphan class (abandoned-draft photos) accumulates forever.

**Scenario.** Class of 30 uploads photos to start a draft, half of them never confirm. Storage grows unboundedly because the cleanup state fence excludes them.

**Fix direction.** Invert the fence. Either:
- Drop the status filter entirely and rely on `created_at < now() - 7 days` as the cutoff (any photo that old whose submission hasn't been touched is fair game), OR
- Filter the *opposite* way: `.not("submissions.status", "in", "(processing)")` and require `created_at < 7 days`. The intent is "delete unless transcription is still actively running."

Also: there's no cron-auth header check. Inngest's signing-key signature on the POST is the only authn — verify `INNGEST_SIGNING_KEY` is required in production (if unset, the `serve()` adapter accepts any POST, including spoofed ones; covered by Inngest framework but worth a smoke test after every Vercel rename per CLAUDE.md).

---

## P1 — Drive folder creation has a TOCTOU race (creates duplicate folders + duplicate teacher shares)

**File:** `src/lib/google/drive.ts:19-73`

The code reads `enrollment.gdrive_folder_id`, returns early if set, otherwise creates a folder *and* writes back the id. There is no DB-level lock between the read and write. Two confirms running in parallel for the same enrollment (e.g. student double-taps the confirm button, two browser tabs, or upload + retry) will both observe `gdrive_folder_id = null`, both `drive.files.create()` a new folder, both share-with-teacher, both `update().eq(enrollmentId)` — last write wins. The student now has two folders with the same name, the teacher sees two share notifications (modulo `sendNotificationEmail: false`), and one of the folders is orphaned (no docs ever land in it because subsequent confirms hit the cached id).

**Fix direction.** Use an `UPDATE ... WHERE gdrive_folder_id IS NULL RETURNING id` to acquire the slot before calling Google:
```ts
UPDATE enrollments
SET gdrive_folder_id_pending = gen_random_uuid()
WHERE id = $1 AND gdrive_folder_id IS NULL AND gdrive_folder_id_pending IS NULL
```
Or simpler: do the Drive create first, then `UPDATE ... SET gdrive_folder_id = $1 WHERE id = $2 AND gdrive_folder_id IS NULL` — if 0 rows affected, another worker won, garbage-collect the just-created folder via `drive.files.delete`.

The same shape applies to the `gdoc_id` field on `submissions` after a doc is created in `confirm` (a double-click in a 2-second window will create two docs).

---

## P1 — `/api/super-grader/prompt` Cache-Control may leak across satellites

**File:** `src/app/api/super-grader/prompt/route.ts:34-36`

```ts
headers: { "Cache-Control": "private, max-age=600" }
```

The header is `private`, so a downstream CDN won't share it — good. But the `prompts` table is owner-scoped (`.eq("owner", "handwritten")`) and the route doesn't echo the `key` into a `Vary` header or a path segment. If super-grader's HTTP cache keyed only on the URL and ignored the bearer token, two different SG installations sharing the same proxy could see each other's prompts — though that's an SG-side bug, not HAH's. On the HAH side the bigger risk is: if the bearer ever leaks and an attacker requests `?key=ocr_handwriting_v1`, they get back the live prompt body. That's not catastrophic (prompts aren't secret) but combined with the `result` endpoint they get the full grading surface.

The 10-min TTL is also long for an auth'd endpoint behind a satellite token; once the admin saves a prompt, SG's view stays stale for up to 10 minutes (matches the in-process TTL in `prompts/load.ts`, so consistent — just noting it's by design).

**Fix direction.** Lower priority, but: drop `Cache-Control` here (`no-store`), or move to `must-revalidate` with an `ETag` on `(version, updated_at)`. Lower TTL or zero when admin saves are infrequent.

---

## P2 — `notify.ts` outbound webhook is not idempotent on retry

**File:** `src/lib/peers/notify.ts:48-71`, `src/app/api/submissions/[id]/confirm/route.ts:331-340`

Pattern:
- Confirm route awaits `pushToSuperGrader(...)`.
- Inside, single `fetch` with 5s `AbortController`. Any non-2xx is logged, not retried, not re-queued.

If super-grader is briefly down (rolling deploy, network blip), the confirm row stays `submitted` but SG never receives the event. There's no replay queue. SG's contract says it can pull via `/api/super-grader/result`, but only if it knows to. The retention sweep eventually deletes the row.

**Fix direction.** Move the push to an Inngest function (`super-grader.push`), with retries + backoff. The current 5s timeout + no retry is the *only* place in HAH's path where SG state can permanently diverge.

Also: there's no signature on the outbound POST beyond the bearer. The bearer compare on SG's side is presumably the same `!==` shape (their satellite-name'd `HANDWRITTEN_INGEST_TOKEN`). Add an HMAC over the JSON body if SG cares about replay protection.

---

## P2 — Retention CSV export loads everything in one shot

**File:** `src/app/api/admin/retention/export/route.ts:22-44`

```ts
const { data: rows, error } = await query;  // no .range(), no pagination
```

At end-of-year cleanup time, "rows" can be 5–10 K submissions with transcription_text included (each potentially several KB). The whole result is held in memory while CSV strings are constructed line-by-line into a single string concatenation. Vercel's response is also buffered.

**Fix direction.** Stream via `NextResponse(new ReadableStream(...))` and page through Supabase 1000 rows at a time. Or accept the limit and document it ("export caps at 5000 rows; filter by `before` for older subsets").

The UTF-8 BOM (`﻿`) is correct and load-bearing for Excel-on-Windows — keep.

---

## P2 — Storage objects are deleted *after* DB ids are listed but DB cascade runs *after* storage; window for orphans

**File:** `src/app/api/admin/retention/delete/route.ts:42-89`

Order:
1. List submission ids (single shot).
2. List photo storage_paths (chunked over submission ids).
3. Delete storage objects (chunked, errors logged not fatal).
4. Delete submissions (CASCADE drops photo rows).

The window is: between step 3 (storage gone) and step 4 (DB rows gone), a concurrent reader hitting `/api/super-grader/result` for one of these submissions will fetch the envelope (DB row still present, `gdoc_url` and `transcription_text` populated, `page_count` from a head count on `submission_photos` — wait, the photos table is intact until step 4's CASCADE).

The real issue is step 3 itself: a storage `.remove(chunk)` error is logged but the loop continues. If a storage chunk fails (rate limit, network), we end up with DB row gone (after step 4) and orphaned blob. Comment says "orphan blobs are recoverable later" — but the cleanup cron (`cleanup-photos.ts`) only sees blobs whose photo row still exists. Once the submission row is dropped, the `submission_photos` rows cascade away. The blob has no DB reference and is unrecoverable without a manual storage prefix scan.

**Fix direction.** Delete photo *rows* before deleting storage blobs, or persist `(storage_path, deletion_attempted_at)` to a `deleted_blobs` table so the cron can mop up later. The current order maximizes orphan risk for the rare partial failure case.

---

## P2 — Sentry init has no `beforeSend` PII scrubber

**File:** `src/lib/telemetry/sentry-init.ts:21-29`

Comment explicitly acknowledges: "teacher Canvas tokens and student photos pass through request scope on some routes — no redaction story yet." The mitigation is `sendDefaultPii: false`, but that only redacts known PII fields (IP, user objects). Error events on, e.g., the confirm route can pull in:
- `transcribed_text` (student-authored work, possibly contains real names since it's the student's own writing)
- `teacher.canvas_api_token` (in the destructured object passed around)
- `provider_token` / `provider_refresh_token` (in auth-callback Sentry envelopes if an error fires)

This is the same finding as the AID audit flagged. The pattern is identical.

**Fix direction.**
```ts
beforeSend(event) {
  if (event.request?.headers) {
    delete event.request.headers["authorization"];
    delete event.request.headers["cookie"];
  }
  // Scrub known sensitive fields from breadcrumbs and extras
  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (/token|password|secret|api_key/i.test(key)) event.extra[key] = "[redacted]";
    }
  }
  return event;
}
```
And drop `tracesSampleRate: 0` consideration aside — perf events would surface URL+query, which can leak ids; current setting is correct.

---

## P2 — `pushToSuperGrader` confirm-time envelope build runs *after* status flip, double-DB-roundtrip risk

**File:** `src/app/api/submissions/[id]/confirm/route.ts:335-340`, `src/lib/peers/envelope.ts:34-83`

When `pushToSuperGrader` is invoked at the end of the confirm route, it triggers `buildEnvelopeForCanvasIds`, which re-fetches the submission row, the student row, the assignment row, and counts photos. All of that data was already in scope at the top of the confirm handler — we just looked it up at line 60-89. Two reads in the same request, plus a third on the recent-50 submissions query. Not catastrophic (submission count is small per student) but inefficient.

More importantly: the envelope is built *post-status-flip*. If a step earlier in the flow (Canvas, Drive) failed and the row never made it to `submitted`, the envelope will reflect `status='confirmed'` and `submitted_to_canvas_at: null`. SG's contract treats `confirmed` as a valid completion state per the snapshot fields in the envelope. That's intentional, but worth flagging: a "Canvas submit failed" warning shown to the student won't reach SG.

**Fix direction.** Pass the in-scope rows into `buildEnvelopeForCanvasIds` instead of refetching, or expose `buildEnvelopeFromRow(submission)` for in-process callers. Snapshot-wise, this is correct (envelope reads state at the time of the push, not at confirm-start) — keep that property.

---

## P3 — `students` table linkage in `auth/callback` uses email match; can rebind a Canvas roster row to a foreign auth user

**File:** `src/app/api/auth/callback/route.ts:34-55`

When a Canvas-synced student row has `auth_user_id IS NULL` and email matches the incoming Google auth user, we set `auth_user_id`. If two Google accounts share the same Canvas-stored email (rare but possible for typo'd roster rows or shared family addresses), the first sign-in wins and binds. The second sign-in falls through to the "no studentId" branch and creates a duplicate student row. Detection on the duplicate is left to the unique constraint on email — if `students.email` is UNIQUE, the second INSERT fails; if not, you get a silent duplicate.

**Fix direction.** Verify `students.email` has a UNIQUE constraint. If not, add one.

---

## P3 — `/api/super-grader/result` Cache-Control of 30s OK; but query is unbounded by `limit(50)` recent submissions

**File:** `src/lib/peers/envelope.ts:54-64`

The submissions select uses `.limit(50)` then filters in JS for the matching `canvas_assignment_id`. If a student happens to have 50+ recent confirmed/submitted submissions and the target assignment is older, the `.find()` returns nothing and the endpoint 404s. Realistic at end-of-year for a heavy class.

**Fix direction.** Filter at SQL time: `.eq("assignments.canvas_assignment_id", canvasAssignmentId)` rather than fetching 50 and `find`-ing in JS. The Supabase nested-join filter should support this on the right side.

---

## P3 — `getStudentGoogleClient` refresh path is silent on full revocation

**File:** `src/lib/google/auth.ts:39-56`

If the student's refresh token was revoked (they un-installed the OAuth app), `client.refreshAccessToken()` throws. The current code lets the throw bubble up to the confirm route, which catches it and pushes a warning ("Google Doc creation failed. You may need to re-login with Google."). That's correct, but:
- The row is already flipped to `confirmed` (see P1 above).
- The stale `google_access_token` is *not* cleared on revoke. Next attempt makes the same broken call.

**Fix direction.** Catch the revoke-shape error (`invalid_grant`) and null out `google_access_token` / `google_refresh_token` on the student row so a clean re-login is the only path forward.

---

## Summary of state-fence / fail-open / idempotency posture

| Mechanism | State fence? | Fail-open? | Idempotent? |
|---|---|---|---|
| `/api/super-grader/result` | reads `confirmed/submitted` only ✓ | bearer required, 500 if unset (fail-closed ✓) | safe (read-only) |
| `/api/super-grader/prompt` | n/a | bearer required, 500 if unset ✓ | safe (read-only) |
| `pushToSuperGrader` outbound | reads `confirmed/submitted` only ✓ | silent no-op when SG env unset ✓ (correct for local) | **NO retry** — single 5s fetch |
| Inngest `transcribe-photo` | step.run reads/writes guarded by `if (!photo)` ✓ | rate-limit DB error → fail-open ✓ | reasonably idempotent via step.run checkpointing |
| Inngest `cleanup-old-photos` | **fence is inverted** (P1 above) | n/a | yes |
| Confirm route | no — status flips first (P1) | drive/canvas failures keep status=confirmed (partial state) | **NO** — double-confirm creates duplicate Drive doc + folder |
| Retention sweep | **NO state fence** (P0) | n/a | yes (re-run on empty list returns 0) |
| Drive folder/doc create | no — TOCTOU on `gdrive_folder_id` (P1) | n/a | **NO** |
| Sentry init | n/a | DSN unset → no-op ✓ | n/a — but **no `beforeSend` PII scrubber** (P2) |

---

## Other notes

- `src/proxy.ts` redirects unauthenticated users to `/login?next=...`. The `next` param is preserved verbatim. Open-redirect class: ensure `/login` page validates `next` is a relative path. Did not deep-dive but worth a follow-up.
- `INITIAL_ADMIN_EMAIL` self-bootstrap (`/lib/auth/admin.ts:44`) inserts an admin row on first sign-in if the `admins` table is empty. If an attacker can predict the email and the table is empty for any reason (fresh restore, post-`supabase db reset --linked`), they bootstrap themselves to admin. Mitigation is operational (always set `INITIAL_ADMIN_EMAIL` to a value the attacker doesn't control), but worth noting that a `db reset` opens this window.
- `SUPER_GRADER_INGEST_TOKEN` and `HANDWRITTEN_API_TOKEN` are distinct env vars per the .env.example, with the asymmetric naming convention documented. No code path conflates them. ✓
- The Vercel-rename Inngest-stale issue from suite memory (`feedback_inngest-resync-after-vercel-rename.md`) has no in-app verification or admin button. Adding a `GET /api/admin/inngest-resync` that PUTs `/api/inngest` would close the operational gap. Currently relies on the operator remembering to `curl -X PUT` after rename.
- `request.cookies.set` in the proxy mutates `request.cookies` then constructs a new `NextResponse.next({ request })` — matches the official Supabase SSR pattern; no auth holes spotted there.

