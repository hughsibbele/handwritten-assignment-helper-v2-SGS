# HAH Audit — Submission state machine, transcription pipeline, RLS, confirm flow

**Date:** 2026-05-21
**Auditor:** Claude (Opus 4.7, 1M context)
**Scope:** `src/app/api/submissions/**`, `src/app/api/inngest/route.ts`, `src/lib/inngest/**`, `src/app/student/submissions/[submissionId]/page.tsx`, `src/app/student/courses/[courseId]/assignments/[assignmentId]/page.tsx`, `src/components/upload/photo-dropzone.tsx`, `src/lib/prompts/load.ts`, `src/lib/gemini/{transcribe,rate-limit}.ts`, `src/lib/peers/{envelope,notify}.ts`, `src/lib/canvas/client.ts`, `supabase/migrations/006-024`, `20260520*`.
**Reference:** Mirror of the OE M6.19 / AID-audit campaign. Same five suite-wide root causes applied:
1. No snapshot semantics (live FK reads at confirm/transcribe time)
2. No state fences on UPDATEs
3. No transactional boundaries across subsystems (Gemini + Drive + Canvas + super-grader)
4. Fail-open instead of fail-closed
5. No retry/idempotency on user-visible mutations

The bug count below reflects all five root causes plus HAH-specific concerns (destination-picker not honored at confirm, photo upload double-fire, Inngest retry duplicating Drive docs, storage RLS gaps, super-grader webhook double-fire).

---

## CRITICAL

### C1 — `confirm` flow ignores the M6.18b destination picker (`post_to_drive`, `post_to_canvas_comment`, `post_to_canvas_submission`)

**Files:**
- `supabase/migrations/20260520150000_destination_picker.sql:14-17` — adds the three booleans, with comments explicitly saying they replace the legacy single boolean.
- `src/lib/actions/bulk-install.ts:220-223` — teacher's install action writes all three.
- `src/app/api/submissions/[id]/confirm/route.ts:32-35,148-157,168-208,219-302` — confirm body schema is `{ transcriptionText, submitToCanvas }`. The selected `submission` row never queries `post_to_drive` / `post_to_canvas_comment` / `post_to_canvas_submission`. Drive doc creation happens unconditionally (`createGoogleDoc(...)` always runs in the try block). The "should we POST to Canvas?" decision is the client-supplied `submitToCanvas`, not the per-assignment teacher setting.
- `src/app/student/submissions/[submissionId]/page.tsx:328,345,633` — student-side default for the Canvas checkbox is `assignment.canvas_submit_by_default` (legacy column). Never reads the picker.
- `src/app/student/courses/[courseId]/assignments/[assignmentId]/page.tsx:27,68,273` — same: only reads the legacy column.

