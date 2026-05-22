# Handwritten Assignment Helper — Remediation Plan

Strategic plan to address the structural bugs surfaced by the 2026-05-21 multi-agent code review. Audits covered six themes in parallel:

1. Submission state machine + transcription pipeline + RLS + confirm → `audits/audit-submission-state.md`
2. PII scrubbing + Gemini OCR boundary + roster → `audits/audit-pii-scrub.md`
3. Canvas integration (install + auto-submit + roster + tokens) → `audits/audit-canvas.md`
4. Auto-save + server-action error handling → `audits/audit-auto-save.md`
5. Cross-system seams (webhook, ingress, Inngest, Drive/Docs, retention, crypto) → `audits/audit-seams.md`
6. Auth + RLS + storage + token security → `audits/audit-auth-rls.md`

**HAH has substantially more severe findings than OE or AID.** Both prior reviews surfaced ~5 critical bugs each, all of which were *latent* (race conditions, fail-open patterns that hadn't fired yet). The HAH review surfaces **8 critical bugs that are actively leaking in production today**, plus the same ~30 high/medium structural issues. The actively-leaking criticals dictate a tighter Phase 0 here than in the OE/AID campaigns.

## Headline criticals (actively leaking)

1. **OCR worker never invokes the scrubber.** `transcribe-photo.ts` writes raw Gemini output straight into `submission_photos.raw_transcription`. Students write their own name + classmates' names at the top of handwritten work; Gemini OCRs them; they land raw in DB and the super-grader webhook envelope. The scrub helper exists, but the only call site is in `peers/envelope.ts` — and it reads the *already-raw* column. **Every confirmed submission in production today has un-scrubbed PII at rest.**
2. **`/api/test-transcribe` is a public, unauthenticated Gemini-spend endpoint.** Allow-listed in `proxy.ts` (`/api/test-` prefix), no auth guard, accepts any image, calls Gemini OCR, returns the result. Anyone with the deploy URL can drive unlimited parallel Gemini calls billed to the project, and PII-egress to Google for any image they paste in.
3. **Per-course re-sync repoisons the roster every dashboard load.** `/api/courses/[id]/sync` still uses `cs.email ?? cs.login_id ?? null` — the 2026-05-20 fix (commit `9b3763e`) only patched the bulk setup-wizard sync, not the per-course re-sync. `BackgroundSync` calls this route on every dashboard load. Students whose Canvas email is hidden get their `login_id` stored as a fake email → they hit "We can't find you on the roster" at sign-in.
4. **Any signed-in EHS Google user can self-promote to teacher.** `/api/teacher/setup/canvas` writes to `teachers` for any authenticated user; migration 010 `WITH CHECK (auth_user_id = auth.uid())` lets it through; no domain/invite gate. (AID has the same shape; HAH is worse because the legacy `/setup` page is not under `/teacher/*` so the proxy doesn't gate it.)
5. **Teacher-INSERT policy on `students` is `WITH CHECK (true)`.** Chained with #4: attacker promotes to teacher → INSERTs a `students` row for `victim@episcopalhighschool.org` with NULL `auth_user_id` → enrolls it in attacker's course → victim's first sign-in rebinds via the auth callback's by-email path → attacker reads victim's Google access/refresh tokens and transcripts.
6. **Plaintext Google OAuth tokens.** `students.google_access_token`/`refresh_token` (migration 003) are in plaintext on a table whose teacher SELECT policy returns the whole row. Any teacher (or self-promoted "teacher" from #4) can impersonate any of their enrolled students against Drive/Docs, persistently, via the refresh token. A service-role exposure or backup leak = months of Drive access per student.
7. **PostgREST `or()` filter injection via `user.email`.** `student/courses/[courseId]/assignments/[assignmentId]/layout.tsx` interpolates `user.email` directly into a `.or(...)` filter. A comma inside a quoted local-part splices extra OR predicates → match-any-student → wrong-enrollment passes the gate. EHS Google accounts don't normally allow `,` in local-part, but the injection sink is unfixed if a quirky address ever lands.
8. **Destination picker is dead-wired.** The 3-checkbox UI (Drive + Canvas comment + Canvas submission) was added in M6.18b, but `confirm/route.ts` reads only the legacy `submitToCanvas` boolean and Drive is unconditional. Teachers tick the comment box, see the green badge, no comment posts. Teachers untick Drive, get Drive anyway.

The audits also identified the same five recurring root causes as the OE + AID reviews. Almost every individual bug maps to one of them. Patching point-by-point would leave the patterns intact; the same shape of bug would re-appear in the next feature. This plan groups fixes by structural theme so each phase eliminates a *class* of bugs.

## Status (as of 2026-05-21)

Active-bleed phases 0 / 0b / 0c shipped 2026-05-21. The structural critical path is **1 → 2 → 3**, mirroring OE M6.19 and AID M6.20.

| Phase | State | Commit |
|---|---|---|
| 0 — Stop the active bleeds (PII + open endpoint) | Done | HAH `02f41c9` |
| 0b — Auth boundary criticals (teacher allowlist + students INSERT policy + filter injection + timingSafeEqual + open-redirect) | Done | HAH `e653daa` + migration `025` |
| 0c — Encrypt Google OAuth tokens at rest | Done | HAH `9a267bd` + migration `026` |
| 1 — Snapshot semantics on submission start | Pending | — |
| 2 — State fences + idempotent confirm / Inngest / photo upload | Pending | — |
| 3 — Stale-session sweep + retention cron | Pending | — |
| 4 — Auto-save normalization (close CLAUDE.md regressions) | Pending | — |
| 5 — Canvas client robustness + destination picker wiring | Pending | — |
| 6 — Roster sync correctness | Pending | — |
| 7 — Polish + small risks | Pending | — |
| 8 — Infrastructure hardening | Pending | — |
| 9 — Verification + observability | Pending | — |

Phases 0 / 0b / 0c are tightly scoped urgent fixes for the actively-leaking bugs. Each should ship same-day. Phases 1–3 mirror the OE + AID critical paths.

## Recurring root causes (same as OE M6.19 + AID M6.20)

1. **No snapshot semantics.** `submissions` and `submission_photos` hold live FK references to `prompts.body` (OCR system prompt), `teacher_assignments.post_to_*`, `card_text`, `course_rosters`. Mid-flight admin prompt edits change which prompt the worker uses; mid-flight teacher destination flips change where the deliverable lands. The Inngest worker's 10-min in-process prompt cache makes this WORSE — two photos in the same submission can be transcribed against different prompt versions.
2. **No state fences on UPDATEs.** `confirm/route.ts` does three sequential UPDATEs (`confirmed` → gdoc fields → `submitted`) with no `.eq("status", expected)` guard. Inngest's `transcribe-photo` writes to `submission_photos` without state guards; an Inngest function-level retry can flip a `completed` photo back to `processing`, increment the rate-limit counter a second time, and overwrite the transcript with a different (stochastic) Gemini result. `mark-processing`, `save-transcription`, and the orphan-cleanup at `photos/route.ts:37` all lack fences.
3. **No transactional boundaries across subsystems.** `confirm` = DB UPDATE + Drive doc create + Canvas write + super-grader webhook. Each step writes to a different system; partial failure leaves divergent state. Inngest steps are individually idempotent under retry but the worker as a whole isn't (full-function re-runs re-do everything).
4. **Fail-open instead of fail-closed.** Empty `course_rosters` row → scrub returns a no-op cached for 5 minutes; missing `SUPER_GRADER_SALT` → same. DB error on roster lookup → fall-through to empty roster (no distinction between "no students" and "DB error"). `/api/test-transcribe` open to the public. `INITIAL_ADMIN_EMAIL` self-bootstrap path admits a wider class of accounts than the operator likely intends.
5. **No retry / idempotency semantics.** Confirm double-fire = duplicate Drive doc + duplicate Canvas comment + duplicate SG webhook. Photo upload page-number race triggers a 23505 with an orphan Storage blob nothing cleans up. Inngest full-function re-run double-bills Gemini.

## Strategic shape

| Theme | Phase | Root cause it kills | Bug count addressed |
|---|---|---|---|
| Stop the PII bleed | **0** | Fail-open scrub + open Gemini endpoint | 3 critical |
| Auth criticals | **0b** | Fail-open auth + injection | 5 critical/high |
| Encrypted tokens at rest | **0c** | Plaintext secrets | 1 critical |
| Snapshot semantics | **1** | FK-not-snapshot drift | ~5 high |
| State fences + idempotency | **2** | UPDATEs without guards | ~8 critical/high |
| Stale-session sweep + retention cron | **3** | No server-side cutoff | 2 high + paper cuts |
| Auto-save normalization | **4** | Concurrent-save scramble + regressions | ~5 high |
| Canvas client robustness | **5** | Destination picker dead-wired + 429/5xx | ~6 critical/high |
| Roster sync correctness | **6** | Per-course re-sync repoison | ~3 high |
| Polish + small risks | **7** | Misc | ~10 medium/low |
| Infrastructure hardening | **8** | Inngest re-sync + Sentry scrubber | ~3 medium |
| Verification + observability | **9** | Future regression | enabling |

**Sequencing principle:** Active bleeds first (0 + 0b + 0c, same-day). Then schema enablers (Phase 1 snapshots) so other phases have the data they need. Then code that depends on schema (2 → 3). Then parallel cleanup tracks (4, 5, 6 are independent; 7, 8, 9 follow).

Recommended order if linear: **0 → 0b → 0c → 1 → 2 → 3 → 4 → 6 → 5 → 7 → 8 → 9**. Phase 6 ahead of 5 because the per-course re-sync repoisoning bug fires on every dashboard load — higher priority than the canvas-write cleanup.

---

## Phase 0 — Stop the PII bleed

**Audit refs:** `audit-pii-scrub.md` CRIT-1, CRIT-2, CRIT-3, HIGH-1; `audit-seams.md` P0.

### Deliverables

1. **Wire `scrubText` into `transcribe-photo`** at the post-OCR write point. Compile the roster once (same Phase 0 fail-closed posture as OE/AID — throw `RosterMissingError` if missing) and scrub `result.text` BEFORE writing to `submission_photos.raw_transcription`. The transcript that lands in DB is scrubbed; the transcript Canvas sees later is de-anonymized via roster-deanonymize (similar to AID's eventual deAnonymize wiring).
2. **Make `compiledRosterForCourse` (HAH-equivalent) fail-closed.** Drop the silent `try/catch` around `readSaltFromEnv()` in `anonymizer/roster.ts`; distinguish "no rows" from "DB error"; do not cache empty results. Throw a typed `RosterMissingError` and have the Inngest worker catch + fail the step (so the photo lands in `submissions.status='error'` rather than `submission_photos.transcription_state='completed'` with raw text).
3. **Kill or auth-gate `/api/test-transcribe`.** The route is unused in production per CLAUDE.md (it lives under `src/app/test-transcribe/` for ad-hoc dev testing). Two acceptable fixes:
   - Delete the route + the page entirely (recommended — there's no shipped use of it).
   - Move under `/api/admin/test-transcribe`, add `isAdmin()` gate, remove the proxy allow-list for `/api/test-`.
4. **Verify the scrub contract via integration test** asserting the Inngest worker refuses to write when `course_rosters` is missing. (HAH currently has zero anonymizer tests per the pii-scrub audit; one regression test here is enough.)

**Acceptance:** Every codepath that produces text destined for Gemini OCR runs through a compiled roster or refuses to call Gemini. The `/api/test-transcribe` route either no longer exists or requires an admin session. Production confirmed-submission rows from the past week have no plain student names in `transcription_text`. Direct mirror of OE Phase 0 (`9dc96db`) + AID Phase 0 (`685b643`), expanded for HAH's open-endpoint + missing-scrub-wiring criticals.

---

## Phase 0b — Auth boundary criticals

**Audit refs:** `audit-auth-rls.md` CRITICAL-1, CRITICAL-2, HIGH-2 (filter injection), HIGH-4 (timing oracle), MED-2 (open-redirect); `audit-canvas.md` HIGH-5.

### Deliverables

1. **Add a teachers allowlist before any `teachers` upsert.** Either a `teachers_allowlist` table maintained by admins (parallel to the `admins` table), or an EHS-staff-only Google Workspace group check. `/api/teacher/setup/canvas` refuses with `auth_error=not_a_teacher` on miss. Apply to both the new `/teacher/setup` path AND the legacy `/setup` page.
2. **Tighten `students` INSERT policy.** Replace `WITH CHECK (true)` (migration 011 lines 57-60) with `WITH CHECK (is_teacher_owner_of_course(canvas_course_id))` — or, if a NULL-auth_user_id roster row is allowed, gate insertion behind a SECURITY DEFINER `enroll_student_in_course()` function that verifies the calling teacher actually owns the course. This closes the planted-student-row → token-theft path.
3. **Mutually exclusive role rows.** When upserting as teacher, reject if `students.auth_user_id` exists for the same id (or vice versa). Surface `auth_error=role_conflict`.
4. **Sanitize PostgREST `or()` filter inputs.** In `student/courses/[courseId]/assignments/[assignmentId]/layout.tsx`, switch the `.or(\`auth_user_id.eq.\${user.id},email.eq.\${user.email}\`)` to two separate `.eq` calls and union client-side, OR use a SECURITY DEFINER function that takes the parameters as bound args. Audit every other `.or(...)` and `.filter(...)` call with interpolated user input.
5. **`timingSafeEqual` for bearer compares.** `src/lib/peers/auth.ts` line 21 — `===` → `crypto.timingSafeEqual` with length pre-check. Same for any other `=== bearer` compare in the codebase.
6. **Open-redirect hardening on `next`.** `/api/auth/callback/route.ts` — validate that `next` is a relative path (`/`-prefixed, no `//`, no `\\`, no full URL).
7. **Verify `isAdmin()` is applied on every `/api/admin/*` route.** Per CLAUDE.md the gate is per-route, not centralized — count call sites and confirm.

**Acceptance:** No EHS student can become a teacher. No teacher can plant a student row for an arbitrary email. The PostgREST filter injection is closed. Bearer compares are constant-time. Open-redirect via `next` is blocked.

---

## Phase 0c — Encrypt Google OAuth tokens at rest

**Audit refs:** `audit-auth-rls.md` HIGH-3; `audit-seams.md` P0.

### Deliverables

1. **AES-256-GCM encrypt `students.google_access_token` and `google_refresh_token`** using the same `CANVAS_TOKEN_ENC_KEY` (or a new sibling key `STUDENT_GDRIVE_TOKEN_ENC_KEY` — recommend sibling for clean scope).
2. Migration: `google_access_token_encrypted bytea`, `google_refresh_token_encrypted bytea`; populate from the existing plaintext columns in a single transaction; drop the plaintext columns in a follow-up migration once readers are flipped.
3. Update `src/lib/google/auth.ts` `getStudentGoogleClient()` to decrypt at read time. Encrypt at write time in `/api/auth/callback/route.ts`.
4. Document key rotation in `INCIDENT_RESPONSE.md` (mirrors the suite-wide `scripts/rotate-canvas-enc-key.sh` pattern — M6.17 plans the rotation script; until then, manual rotation per the runbook).

**Acceptance:** A `pg_dump` of `students` shows ciphertext, not Drive tokens. A teacher with full RLS-SELECT access to their students' rows reads ciphertext, not plaintext. The Drive doc creation + retention sweep flows still work.

---

## Phase 1 — Snapshot semantics on submission start

**Audit refs:** submission-state H1 (prompt body live), H2 (destination flags live), canvas-snapshot drift, pii-scrub snapshot mismatch.

`submissions` and `submission_photos` reference `prompts`, `teacher_assignments`, `card_text_*`, and `course_rosters` LIVE. Worse, the OCR system prompt has a 10-minute in-process cache in `prompts/load.ts` that's PER-Fluid-Compute-worker — so two photos in the same submission can be OCR'd against DIFFERENT prompt versions if a worker recycle hits between them.

### Deliverables

1. New migration: add snapshot columns to `submissions`:
   - `ocr_prompt_body_snapshot text` + `ocr_prompt_version_at_submission int`
   - `card_text_snapshot jsonb`
   - `post_to_canvas_comment_at_submission bool`
   - `post_to_canvas_submission_at_submission bool`
   - `post_to_drive_at_submission bool`
   - `roster_snapshot jsonb`
   - `scrub_status text NOT NULL DEFAULT 'ok'` check (in ('ok','failed','skipped'))
2. Populate at submission-row INSERT (the photo-upload entry point). Lock the prompt version + roster + destination flags at submission start; the entire batch of photos shares them.
3. Read from snapshots in:
   - `transcribe-photo.ts` (OCR system prompt + scrub roster)
   - `confirm/route.ts` (destination routing)
   - `peers/envelope.ts` (frozen prompt body for the SG envelope)
4. Drop the 10-min prompt cache in `prompts/load.ts` once the snapshot is in place — the worker reads from the row, not the cache.

**Acceptance:** Two photos in the same submission ALWAYS see the same prompt body. A teacher destination flip mid-flight cannot retroactively change where the deliverable lands. Direct mirror of OE Phase 1 (`8828428`) + AID Phase 1 (`ecc3abd`).

---

## Phase 2 — State fences + idempotent confirm / Inngest / photo upload

**Audit refs:** submission-state C2 (confirm idempotency), C3 (worker races reset), C4 (worker non-idempotent on full re-run), C5 (photo upload race), H1 (rate-limiter); canvas-audit HIGH-3 (confirm idempotency).

Five distinct race conditions:

### 2a — Confirm idempotency + state fence

1. `/api/submissions/[id]/confirm/route.ts` checks `submission.status` up front; if already `submitted`, return the existing state (idempotent).
2. The three sequential UPDATEs (`confirmed` → gdoc fields → `submitted`) collapse into one UPDATE wrapped in a SECURITY DEFINER `complete_submission(...)` RPC that runs all the cross-system writes' DB-side effects atomically. The Canvas + Drive + SG webhook calls stay external; on success they all get persisted in one UPDATE.
3. Record `canvas_submission_id` on the response so retroactive idempotency-by-id works.
4. Drive doc creation: dedupe by checking `submissions.google_doc_id` before calling `createGoogleDoc`. (Currently `createGoogleDoc` doesn't dedupe by title and a double-fire creates two docs.)

### 2b — Inngest worker idempotency

1. `mark-processing` step: state-fenced UPDATE — only flip `pending` → `processing`. A full function re-run on an already-`completed` photo bails early.
2. `check-rate-limit`: increment via the existing RPC; on a step retry, the SDK guarantees idempotency for the same step ID. Confirm this is actually what Inngest does — if `check-rate-limit` is a separate step from `call-gemini`, a full function re-run could double-count. Either combine into one step or move the increment AFTER `call-gemini` succeeds.
3. `save-transcription`: state-fenced — only writes when `submission_photos.transcription_state IN ('processing','pending')`. A second attempt's overwrite is suppressed.
4. `check-submission-complete`: read-then-write race with user-initiated reset — wrap in `SELECT … FOR UPDATE` (or a SECURITY DEFINER function).

### 2c — Photo upload page-number race

1. Generate page numbers atomically inside a SECURITY DEFINER RPC `next_page_number(submission_id)` that uses `nextval`-style semantics, OR change the schema to a `position` jsonb array on the parent row.
2. Reverse the order: DB INSERT first (with a placeholder for `storage_path`), then Storage upload, then UPDATE the storage_path. On Storage failure, the partial row can be cleaned by the sweep (Phase 3). Closes the orphan-Storage-blob window.
3. Delete the stale-cleanup at `photos/route.ts:37-56` that's racing in-flight first-batch uploads.

### 2d — Rate-limiter scope + fail-open posture

1. Currently per-teacher and fail-open on DB error. Audit's HIGH-1: one student can exhaust an entire class's daily cap; a DB hiccup means unbounded Gemini billing.
2. Switch to per-`(teacher, student)` or per-`(teacher, day, submission)` scope. Document the fail-open as a deliberate choice (vs Phase 0 fail-closed for the PII path).

**Acceptance:** Concurrent / retried confirm calls produce exactly one Drive doc + Canvas write + SG webhook each. Inngest function-level re-runs don't re-bill Gemini. Two tabs uploading photos race correctly. Mirror of OE Phase 2 (`d37bd8d`) + AID Phase 2 (`d78e7b7`).

---

## Phase 3 — Stale-session sweep + retention cron

**Audit refs:** submission-state stale-cleanup (audit-submission-state §3.x); seams P0 (retention sweep no state fence), P1 (cleanup-photos cron state fence INVERTED).

The `cleanup-old-photos` Inngest cron exists but its filter is inverted — it only operates on submissions in `('confirmed','submitted')`, which are the rows whose photos have ALREADY been deleted by the transcribe step. The actual orphan class — abandoned `draft` / `review` photos — accumulates forever. Plus the admin-button retention sweep has no state fence and no required `beforeDate` (UI sends null on blank → wipes everything).

### Deliverables

1. **Fix `cleanup-old-photos`** to target the orphan class: `submissions.status IN ('draft','review')` AND `created_at < now() - interval '14 days'` → archive (new `archived` state) + delete Storage blobs.
2. **Add a `submissions.status='archived'` enum value** (mirroring AID Phase 3's `'archived'`).
3. **Auto-archive cron pass** — daily: `status IN ('draft','review','processing')` AND `created_at < now() - 14 days` → `archived` + Storage cleanup.
4. **Add a retention cron** — daily at 03:00 UTC, `/api/cron/sweep-submissions`, `CRON_SECRET`-gated:
   - Hard-delete: `status IN ('submitted','failed','archived','error')` AND `created_at < now() - 13 months` (per the suite-wide RETENTION_MONTHS=13 from M6.16).
   - State-fenced: never nuke an in-progress submission.
5. **Fix `/api/admin/retention/delete`** to require a non-null `beforeDate` and a state fence; reject the UI's `{ beforeDate: null }` shape; add a server-side "type DELETE" confirm to match the UI's claim.

**Acceptance:** Abandoned drafts get cleaned up automatically. The retention cron runs without an admin clicking a button. The admin retention endpoint refuses a missing-cutoff request. Mirror of OE Phase 3 (`24eb257`) + AID Phase 3 (`deaa802`).

---

## Phase 4 — Auto-save normalization (close CLAUDE.md regressions)

**Audit refs:** auto-save HIGH-1, HIGH-2, HIGH-3, HIGH-4, HIGH-5.

Two screens regressed from the suite-wide auto-save contract (same shape AID had):
- `src/app/teacher/setup/CardTextEditor.tsx` — controlled inputs + Save button + inline status.
- `src/app/admin/card-text/CardTextDefaultsEditor.tsx` — same shape.

Plus three structural concurrency issues:
- No `version`/`updated_at` fence on auto-save server actions → two-tab silent overwrite.
- `revalidatePath` after every save cancels in-flight debounce.
- `save()` not single-flighted; concurrent saves can serialize out-of-order.
- Aggregator pill green-washes errors when one editor in a multi-editor page succeeds.

### Deliverables

1. Port both editors to the suite-wide auto-save pattern (uncontrolled inputs + refs + `useAutoSaveForm` + `useAutoSaveDispatch`).
2. Add `version int NOT NULL DEFAULT 1` (or use existing) on `prompts`, `card_text_defaults`, `teachers` (for card overrides). Every auto-save action becomes `.update(...).eq("id", ?).eq("version", expected).select()`.
3. Replace blanket `revalidatePath` calls with targeted `revalidateTag`.
4. Single-flight `save()` in `useAutoSaveForm`.
5. Aggregator pill: per-key map + "any error wins" aggregation rule.

**Acceptance:** Every editor screen passes the suite-wide auto-save test. HAH's `/teacher/setup` + `/admin/card-text` match `/admin/prompts` byte-for-byte.

---

## Phase 5 — Canvas client robustness + destination picker wiring

**Audit refs:** submission-state C1 (destination ignored), canvas-audit CRIT-2 (destination dead-wired), HIGH-3 (no idempotency — addressed in Phase 2), HIGH-4 (bulkUninstall lacks ownership check), MED (snapshot drift, 429/5xx, token-validity).

### Deliverables

1. **Wire the destination picker into `confirm/route.ts`.**
   - Read `post_to_canvas_comment_at_submission` (or live fallback for legacy) + `post_to_canvas_submission_at_submission` + `post_to_drive_at_submission`.
   - Drive doc creation: gate on `post_to_drive`.
   - Canvas submission: gate on `post_to_canvas_submission` (the existing flag).
   - **Canvas comment**: actually implement `postSubmissionCommentAsStudent` for HAH (it's missing — the canvas-audit notes the writer was never built). Mirror AID's pattern.
   - "Drive only" = both Canvas flags false. Return early without Canvas write.
2. **`bulkUninstallAssignments` teacher-ownership check.** `installOne` checks `course.teacher_id !== teacherId`; `uninstallOne` does not. Mirror the install-side check.
3. **`scope.ts` write-skew fix** — the SG-scope check has cache-staleness issues per audit canvas-audit §8.
4. **429 / 5xx / 4xx categorization** — distinct retry semantics (mirrors AID Phase 5).
5. **Token validity at install time** — verify the Canvas token works before allowing install (avoid silent install failure that surfaces at confirm time).

**Acceptance:** Teachers' destination-picker choices are honored end-to-end. Co-teachers can't strip each other's cards via bulk uninstall. Canvas error categorization separates transient retry-worthy 429/5xx from permanent 4xx.

---

## Phase 6 — Roster sync correctness

**Audit refs:** canvas-audit CRIT-1 (per-course re-sync repoisons roster every dashboard load).

The 2026-05-20 fix (`9b3763e`) patched the bulk setup-wizard sync only. The per-course re-sync route at `/api/courses/[id]/sync/route.ts:84-119` still uses `cs.email ?? cs.login_id ?? null`. `BackgroundSync` fires this route on every teacher dashboard load. Students whose Canvas email is hidden hit the bug repeatedly.

### Deliverables

1. **Apply the `9b3763e` fix to `/api/courses/[id]/sync`.** Use the `/users?include[]=email&enrollment_state[]=active` endpoint, reject rows where email is missing.
2. **Audit all other roster-write paths** — anywhere `cs.email ?? cs.login_id` appears. Grep + grep.
3. **Cleanup pass**: scan `course_rosters` and `students` for `email` columns where `split_part(email, '@', 2) <> 'episcopalhighschool.org'` and either purge or fix them.

**Acceptance:** No `login_id`-as-email rows remain. Background sync runs cleanly.

---

## Phase 7 — Polish + small risks

Grouped low/medium findings. Cherry-pick by appetite.

- `auto_install_enabled_at IS NULL` bypass (canvas-audit §7).
- SG-scope cache write-skew (canvas-audit §8).
- Sentry `beforeSend` PII scrubber (seams P2).
- Retention CSV export memory load (seams P2).
- Storage-delete ordering creates orphan-blob window (seams P2).
- `auth/callback` email-rebind can poison roster mapping (seams P3).
- `result` envelope `limit(50)` + JS-side filter end-of-year edge case (seams P3).
- Missing "type DELETE" server confirm (auth-RLS MED).
- Storage bucket missing UPDATE/DELETE policies (auth-RLS MED — `.remove()` silently fails today).
- Predictable join codes (auth-RLS HIGH-7).
- `INITIAL_ADMIN_EMAIL` bootstrap on whitespace-only env var (auth-RLS info).
- Auto-save whitespace passes `min(1)` (auto-save MED).
- Non-atomic version bump (auto-save MED).

---

## Phase 8 — Infrastructure hardening

1. **Inngest re-sync post-deploy hook** — every Vercel deploy triggers `PUT /api/inngest`. Or: an admin button. Closes the suite-wide stale-registration gotcha.
2. **AES key rotation tooling** for `STUDENT_GDRIVE_TOKEN_ENC_KEY` (Phase 0c) — mirrors the suite-wide M6.17 `rotate-canvas-enc-key.sh` script shape.
3. **Anonymizer drift CI check** — wire `scripts/verify-anonymizer-drift.sh` into PR checks.

---

## Phase 9 — Verification + observability

1. **Integration tests** for each of the five root causes (mirror AID Phase 9 plan).
2. **Structured logs** on every state transition + Gemini call + Canvas write + Drive doc create.
3. **Synthetic monitoring** — daily cron that runs a synthetic upload + transcribe + confirm against a test course, with a flag to skip the actual Canvas write.
4. **Daily PII canary** — a script that searches `submission_photo_transcriptions.text` for non-tokenized name shapes and alerts if any land.

---

## Cross-cutting notes

**Mapping to OE M6.19 + AID M6.20:** the structural phases (1, 2, 3, 4, 5, 6, 7, 8, 9) directly mirror the prior two campaigns. The pre-Phase-1 tier (0, 0b, 0c) is HAH-specific and reflects the actively-leaking criticals the prior reviews didn't have to address.

**What's different about HAH:**
- The OCR boundary writes student handwriting → student names land in DB on every confirmed submission today (vs OE/AID where the fail-open scrub was latent).
- The `/api/test-transcribe` public endpoint is a $-loss + PII-egress hole today.
- The teacher self-promote + students INSERT policy combination is a direct path to compromising any student's Google Drive tokens, which are stored in plaintext.
- The per-course roster re-sync poisons the roster every dashboard load.
- The destination picker UI is a 3-checkbox lie.

These 5 add up to a Phase 0 that's much wider than OE/AID's. They are also each completable independently — no schema dependencies — so they ship same-day in parallel commits.

**Open questions to resolve before / during the relevant phase:**
- Phase 0c: encrypt with the existing `CANVAS_TOKEN_ENC_KEY` or a fresh `STUDENT_GDRIVE_TOKEN_ENC_KEY`? Recommended: fresh (clean rotation scope).
- Phase 1: snapshot the prompt body at submission start (intake-time) or at first photo OCR? Intake-time is cleaner.
- Phase 1: drop the prompts cache, or pin it to the prompt version? Drop is simpler now that the snapshot exists.
- Phase 6: should the cleanup pass purge already-corrupted `login_id`-as-email rows, or let them age out via roster re-sync? Recommended: purge (the affected students can't sign in until they're cleaned).