**Root cause:** No snapshot semantics (#1) + dead code paths. The teacher dashboard wires the picker through to the row, but the read path on confirm only honors `canvas_submit_by_default` (which the bulk-install action keeps in sync with `post_to_canvas_submission` only — `post_to_drive` and `post_to_canvas_comment` are write-only fields nothing reads).

**Failure scenario A — teacher unchecks Drive.** Teacher disables "Drive" in the destination picker for an assignment (e.g. they want students' written work to stay in their own folder; or it's a sensitive prompt). The picker writes `post_to_drive=false`. Student uploads, hits Confirm. Confirm route at line 168 still calls `getOrCreateCourseFolder` + `createGoogleDoc`. **Doc lands in Drive anyway**, shared with the teacher's email. The teacher's express opt-out is silently overridden.

**Failure scenario B — teacher enables submission comment.** Teacher sets `post_to_canvas_comment=true` expecting the transcript to appear as a submission comment (SpeedGrader). The schema migration comment says "Writer not yet implemented for HAH" — but the picker is exposed in the dashboard so teachers see and can toggle it. They check it. Nothing happens at confirm time. **The toggle is a UI lie.** No "not yet supported" warning surfaces to the teacher.

**Failure scenario C — teacher enables only Drive + comment, NOT submission.** Teacher wants the transcript routed to SpeedGrader only (post_to_drive=true, post_to_canvas_submission=false). Student opens the review screen. The student-side checkbox defaults to `canvas_submit_by_default`. But wait — `bulk-install.ts:223` writes `canvas_submit_by_default: destination.submission` so the legacy column reflects the new picker for submission only. So in this case the legacy column = false, the checkbox defaults to unchecked. OK. But: the teacher's intent is the comment-mode write that doesn't exist (B). And the legacy field is still doing the gate on the (273) block-upload path → if the legacy field has been written as `false` (because submission is off), the student still sees the upload UI. If teacher's intent was "comment-only" it never lands. If `canvas_submit_by_default` ever drifts from `post_to_canvas_submission` (because bulk-install fails halfway, or a future writer writes only the new fields), the student-side defaults silently disagree with what the teacher set.

**Suggested fix.**
1. Confirm route: SELECT the three destination booleans alongside the submission. Gate `createGoogleDoc(...)` on `post_to_drive`. Gate the Canvas submission/discussion path on `post_to_canvas_submission`. Implement (or hide in UI) `post_to_canvas_comment` — the migration comment is honest, so the picker checkbox should be `disabled + tooltip="coming soon"` until the writer exists.
2. Student page: read `post_to_canvas_submission` instead of `canvas_submit_by_default`. The latter is officially deprecated per the migration comment but every read in `student/...` still uses it.
3. Don't pass `submitToCanvas` from the client at all. The destination is a teacher-owned policy, not a student choice. (Or, if you want a student opt-out for "I changed my mind", read teacher policy + AND it with student choice.)
4. Drop the legacy `canvas_submit_by_default` column in a follow-up migration once read paths are migrated; the dual-write to keep two fields in sync is a permanent drift risk.

---

### C2 — Confirm flow has no state fence → double-confirm = duplicate Drive doc, duplicate Canvas submission, duplicate super-grader push

**Files:**
- `src/app/api/submissions/[id]/confirm/route.ts:37-349` — entire route. No idempotency check, no advisory lock, no `.eq("status", "review")` guard on the UPDATE that flips to `confirmed`.
- `src/app/student/submissions/[submissionId]/page.tsx:411-455` — the client `handleConfirm` sets `confirming=true` to disable the button, but: the button is re-enabled if React unmounts (close tab + reopen + click again), if the request response is slow and the user opens another tab, or if there's no server-side guard.

**Root cause:** No state fence (#2) + no transactional boundary (#3) + no idempotency (#5).

**Failure scenario.**
1. Student clicks "Confirm & Create Google Doc". Network is slow. Client awaits but the user, frustrated, refreshes the tab. (Or opens the submissions page in two tabs and clicks Confirm in each — perfectly reasonable behavior.)
2. Request A reaches the server, runs the full pipeline: UPDATE submissions → confirmed; createGoogleDoc → docId=A, docUrl=A; UPDATE submissions with gdoc_id=A; CanvasClient.submitTextEntry → Canvas creates submission attempt #1; UPDATE submissions status=submitted; pushToSuperGrader → POSTs envelope.
3. Request B reaches the server in parallel. Same `submission` row read passes (status is still 'review' in the read snapshot it took, or 'confirmed' but the UPDATE doesn't fence on prior state). createGoogleDoc fires again → docId=B, docUrl=B; UPDATE submissions with gdoc_id=B (overwrites A — A is now orphaned in the student's Drive, still shared with the teacher); CanvasClient.submitTextEntry → Canvas creates a SECOND submission attempt (Canvas's submission history grows; per-assignment attempt counter ticks; the teacher's gradebook may show "Resubmitted" badge erroneously); pushToSuperGrader fires again → super-grader's `peer_results` row upserts twice (overwrite, but with potentially-different `confirmed_at`).

**Specific damages.**
- **Two Google Docs in student's Drive.** Both shared with the teacher. The DB row points at one (whichever update lost the race); the other is orphan-shared (FERPA notion: copies of student handwriting work the teacher can read indefinitely with no UI to find them).
- **Two Canvas submissions in the gradebook history.** Canvas's `online_text_entry` POST creates a new submission each time. Worse, the second submission's `body` overwrites the first as the current submission body (Canvas behavior). The teacher sees an extra entry in submission history.
- **Two super-grader pushes.** The webhook is idempotent at the upsert level (per AID notes that `peer_results` upserts on `(peer, canvas_user_id, canvas_assignment_id)`), but the second call's envelope can have a `completed_at` that's a few seconds later than the first's; super-grader's view changes meaningfully if both pushes were triggered by separate paths in the future.

**Suggested fix.**
1. Add a state-fenced UPDATE at the top of confirm. Issue:
   ```sql
   UPDATE submissions SET status='confirming', updated_at=now()
   WHERE id=$1 AND status='review'
   RETURNING id;
   ```
   If no row returned → 409 Conflict with the current state. This makes the route reentrant-safe.
2. Or: surface a confirm idempotency token from the client, store it on the row, reject duplicates with the previous response.
3. The "set gdoc_id only if currently NULL" pattern would at least prevent overwriting (and the second request could fast-path-return the same docUrl).

---

### C3 — Inngest `transcribe-photo` writes Drive/Canvas/super-grader nothing, but: photo-state advancement isn't fenced, and `processing` → `review` flip races the user's reset → "review" state can be reapplied AFTER reset to draft

**Files:**
- `src/lib/inngest/functions/transcribe-photo.ts:151-190` — `check-submission-complete` step reads `submissions.status` and only writes if `status === 'processing'`. Good intent, but the read-then-write is non-atomic. Between the read and the UPDATE, the user can call reset → status flips to `draft`, then the worker's UPDATE overwrites it back to `review`.
- `src/lib/inngest/functions/transcribe-photo.ts:181-188` — UPDATE has no `.eq("status", "processing")` fence.
- `src/app/api/submissions/[id]/reset/route.ts:73-93,113-117` — reset deletes photos + storage but the UPDATE to status='draft' has no fence either. Even if the worker is in flight, reset can race the worker's `mark-processing` / `save-transcription` steps and: (a) delete the storage file mid-Gemini-call (next step throws on storage download), (b) flip a row to status='draft' that the worker then flips back to 'review' three seconds later.

**Root cause:** No state fences (#2) + no idempotency (#5).

**Failure scenario A — slow Gemini, fast reset.**
1. Student uploads 3 photos. submission.status = 'processing'. Inngest fires 3 transcribe-photo events.
2. Photo 1 finishes fast (status='completed' on the photo row). Photos 2, 3 are mid-Gemini.
3. Student hits "Start Over". reset deletes photos 1 and 2's storage_path entries (photo 1's storage was already deleted by transcribe-photo step 5; photo 2's storage is mid-download). reset deletes the photo rows.
4. Worker for photo 2's `save-transcription` step runs: looks for `photoId` → row deleted → returns false → exit. OK.
5. Worker for photo 3's `download-image` step throws — file gone. Inngest retries (3x). Each retry runs `download-image` → throws. Eventually exhausts. Photo row still gone, so no failure surfaced; just three failed Inngest invocations in the dashboard.
6. Meanwhile the `check-submission-complete` step for photo 1 (which COMPLETED before reset) was already queued. It runs: SELECT submissions.status → reads 'draft' (after reset). Step returns. OK.
7. **BUT** — if photo 1's worker is at step 6 _after_ the read but _before_ the row was reset, the read sees 'processing'. The aggregate `combined` string is computed from the remaining photos (now zero — `photos.length === 0`, early-returns). OK. 
8. The more interesting race: photo 1 is at step 6, sees 'processing'. Reset has NOT happened yet. Photos 2,3 are still 'processing' rows. `allDone` is false. No write. Then reset deletes all photos and flips to draft. Worker for photo 2 (suppose it completes its save-transcription on the now-deleted row before reset deletes the row) → save returns false because photo row is gone (the reset.delete races the save.update). All fine.

Actually the more concerning sequence:
1. Photo 1 completes successfully (step 4: save-transcription writes). photo row status='completed'.
2. Reset runs. Deletes photos (including completed photo 1's row + storage). submission.status='draft'.
3. Photo 1's `check-submission-complete` step runs (it's separate from the photo's own state, just queued for the submission). It reads submissions.status — currently 'draft' after reset. Early-return. OK.

Now suppose the read happens between step 4 and step 6 BEFORE reset:
1. Photo 1's save-transcription completes (4). 
2. Photo 1's check-submission-complete starts reading submissions.status → 'processing'. Reads photos → finds [completed photo 1 row, processing photos 2, 3]. `allDone` false. No write. OK.

OK the timing for "review flip after reset" is narrower than I first thought, but still real if photos 2/3 ALSO complete fast and the reset happens after the 'review' UPDATE is in flight. The UPDATE `SET status='review' WHERE id=$1` has no status fence. If reset already set 'draft', the worker UPDATE overwrites back to 'review' with stale transcription_text.

**Failure scenario B — worker rate-limit denial sets photo 'failed' without a state fence.**
- `transcribe-photo.ts:92-106` — if rate-limit denied, the worker UPDATEs the photo to `status='failed'`. If the user has hit reset in parallel (photo row deleted), the UPDATE is a no-op (no rows matched, no error). OK by accident. But if reset hasn't run yet and the user then resets, photo row is deleted. Then the `check-submission-complete` step doesn't run for that photo — wait, the function returns BEFORE check-submission-complete (line 106). So when the LAST photo fails rate-limit while sibling photos are still processing, the submission stays stuck at `status='processing'` forever — no completion check ever fires. The other in-flight workers will eventually run check-submission-complete and see one 'failed' + others 'completed' → all-done is true → flip to 'review'. OK in the common case. But the boundary cases — last photo to be touched is the rate-limit-denied one and all siblings already-completed early — leaves `status='processing'` permanently.

**Failure scenario C — transcription text written under stale prompt.**
- `transcribe-photo.ts:108-111` calls `transcribeImage(...)`. That function loads the prompt via `loadPrompt(...)` with 10-min in-process TTL. The admin can edit the OCR prompt mid-flight (admin's auto-save commits every 800ms). The new prompt becomes live in the cache after at most 10 minutes; older Inngest workers running on a different Fluid Compute warm container still see the old prompt for up to 10 minutes after edit. No snapshot: if photo 1 used promptv1, photo 2 (started 11 min later, but in the same submission) uses promptv2. The student's transcription text gets concatenated from output of mixed-prompt outputs.

**Root cause for C:** No snapshot semantics (#1). The submission should snapshot the prompt version at submission-creation time and pass `prompt_version` (or full body) into the worker. AID/OE both have this same issue per the audit framing; HAH inherited.

**Suggested fix.**
1. State-fenced UPDATEs in worker:
   ```ts
   .from('submissions').update({...}).eq('id', submissionId).eq('status', 'processing')
   ```
2. Snapshot `prompt_version_id` (or the full body) onto `submissions` at row creation (or on the first photo upload). Pass it into the Inngest event payload so the worker uses the snapshotted prompt even after admin edits.
3. Reset should write a tombstone (e.g. set a `reset_at` timestamp) that the worker checks at each step; if `reset_at > step_start`, abort.
4. Handle the "last photo denied" case: always run `check-submission-complete` (don't early-return on rate-limit denial).

---

### C4 — Inngest worker is NOT idempotent on the `save-transcription` step → retry after a transient Gemini error duplicates work and re-writes transcription text

**Files:**
- `src/lib/inngest/functions/transcribe-photo.ts:7-13` — `retries: 3, concurrency: { limit: 5 }`.
- `src/lib/inngest/functions/transcribe-photo.ts:114-131` — save-transcription step: blindly UPDATEs `raw_transcription` and `status` to `completed` regardless of prior state.
- Lines 71-90 — `check-rate-limit` step. Per the inline comment "once cleared, it's cleared" — but the rate-limit RPC increments the counter on every successful call. If the worker is retried at the `call-gemini` step (Inngest retries from the failed step, not the function start) the rate-limit counter is NOT re-incremented (the previous step's checkpoint is reused). OK in theory.

Inngest's `step.run` semantics:
- A successful step's result is checkpointed; retries skip it.
- A failed step is re-run on retry.
- If `call-gemini` throws (Gemini 503, network blip, timeout): retry repeats just `call-gemini`. Net effect: one rate-limit increment, multiple Gemini calls (good for retries but bills the school for each attempt against Gemini's own meter).

**Failure scenario.**
1. `call-gemini` returns text "Test transcription".
2. `save-transcription` runs, UPDATEs the photo row, returns true. 
3. `delete-storage-file` step throws (Storage hiccup).
4. Inngest retries the function — but actually only re-runs the failed step. Step 5 retries; step 4 (save-transcription) is checkpointed, skipped. OK.

But — if the function as a whole fails (e.g. the function itself returns a non-2xx because the `serve()` wrapper hits an error before step.run can checkpoint), Inngest restarts the run. The worker re-runs every step from scratch. `mark-processing` is now operating on `status='completed'` (was set by save-transcription on the previous attempt). The UPDATE has no fence — it flips the photo back to `status='processing'` with a new `processing_started_at`. Then `check-rate-limit` runs AGAIN → counts a second Gemini call against the teacher's daily cap. Then `call-gemini` runs AGAIN → makes a second Gemini API call (real $$). `save-transcription` overwrites the row with the new transcription (which may differ from the first attempt; Gemini is stochastic). `delete-storage-file` succeeds.

**Specific damages.**
- Gemini billed twice for one photo (worst case: 4x if the function fails between every step three retries).
- Rate-limit counter ticks twice (closer to cap than expected).
- Student's transcript changes between page loads ("I swear it said X before; now it says Y").
- For the `check-submission-complete` step, in the re-run case, sibling photo states may have changed since the first attempt — could prematurely flip the submission to 'review' before all siblings done.

**Suggested fix.**
1. Make `mark-processing` idempotent + guarded:
   ```ts
   .from('submission_photos').update({status: 'processing', processing_started_at: now()})
     .eq('id', photoId).in('status', ['pending', 'failed']);   // not 'completed'
   ```
   Then if it's already 'completed', skip remaining steps and return success.
2. Make `save-transcription` write conditionally:
   ```ts
   .from('submission_photos').update({...}).eq('id', photoId).eq('status', 'processing');
   ```
   If 0 rows matched, the row is in some other state (failed, completed, deleted) → no-op.
3. Make `call-gemini` cache: keyed off `(photoId, prompt_version)`. Store the result in a sidecar table on first success, return cached on retry.

---

### C5 — Photo upload endpoint races itself: multiple concurrent uploads to the same submission collide on `(submission_id, page_number)` UNIQUE constraint

**Files:**
- `src/app/api/submissions/[id]/photos/route.ts:9-125` — entire route.
- `src/app/api/submissions/[id]/photos/route.ts:59-66` — reads `MAX(page_number)` then computes `pageNumber = max + 1`.
- `src/app/api/submissions/[id]/photos/route.ts:68-104` — loops files, incrementing `pageNumber` locally; INSERTs each row.
- `supabase/migrations/017_unique_submission_page_number.sql:11-13` — UNIQUE (submission_id, page_number) constraint that exists explicitly because of past collisions.

**Root cause:** No idempotency / no atomic page allocation (#5). The migration comment says "caused by retried upload requests" — proving this was a known problem.

**Failure scenario A — double-click on Upload.** Student is on a slow connection. Clicks "Upload 3 pages". Button greys, request A starts uploading. Network stalls. They click again — wait, actually no, `handleUpload` in photo-dropzone is gated by `disabled={disabled}` which is controlled by `uploading` state in the parent page. Good. But if they hit "Take Photo" and re-add files mid-upload, both Upload buttons can fire (PhotoDropzone has its own ungated Upload button + the camera input fires onChange independently). And the upload button at line 195 is `disabled={disabled}` — meaning when `uploading=true` from the parent. So the same-component double-click is gated. But:

**Failure scenario B — open the page in two tabs.** Two tabs → two PhotoDropzone instances → two parents. Each computes its own `max(page_number)+1` snapshot. Tab A reads `max=0`, prepares pages [1,2,3]. Tab B reads `max=0` (A hasn't inserted yet), prepares pages [1,2,3]. Tab A starts inserting page 1 — OK. Tab B inserts page 1 — UNIQUE collision → error → INSERT throws. Caller catches as "Failed to upload photos" → student sees error → tab B has uploaded photo to Storage already (the upload happened BEFORE the INSERT). Storage file is orphan. Cleanup at lines 36-56 only catches stale `pending/processing` rows; this storage file has no DB row.

**Failure scenario C — quick add + upload + add + upload sequence.** Student uploads 2 pages → workers start. Student then uploads 2 more pages (the page is still on review state, but they reopen). The "stale cleanup" at line 37-56 deletes `pending|processing` photos from the FIRST batch (whose workers are still mid-transcription). The transcribe-photo worker's `save-transcription` step then can't find the row → returns false silently. Net result: **the first batch of photos is invisibly dropped** because the second upload "cleaned up" their in-flight rows. The user sees the page count jump from "page 1, 2" to "page 1, 2" (new batch) and assumes everything worked. Their first two pages of writing are gone.

**Failure scenario D — orphan storage files on UNIQUE collision.** When the INSERT at line 90 fails because of a unique violation, the Storage upload at line 75 has already succeeded with `upsert: true`. The storage file persists with no DB row. The weekly cleanup cron (`cleanup-photos.ts`) only finds photos with NON-NULL `storage_path` and `status` IN (`confirmed`, `submitted`). Files without a row don't qualify and never get cleaned up. Storage bloat.

**Root cause for D:** No transactional boundary (#3) — Storage upload and DB INSERT aren't transactional.

**Suggested fix.**
1. Compute page number atomically inside the INSERT (e.g. `INSERT ... SELECT COALESCE(MAX(page_number),0)+1 FROM submission_photos WHERE submission_id=$1`). Or use a per-submission sequence.
2. Stale-cleanup at lines 37-56 should NOT delete photos with `status='processing'` — those are actively being transcribed. Only delete `pending` photos older than e.g. 60 seconds (`created_at < now() - interval '60s'`).
3. INSERT before Storage upload, not after. If the insert fails, never upload to Storage. If the upload fails, DELETE the row.
4. Add a storage-orphan sweeper to `cleanup-photos.ts` — list bucket files, cross-check against DB, delete orphans.

---

## HIGH

### H1 — Rate-limiter is fail-open + per-teacher, not per-student → one student can exhaust an entire class's daily Gemini cap

**Files:**
- `src/lib/gemini/rate-limit.ts:28-46` — explicit fail-open semantics in code comment + behavior.
- `src/lib/inngest/functions/transcribe-photo.ts:71-90` — rate-limit denial silently sets one photo to `failed` and exits. No user-visible signal except the per-photo "(failed)" badge.
- `supabase/migrations/022_gemini_rate_limit.sql:39-90` — counter is per (teacher_id, date). FALLBACK_CAP=1000.

**Root cause:** Fail-open (#4) + scope-too-broad design.

**Failure scenarios.**
1. Adversarial student uploads 1001 photos against a single low-effort assignment (no per-submission page cap). Teacher's cap is hit. EVERY OTHER STUDENT in that class who tries to upload that day fails with no clear message.
2. DB hiccup (Supabase rolling restart, network blip on the Postgres pooler): `checkAndIncrementGeminiCall` swallows the error and returns true. Every photo passes; the school could burn through hundreds of dollars of Gemini billing in a single brief window before anyone notices.
3. The user-facing UI shows "(failed)" next to a per-page row at `submissions/[submissionId]/page.tsx:605-607`, but the page-level loop at line 171-188 of transcribe-photo combines `transcription_text` from `status='completed'` rows ONLY. The student sees a partial transcript with no obvious explanation of why pages are missing. They have no path to retry.

**Suggested fix.**
1. Surface a structured error from the worker → write to `submission_photos.error_message` when rate-limit-denied (the column exists per migration 007). Render the error in the per-page UI block.
2. Auto-retry rate-limit denial with backoff (the cap resets at midnight UTC) — or auto-fail the whole submission with a "Try again tomorrow" message.
3. Add per-student daily cap (e.g. 30 pages/day) layered on top of per-teacher.
4. Consider fail-closed on rate-limit DB error for very high call counts — the comment says "We'd rather over-serve than block", but over-serving is exactly the budget-leak surface.

---

### H2 — Confirm route's success update isn't fenced → race between Drive doc creation and Canvas submit causes inconsistent terminal state

**Files:**
- `src/app/api/submissions/[id]/confirm/route.ts:148-164` — first UPDATE: status='confirmed'.
- `src/app/api/submissions/[id]/confirm/route.ts:195-202` — second UPDATE: writes gdoc_id/gdoc_url.
- `src/app/api/submissions/[id]/confirm/route.ts:283-294` — third UPDATE: status='submitted', canvas_submission_url, etc.

**Failure scenario.** Confirm starts, sets status='confirmed'. Drive doc creation throws (Google quota / network). gdoc_url stays null. Canvas submission succeeds — status flips to 'submitted'. Now the row has `status='submitted'` + `gdoc_url=null`. The Pizza Tracker on the student page (line 107-115) shows "Google Doc" step as `active` instead of `completed` while "Canvas" shows `completed`. UI confusion. Also: super-grader's envelope includes `gdoc_url=null` even though the submission is otherwise complete; super-grader's card surface degrades.

Worse: if Drive succeeds but Canvas fails, status stays at 'confirmed' (the third UPDATE never runs). The student sees Success state with a Drive link but no Canvas link. They re-try → confirm is non-idempotent (per C2) → second Drive doc + second Canvas attempt.

**Suggested fix.**
1. Write all of (gdoc_url, canvas_submission_url, status) in ONE UPDATE at the end of the flow. Skip the intermediate `status='confirmed'` write — set status='submitted' only on full success; on partial-success use a 'partial' state or per-channel boolean flags.
2. Make Drive doc creation + Canvas POST + super-grader push idempotent: if `gdoc_url` is already set, skip the Drive call; if `canvas_submission_url` is set, skip the Canvas call.

---

### H3 — Confirm route reads teacher's Canvas token via admin client with no scope check beyond submission ownership

**Files:**
- `src/app/api/submissions/[id]/confirm/route.ts:58-95` — admin client selects teachers.canvas_api_token via a deeply-joined SELECT.
- Lines 97-107 — verifies `student.auth_user_id === user.id`. That's the only scope check.

**Threat model.** Any signed-in user (must be authed but ANY auth — could be any student, could be a teacher with a stale account, could be an admin) can hit `/api/submissions/<some-uuid>/confirm` for ANY submission ID. The ownership check happens only after the row is read. The token is in memory regardless.

This is mostly OK — the route doesn't return the token in the response. But the surface is wider than needed:
- `admin` client reads `teachers.canvas_api_token` (encrypted? Let me check — `teachers.canvas_api_token` appears to be stored plaintext based on the read shape; no decrypt step).
- If a future bug logs the `assignment` object or `submission` object, the token leaks to logs.
- If a future maintainer adds `canvas_api_token` to the JSON response by accident, every authenticated student can read every teacher's token.

**Suggested fix.**
1. Verify ownership BEFORE reading the teacher's token. Two queries: first `SELECT id FROM submissions JOIN students ... WHERE submissions.id=$1 AND students.auth_user_id=$user.id`. If 0 rows → 403. Then a second query for the assignment + teacher details.
2. Audit `teachers.canvas_api_token` storage — encrypted at rest? If not, that's its own H finding. (Out of scope here; flag for separate review.)
3. Never log the raw `submission` or `assignment` object in error paths; log fields explicitly.

---

### H4 — `pushToSuperGrader` is awaited inside the confirm route → adds 5s timeout to student-facing latency

**Files:**
- `src/app/api/submissions/[id]/confirm/route.ts:331-340` — `await pushToSuperGrader(...)`.
- `src/lib/peers/notify.ts:4` — `TIMEOUT_MS = 5_000`.

**Root cause:** Comment on confirm route line 331 says "Fire-and-forget push to super-grader. Awaited so failures land in logs, but errors are swallowed inside pushToSuperGrader — never blocks the student-visible response." But `await` IS blocking the response — the comment contradicts itself. If super-grader is slow/down, every student confirmation slows by up to 5s.

This isn't a fire-and-forget; it's a synchronous blocking call that doesn't crash.

**Suggested fix.**
1. Move the push into an Inngest event (`submission.confirmed` → handler that fires the webhook). That gets you proper retries on transient failures too, currently completely missing — one 5xx from super-grader and the envelope is lost forever.
2. Or wrap in `void Promise.race([push, timeout])` with NO await — fire it and return.

---

### H5 — `pushToSuperGrader` re-builds the envelope from scratch by canvas_user_id + canvas_assignment_id, not by submission_id → wrong-submission push on race

**Files:**
- `src/lib/peers/envelope.ts:34-137` — picks "the latest confirmed submission for this (student, assignment)".
- `src/app/api/submissions/[id]/confirm/route.ts:335-340` — calls `pushToSuperGrader(canvas_user_id, canvas_assignment_id)` (no submission id passed).

**Failure scenario.** Student resubmits assignment X. Old submission has status='submitted'. New submission is being confirmed. The new confirm call fires `pushToSuperGrader(...)`. Inside, `buildEnvelopeForCanvasIds` SELECTs `submissions WHERE student=$1 AND status IN ('confirmed','submitted') ORDER BY confirmed_at DESC LIMIT 50` and `.find()` the one with matching assignment id. If the new submission's `confirmed_at` hasn't propagated to the SELECT yet (the UPDATE at confirm.ts:148-157 and the envelope SELECT race in different DB queries / connections), the envelope pushed to super-grader could be the OLD submission's content.

Less critical because subsequent pushes converge, but for a single moment the SG dashboard shows stale data.

Worse: the .find() picks by `canvas_assignment_id` equality, but if the teacher has the same Canvas assignment synced under two courses (the envelope comment acknowledges this), the envelope picks one student-course mapping arbitrarily.

**Suggested fix.** Pass `submission_id` directly into the envelope builder — it has the full set of fields needed without a lookup race.

---

### H6 — Storage RLS has no DELETE or UPDATE policy → students can never directly delete their own storage objects via the client; admin client always required

**Files:**
- `supabase/migrations/008_create_storage_bucket.sql:9-24` — only INSERT and SELECT policies for users.
- `src/app/api/submissions/[id]/photos/route.ts:43-50` — calls `supabase.storage.from(...).remove(...)` using the USER client (not admin). This delete will silently fail under RLS.
- `src/app/api/submissions/[id]/reset/route.ts:73-93` — uses ADMIN client for storage delete. Correct.

**Failure scenario.** The photos route at line 49 uses the user-scoped `supabase` client to delete stale photos. With no DELETE RLS policy on `storage.objects`, this returns "0 deleted" silently — no error thrown. The user-side storage objects are NEVER cleaned up from this path. (The DB rows ARE cleaned up at line 52-56 because submission_photos has full RLS write policies for owners — line 142-154 of migration 016.)

Net result: every "re-upload before old upload completes" leaves orphan storage files. Combined with C5 scenario D, this means the bucket grows unbounded.

The fact that `upsert: true` is used at line 77 partially masks this — the same `pageNumber.ext` path gets overwritten. But if the next batch uses different file extensions (HEIC then JPG), the old HEIC file persists alongside the new JPG.

**Suggested fix.**
1. Add `CREATE POLICY "Users can delete own photos" ON storage.objects FOR DELETE USING (bucket_id='submission-photos' AND (storage.foldername(name))[1] = auth.uid()::text);` to a new migration.
2. Add the equivalent UPDATE policy if upserts ever need to fall through to overwrite (Storage upsert with same path = UPDATE).
3. Alternatively, switch the photos route's storage delete to use the admin client (cleaner; matches the reset route's pattern).
4. Either way, add log/error handling so a silent "0 deleted" surfaces.

---

### H7 — Inngest `cleanup-photos.ts` only sweeps confirmed/submitted older than 1 week → photos from draft/processing/review submissions live forever in Storage

**Files:**
- `src/lib/inngest/functions/cleanup-photos.ts:14-29` — `.in("submissions.status", ["confirmed", "submitted"])`.

**Failure scenario.** Student starts a submission, uploads 5 photos, then never confirms. submission stays at status='processing' (because workers completed `review` flip is gated; many ways to land at non-confirmed). Photos sit in Storage indefinitely. Multiply by every student who explored the app, dropped out, or hit an error mid-flow.

This is a slow leak rather than a critical bug, but is amplified by C5/H6.

**Suggested fix.**
1. Expand the sweep filter: photos older than 1 week AND submission status IN ('draft', 'processing', 'review', 'confirmed', 'submitted'). For draft/processing/review, also archive the submission row.
2. Add a separate sweep for storage-orphan files (files in the bucket with no matching DB row).
3. Make the cleanup cron's stale-detection conservative (e.g. >7d AND last `updated_at` >7d ago) so it doesn't kill an actively-working student.

---

### H8 — Inngest stale-registration risk after Vercel rename is not actively defended

**Files:**
- `src/app/api/inngest/route.ts:1-9` — vanilla `serve()` wrapper. No post-deploy hook or healthcheck.
- CLAUDE.md memory note: "Inngest webhook URL goes stale on Vercel rename — silently."

**Failure scenario.** Per the documented gotcha: after a Vercel rename, Inngest cloud keeps POSTing to the OLD URL. `inngest.send()` returns 200 (event reached Inngest cloud). Function never fires. Submissions sit at `status='processing'` forever; no errors anywhere.

This is operational, not code, but worth flagging because nothing in the codebase forces a registration refresh on deploy.

**Suggested fix.**
1. Add a `postdeploy` hook in `vercel.json` (or via a Vercel deploy hook) that PUTs `https://<host>/api/inngest`.
2. Or: add a healthcheck route that exercises a no-op Inngest function and alerts on failure.
3. Or at minimum: a small admin button on `/admin` that PUTs `/api/inngest` so a human can refresh registration with one click after every rename.

---

## MEDIUM

### M1 — Submission row INSERT is non-idempotent at the API level — exists check + insert is a TOCTOU window

**Files:**
- `src/app/api/submissions/route.ts:36-67` — `SELECT then INSERT` flow without `ON CONFLICT`.
- `supabase/migrations/006_create_submissions.sql:17` — `UNIQUE (assignment_id, student_id)` exists, so concurrent inserts will fail on the second one with a unique-violation. Client gets a generic 500.

**Failure scenario.** Student double-taps "Upload" on a slow connection. Two `POST /api/submissions` fire. Both SELECTs return null. Both INSERTs race. One succeeds, one fails with 23505 (unique violation). The losing tab gets 500 "Failed to create submission" — but the row WAS created (by the winner). Student sees an error message, refreshes, and now things work. Confusion.

**Suggested fix.** Use `.upsert(..., { onConflict: 'assignment_id,student_id', ignoreDuplicates: true })` and re-SELECT; or catch error code 23505 and return the existing row.

---

### M2 — Realtime + polling loadData race re-fetches and clobbers in-progress edits to `editedText`

**Files:**
- `src/app/student/submissions/[submissionId]/page.tsx:299-409` — Realtime subscription + polling + loadData all run concurrently.
- Lines 340-342 — `if (s.transcription_text && !editedTextRef.current) { setEditedText(s.transcription_text); }`.

**Subtlety.** loadData uses `editedTextRef.current` to GATE the auto-fill: don't overwrite if user has typed. Good. But: if the worker writes a new `transcription_text` to the row mid-review (e.g. a retry runs and changes the OCR output), and the student has typed nothing yet, the textarea re-fills with the new text. If the student HAS typed and a Realtime update lands, the textarea STAYS — but the visible "Confirm" button is enabled and the editedText state is now divergent from the row's `transcription_text`. The student may not realize the AI re-transcribed and they're editing the wrong base.

Less critical than the others but UX-confusing.

**Suggested fix.** Once transcription is first surfaced to the student, freeze the row's `transcription_text` so retries don't change what they're editing. (i.e. the worker should write to `proposed_transcription_text` and only the student's Confirm copies it to `transcription_text`.)

---

### M3 — Prompt cache TTL across multiple Vercel Fluid Compute workers causes inconsistent prompt versions for siblings of the same submission

**Files:**
- `src/lib/prompts/load.ts:11-49` — per-process Map cache.
- Comment on invalidatePromptCache line 50-56 acknowledges the limitation.

**Failure scenario.** Two photos from the same submission land on different Vercel workers. Worker A's cache has prompt v3 from 2 minutes ago. Worker B's cache expired and re-fetches prompt v4 (admin edited 30 seconds ago). Both photos transcribed against different prompts. Concatenated transcript is partially v3-style, partially v4-style. The student notices line-break behavior differences mid-document.

Same root cause as C3 (no snapshot semantics #1). Suggest the same fix: snapshot the prompt at submission-creation time, pass into the Inngest event payload.

---

### M4 — Reset route doesn't check teacher-scope guardrails — a student can reset a "submitted" submission and start fresh, which is the design intent, but does NOT delete the prior Google Doc or the prior Canvas submission

**Files:**
- `src/app/api/submissions/[id]/reset/route.ts:53-71,95-117` — resubmit mode clears `gdoc_id`/`gdoc_url`/`canvas_submission_id`/`canvas_submission_url` from the DB but never asks Google to trash the prior Doc or asks Canvas to delete/replace the prior submission.

**Failure scenario.** Student submits assignment, then resubmits. Old Drive Doc is now orphaned in the student's Drive (the DB no longer points at it, but the Doc file exists shared with the teacher). The teacher's per-course-folder accumulates 1 Doc per resubmission attempt with no breadcrumb. Worse: super-grader's envelope `links.detail_url` doesn't point to the new Doc URL because the envelope is built from the submission row (which now has a new gdoc_url), but the OLD Canvas submission body in Canvas still has the OLD sentinel marker pointing at the OLD submission_id. If super-grader scrapes Canvas before the new push lands, it sees the old version.

This is design intent ("Your previous submission will remain unchanged") per the resubmit UI banner — but the messaging hides the cleanup cost.

**Suggested fix.**
1. On resubmit: move the old Doc to a "Previous attempts" subfolder in the same course folder, OR trash it (with student opt-in).
2. On resubmit + Canvas submission: include `<!-- handwritten:resubmission previous=<old-submission-id> -->` in the new body so super-grader's scrape can dedupe.

---

### M5 — `submissions.attempt_number` is monotonic per resubmit but doesn't survive a hard reset (mode='reset')

**Files:**
- `src/app/api/submissions/[id]/reset/route.ts:96-111` — `mode='reset'` resets fields but does NOT bump `attempt_number`. Comment in code semantics: a `reset` is "scrap this attempt and re-do photos", whereas `resubmit` is "I submitted, but I want to do a whole new attempt".
- `src/app/api/submissions/[id]/confirm/route.ts:182-184` — `attemptSuffix` for the Google Doc title uses `attempt_number > 1` to add "(Resubmission N)".

**Subtle bug.** If a student in flow:
1. Uploads → reaches 'review' → confirms → status='submitted', attempt_number=1.
2. Resubmits → attempt_number=2, status='draft'.
3. Uploads → reaches 'review'. Realizes they want to do it again from scratch. Hits "Start Over" (mode='reset'). This DOESN'T bump attempt_number — stays at 2.
4. Confirms. Drive doc title says "(Resubmission 2)" which is correct.

That part is fine. But:
- The previous attempt's gdoc_id/gdoc_url is null after step 2's resubmit. So step 4's confirm creates a brand-new doc. OK.
- If they keep resetting (mode='reset') multiple times without confirming, attempt_number stays at 2 but each iteration creates a new submission body. Fine in DB terms, just slightly misleading for the doc title.

Actually the deeper issue: a student who skips the resubmit path and just hits reset endlessly while in 'review' state never increments attempt_number. The teacher's view at the end shows "Resubmission 2" when the student has actually attempted six different transcriptions. Audit trail mismatch.

**Suggested fix.** Either bump attempt_number on every reset (and rename the title suffix to "Attempt N"), or keep separate `reset_count` and `resubmit_count` for clarity.

---

### M6 — `submissions` does NOT carry a snapshot of the teacher's Canvas token / Canvas base URL / course id — all read live at confirm time

**Files:**
- `src/app/api/submissions/[id]/confirm/route.ts:61-88` — joins through `submission → assignment → course → teacher` to read `canvas_api_token` and `canvas_base_url`.

**Failure scenario.** Teacher rotates their Canvas token (Canvas dashboard → revoke + regenerate). They paste the new token into the teacher app. ALL in-flight submissions now read the new token at confirm. Mostly fine.

But: if the teacher's token is revoked BEFORE they paste a replacement (token-rotation period), every student's confirm fails with Canvas 401. The "Canvas not configured" warning at confirm.ts:232-234 doesn't trigger (the token isn't null, just invalid). They get a generic Canvas-submission-failed warning. No path to graceful retry.

Worse: if a teacher deletes their account or the school dissolves the course, mid-flight student confirms hit "course/teacher not found" and the submission is dead in the water.

**Suggested fix.**
1. Snapshot `canvas_base_url`, `canvas_course_id`, and `canvas_assignment_id` onto `submissions` at creation. The teacher's token has to stay dynamic (you can't snapshot a credential), but the assignment-level identifiers don't change.
2. On Canvas 401: prompt the teacher (via admin notification, not the student) to re-link Canvas. Don't blame the student.

---

### M7 — `submission_photos` row insertion has no per-row attempt counter → can't distinguish first-attempt failures from retry-storm failures

**Files:**
- `supabase/migrations/007_create_submission_photos.sql` — no `attempt_count`/`retry_count`.
- `src/lib/inngest/functions/transcribe-photo.ts:36, 121, 133` — failure return paths just say `reason: "photo deleted"` and don't write to the photo row.

Symptom: when the Inngest dashboard shows 20 failed runs for transcribe-photo, you can't tell from the DB whether that's 20 distinct photos that each failed once, or 5 photos that each failed 4 times. The cleanup cron and the metric surfaces can't differentiate.

**Suggested fix.** Add `attempts` int column on `submission_photos`. Bump it in `mark-processing` step. Surface it in the admin/retention view.

---

## LOW

### L1 — `submit_to_canvas` boolean on `submissions` is written by confirm but only ever read inside the confirm route itself

**Files:**
- `supabase/migrations/014_add_canvas_submission_fields.sql:12` — adds the field.
- `src/app/api/submissions/[id]/confirm/route.ts:152` — sets it from request body.
- No other read paths in the codebase reference it.

It's effectively a vestigial audit field. Not a bug; document and use it for the super-grader envelope, or drop the column.

---

### L2 — `card_text_defaults` singleton can be deleted (no protection beyond `is_admin()`)

**Files:**
- `supabase/migrations/20260520120000_card_text_customization.sql:14-22,46-52` — `id = 1` CHECK constraint exists, INSERT seeds the row, but the `is_admin()`-gated DELETE policy isn't restricted by `id`.

If an admin DELETEs the row, the install path's effective-card-text resolution falls back to packages' literals. The CTA may revert to whatever's hardcoded; not catastrophic. Add a CHECK NOT DELETE trigger or `WHERE id <> 1` constraint on the DELETE policy.

---

### L3 — `submission_photos.status='failed'` rows aren't surfaced for re-try in the student UI

**Files:**
- `src/app/student/submissions/[submissionId]/page.tsx:601-608` — renders "(failed)" next to the page row.

There's no "Retry this page" affordance. The student's only path is the "Start Over" button which clears EVERYTHING. If a single page fails (Gemini rate-limited or downstream error), they lose all the completed-page transcriptions. UX paper cut, but bad enough on a 10-page submission.

---

### L4 — The page-numbering loop in photos route uses `lastModified` ordering, which Safari/iOS can lie about

**Files:**
- `src/components/upload/photo-dropzone.tsx:48-49` — sorts previews by `file.lastModified` after addFiles.

iOS/iPadOS often returns `lastModified=Date.now()` (now) for camera captures or Photos picks, so the sort is no-op. The drag-to-reorder is the actual ordering UI. Note for future debugging.

---

## Cross-cutting observations

### CC1 — Five suite-wide root causes mirror OE/AID

All five recur here:
1. **No snapshot semantics** — prompt body, destination picker, Canvas token, course/assignment metadata all read live at runtime.
2. **No state fences** — zero `.eq("status", expected)` guards anywhere in the submission state machine.
3. **No transactional boundaries** — DB + Drive + Canvas + super-grader are four independent writes with partial-failure paths.
4. **Fail-open** — rate-limit fail-open, prompt-load fail-open with hardcoded default, super-grader-scope fail-open.
5. **No retry/idempotency** — every user-visible mutation can be replayed (confirm, photo upload, submission create).

### CC2 — Recommended remediation campaign sequence

Mirror the OE M6.19 Phase ordering:
- **Phase 0 (fail-closed scrub):** Wire the destination picker into confirm (C1). Add the "currently NOT implemented" tooltip to `post_to_canvas_comment` so the picker isn't a UI lie.
- **Phase 1 (snapshots + atomic start):** Snapshot prompt version + Canvas identifiers onto `submissions` at creation. Atomic page-number allocation (C5).
- **Phase 2 (state fences + idempotent confirm):** State-fenced UPDATEs throughout the worker. Idempotent confirm (C2). Storage RLS DELETE policy (H6).
- **Phase 3 (stale-session sweep):** Expand cleanup cron (H7). Storage-orphan sweep. Inngest registration self-check (H8).

### CC3 — Files NOT audited that the next pass should touch

- `src/lib/anonymizer/roster.ts` — touched at envelope build; PII surface.
- `src/app/teacher/dashboard/CourseAccordion.tsx` — destination picker write path (saw via grep, didn't read in full).
- `src/lib/canvas/install.ts` — install/uninstall path; relevant to the destination-picker UI lie.
- The retention export + delete routes (`/api/admin/retention/*`) — touch the same `submission_photos` + storage objects and may have orthogonal cleanup gaps.
