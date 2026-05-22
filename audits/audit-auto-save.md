# HAH audit — auto-save, server-action error handling, race conditions

Date: 2026-05-21
Reviewer: Claude (Opus 4.7) per Hugh's commission
Scope: editor screens in `/admin/prompts`, `/admin/card-text`, `/teacher/setup` plus the shared auto-save module, the `/api/admin/prompts/[key]` PATCH endpoint, and `src/lib/card-text/actions.ts`.

Lens (suite-wide root causes carried over from the OE + AID audits):

1. Snapshot — out of scope.
2. **State fences** — `version` / `updated_at` guards on saves.
3. Transactional boundaries — saves with downstream side effects.
4. **Fail-open** — failed save silently reverts.
5. **Idempotency** — visibilitychange + blur + debounce single-flighted; `useTransition` guarding.

Findings are listed worst-first within each severity tier. File:line references are absolute.

---

## HIGH — Two editors on `/teacher/setup` and `/admin/card-text` were never ported to auto-save (same regression as AID)

**Files:**
- `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/app/teacher/setup/CardTextEditor.tsx` lines 1–241
- `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/app/admin/card-text/CardTextDefaultsEditor.tsx` lines 1–188

**Scenario.** Per the suite memo `feedback_editable-prompt-auto-save.md`, *every* screen that edits a prompt body, template field, or system-default config uses auto-save — no Save buttons. CLAUDE.md for HAH explicitly lists `/admin/card-text` and the teacher's card-text override editor as auto-save screens. Both files still ship the OLD pattern:

- Controlled inputs (`value={kicker}` + `onChange={(e) => setKicker(...)}`) — incompatible with `isFormDirty()`'s DOM-walker (lines 92–97 admin, 109–149 teacher).
- An explicit **`Save defaults`** / **`Save card text`** submit button driven by `useTransition` + `handleSubmit(fd)` (admin lines 119–124, teacher lines 151–156).
- Server-action form-action posting via `<form action={handleSubmit}>` — submits the WHOLE form per save, not the per-field dirty diff (admin line 91, teacher line 108).
- No `useAutoSaveForm`, no `<AutoSaveProvider>`, no aggregator pill — the admin `card-text` page mounts the editor without wrapping it in a provider (admin page.tsx lines 9–13).
- Status display is `setTimeout(() => setStatus("idle"), 2000)` — a transient inline label, not the sticky bottom-right pill the rest of the suite uses (admin lines 125–135, teacher lines 157–167).

**Impact.**
- Direct data loss path: teacher types into Body paragraph, switches tabs / closes laptop / nav-clicks away → nothing fired the save, the form just blows away the unsaved text. The suite-wide promise of "Hugh wanted the Google-Docs feel — type, never think about saving, never lose work" is broken on the most-edited screen in HAH (card text is per-teacher; teachers tweak this).
- Identical AID bug shape: AID's `/dashboard/prompts/PromptCard.tsx` and `/dashboard/setup/CardTextEditor.tsx` shipped controlled inputs + Save button. HAH carries the same regression on both equivalents.
- The HAH PR `4f40279` (per task brief) ported `/admin/prompts` to auto-save but did NOT touch the card-text editors. The CLAUDE.md "auto-save replaces Save/Discard buttons in /admin/prompts" note is technically accurate but the broader claim ("editable prompts auto-save") is false for two of the three editor pages.

**Fix direction.**
1. Port both files to uncontrolled inputs (`defaultValue` + `ref`).
2. Keep one parallel React `useState` per field (only updated via `onInput`) for the live `CardPreview` pane — the AID `CardTextDefaultsEditor` is the canonical pattern.
3. Replace `<form action={handleSubmit}>` with `<form ref={formRef} onSubmit={(e) => e.preventDefault()}>`.
4. Build a `save()` callback that snapshots `FormData` from the form ref, calls `updateCardTextDefaults` / `updateMyCardOverrides`, and dispatches to `useAutoSaveDispatch()`. After success, manually re-baseline every input's `defaultValue` to its current `.value`.
5. Wire `useAutoSaveForm({ formRef, save, freshnessKey: <updated_at> })`.
6. Wrap the parent server-component in `<AutoSaveProvider>` so the pill renders.
7. Drop the inline "Saved." span / error span — the pill replaces them.
8. **Reset-to-default buttons stay button-driven** (imperative). The memo explicitly carves those out.
9. **Important caveat** when porting: `updateMyCardOverrides` (line 154) and `updateCardTextDefaults` (line 81) currently call `revalidatePath('/teacher/setup')` and `revalidatePath('/admin/card-text')`. Auto-save fires on every blur / 800ms keystroke pause — calling `revalidatePath` on each fires a server re-render mid-typing and (a) changes `freshnessKey` if it's the row's `updated_at`, (b) wipes any local in-flight debounce timer if the editor re-mounts. Per the AID audit, that "`revalidatePath` cancels in-flight debounce" pattern was a real bug. Drop the `revalidatePath` calls when porting — the editor maintains its own local state via the dispatch + manual `defaultValue` re-baseline, so the suite no longer needs server revalidation to refresh the displayed value.

---

## HIGH — No optimistic-concurrency fence on `/api/admin/prompts/[key]` PATCH (two-tab silent overwrite)

**File:** `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/app/api/admin/prompts/[key]/route.ts` lines 30–52

**Scenario.** The PATCH route reads `existing.version`, computes `nextVersion = existing.version + 1`, then UPDATEs unconditionally:

```
.update({ body, version: nextVersion, updated_at: now })
.eq("owner", "handwritten")
.eq("key", key)   // ← no version match clause
```

Two tabs on `/admin/prompts` reading the same `version=5`:
1. Tab A types, autosaves → PATCH writes `version=6, body="A's body"`.
2. Tab B (still on `version=5` in its UI) types, autosaves → PATCH reads `version=6`, writes `version=7, body="B's body"`. **A's body is silently overwritten.**

Comment on line 31 acknowledges this — "Last-write-wins is fine here — admin is one person." That's the same rationalisation AID had. It breaks when:
- Two browser tabs are open (a common admin workflow — diff against the live version in one tab while editing in another).
- The admin pool grows past one (`admins` table supports it; INITIAL_ADMIN_EMAIL self-bootstrap is just the seed).
- The auto-save's lack of single-flight (see next finding) causes overlapping PATCHes from the SAME tab.

Per the suite-wide root cause #2, this is the same `version`/`updated_at` fence-missing pattern flagged in AID.

**Fix direction.**
1. Have the client POST `body` + `expected_version` (read from the React state mirror, not the DOM).
2. PATCH route guards: `update(...).eq("owner", ...).eq("key", ...).eq("version", expected_version)`, then check `count === 1` on the returned rows. If zero rows touched, return `409 Conflict` with the freshly-read row so the client can show "your edit is stale — discard or re-apply" instead of silently overwriting.
3. Client-side, the 409 path dispatches `{kind: "error", msg: "Another tab updated this prompt — refresh to see the latest"}` and stops triggering further autosaves until the freshness is reset.

---

## HIGH — Auto-save has no single-flight / in-flight guard (visibilitychange + blur + debounce can fire overlapping saves)

**Files:**
- `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/components/auto-save/use-auto-save-form.ts` lines 63–105
- `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/components/admin/prompt-editor.tsx` lines 32–77

**Scenario.** The hook calls `saveRef.current()` directly from `fire()` (line 74) on three triggers: debounce expiry, focusout, and visibilitychange. There is no `if (inflight) return` guard, no `useTransition` wrapping, no `AbortController`.

Concrete race:
1. User types → 800ms timer starts.
2. User Alt-Tab away → `visibilitychange→hidden` fires → `save()` runs (PATCH A starts).
3. User Alt-Tab back, types more, blurs → `focusout` fires → `save()` runs again (PATCH B starts before A completes).
4. PATCH B serializes at the DB before A (network ordering not guaranteed) → version=6 (B's body).
5. PATCH A completes after → version=7 (A's stale body). **B's later edit is silently lost.**

Combined with the missing version fence above, this is two flavours of the same data-loss bug from a single user. AID's hook has the identical shape; HAH's is a byte-for-byte port.

There's a related sub-issue: when a save fails (`dispatch({kind: "error"})`), the next keystroke happily fires another save through the same broken path — there's no backoff and no "tell the user we kept the in-DOM value; you may want to retry" hint, because the editor's `defaultValue` is NOT re-baselined on failure (only on success, line 67). The DOM remains "dirty" so the next `onInput` / blur tries again. That's fine for transient 500s but pathological when the failure is permanent (e.g. validation rejection from the server) — we'll re-send the same invalid payload on every keystroke. See "MEDIUM" below for the related fix.

**Fix direction.**
1. Add `useRef<boolean>(false)` (`inflightRef`) to `PromptEditor.save()` and the future card-text autosave porter. If already in flight, drop the trigger and ALSO mark a "needs another save after this one finishes" flag — when the in-flight save settles, check the flag and fire one more save (the "trailing-edge" pattern). This collapses bursts to one in-flight + one queued, never two concurrent.
2. Alternatively wrap `save()` in `useTransition` and skip when `isPending` (cheaper, no manual ref, but the trailing-edge pattern still needs an `onSettled` check).
3. Consider adding a "backoff on hard error" mode: when `dispatch({kind:"error"})` fires, mark a `dirtyAfterError` flag and suppress further auto-saves until the user types again (an `input` event resets the flag). That avoids the "repeatedly re-send the same invalid payload" pathology.

---

## HIGH — Aggregator pill green-washes errors when multiple editors are on one page (same as AID)

**File:** `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/components/auto-save/context.tsx` lines 23–34

**Scenario.** `AutoSaveProvider` holds one `useState<AutoSaveStatus>` shared by every consumer of `useAutoSaveDispatch()`. The pill renders whatever the *last dispatcher* set.

`/admin/prompts/page.tsx` line 51 — `prompts.map((p) => <PromptEditor ... />)` — mounts N editors under the provider. Today the seed has one prompt row (`handwritten_image_transcription`), but the table supports more and CLAUDE.md hints at growth ("…shaped to match super-grader's prompts contract so a future cross-tool registry can read this verbatim", migration 021 line 3).

The moment a second prompt row exists:
1. Editor A's save fails → `dispatch({kind:"error", msg:"…"})` → pill goes red.
2. Editor B's save succeeds 50ms later → `dispatch({kind:"saved"})` → pill turns green.
3. User sees "Saved · just now" and assumes everything is safe. Editor A's failure is lost. Editor A's textarea is still in dirty state, but `defaultValue` hasn't been re-baselined (good), so the next keystroke triggers a retry — but per the previous finding, that's bad UX (no error reporting at field level).

This is AID's audit finding word-for-word. HAH is currently shielded only because the prompts table has one row.

**Fix direction.**
1. Track per-key status in the provider: `Map<string, AutoSaveStatus>` (key = a unique editor id, e.g. `prompt.id`).
2. Aggregator rule: if ANY editor's status is `"error"`, pill shows error (with that editor's msg + key). Else if ANY is `"saving"`, show "Saving…". Else if any has saved recently, show the most-recent "Saved · Xs ago".
3. `useAutoSaveDispatch()` becomes `useAutoSaveDispatch(key: string)` returning a setter bound to that key. Apply to both PromptEditor instances and (after porting) both card-text editors.
4. As a secondary mitigation, surface a field-level error indicator on the editor card itself (red border + msg under the textarea) so the user sees the per-editor failure even if the pill aggregator gets a later success from a sibling.

---

## MEDIUM — Empty-after-trim bodies bypass the client's check via whitespace-only input → `min(1)` server validation passes

**Files:**
- `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/components/admin/prompt-editor.tsx` line 34
- `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/app/api/admin/prompts/[key]/route.ts` lines 7–9

**Scenario.** Client guards `if (!body.trim())` but the server's `z.string().min(1)` only checks raw length. A body of `"   \n\n  "` (3 spaces + newlines + 2 spaces) passes both:
- Client: `body.trim()` is `""` → falsy → guard triggers → `dispatch({kind:"error"})`. (OK.)
- BUT: this client guard runs only in this specific code path. If the user's flow somehow bypasses the trim-empty case (e.g. they paste whitespace, blur fast enough that the debounce fires before the `value` is set to `""`, or any future code path that sends the PATCH directly), the server happily accepts `"   "` as a valid prompt body. The transcription pipeline then reads "   " from the prompts cache and sends a useless prompt to Gemini.

Also the server lacks a max-trim check: `max(50_000)` is on the raw string, but a 50k-character prompt of mostly whitespace is fine by the server.

**Fix direction.**
1. Server: `z.string().trim().min(1).max(50_000)` (zod's `.trim()` transform happens before `.min()`).
2. Better: `z.string().transform(s => s.trim()).pipe(z.string().min(1).max(50_000))` if you want to PRESERVE the trim in the DB row.
3. Client guard stays, but treat the server's 400 as a real error in the pill, not a silent no-op.

---

## MEDIUM — PATCH read-then-update is not atomic — `version` can skip ahead under load

**File:** `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/app/api/admin/prompts/[key]/route.ts` lines 30–47

**Scenario.** The route reads `existing.version`, computes `+1`, then updates. Between the SELECT and the UPDATE, a concurrent PATCH on the same `(owner, key)` reads the same `existing.version`, both write `version = N+1` — the second one overwrites the first, version actually skips from N to N+1 (instead of N → N+1 → N+2). Audit trail loses one version.

This is mostly a cosmetic/audit-trail issue, NOT a data-loss issue (the body overwrite is covered above). But it does break the "Version bumps monotonically on save so cache busters / audit trails work" promise in migration 021 line 8.

**Fix direction.**
1. Use a SQL-side increment: `update({ body, version: pgRaw("version + 1"), updated_at: now })` via an RPC or `rpc('bump_prompt', ...)` — Postgres SERIALIZABLE / row lock guarantees monotonic increment.
2. Or combine with the optimistic-concurrency fence above: `.eq("version", expected_version)` makes the read-then-update naturally CAS, refusing the concurrent write entirely.

---

## MEDIUM — Idle-state pill never shows "you have unsaved changes" — failure-mode UX gap

**File:** `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/components/auto-save/auto-save-status-pill.tsx` lines 45–66

**Scenario.** The pill has three visible states: saving / saved / error. When the form is *dirty but no save has been attempted yet* (between keystrokes inside the 800ms debounce window), the pill shows the previous state — typically "Saved · 3s ago" — even though there are unsaved changes in the DOM. That conflicts with the visibility promise.

If the user closes the tab during this 800ms window, the `visibilitychange` handler in the hook DOES fire `save()`, so data isn't lost on close. But the user-facing telemetry mismatches reality: they see "Saved" while content is unsaved. AID has the same issue.

Low impact in practice (the 800ms window is short and visibilitychange covers most paths). Worth flagging since the deliverable is "audit findings" and this is in the same shape as suite-wide root cause #4 (fail-open UX).

**Fix direction.**
1. Add a fourth state, `{kind: "pending"}` or `{kind: "dirty"}`, dispatched from `onInput` BEFORE the debounce timer fires.
2. Render as a neutral-coloured "Editing…" pill (no spinner, distinct from "Saving…" which has the spinner).
3. Clear back to `saved` once the save succeeds.

---

## LOW — `freshnessKey: prompt.updated_at` doesn't change after a save (cosmetic — works by accident today)

**File:** `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/components/admin/prompt-editor.tsx` line 79

**Scenario.** `freshnessKey` is wired to `prompt.updated_at` — the prop, not the local `savedAt` state. After a successful save, the local `savedAt` advances (line 61), but `prompt.updated_at` stays at the initial value forever (until the page re-renders from the server). So the freshnessKey's "reset debounce timer when the row changes" purpose only fires across server-render boundaries, not within the session.

That's actually fine — because (a) the PATCH route doesn't call `revalidatePath` (line 56-63 of route.ts has no revalidate; line 61 just invalidates the in-process prompt-loader cache, which isn't the page cache), and (b) the editor doesn't actually need a freshness-key reset within the session since `defaultValue` is manually re-baselined after each save.

The only failure mode is: someone later adds `revalidatePath('/admin/prompts')` to the PATCH route → the server re-renders → `prompt.updated_at` advances → the useEffect dependency `freshnessKey` changes → the effect's cleanup wipes the debounce timer mid-keystroke → next keystroke restarts the timer. This is the same revalidatePath-cancels-debounce bug AID had. Currently dormant in HAH but a single one-line PR away from latent.

**Fix direction.**
1. Mark the `revalidatePath` of `/admin/prompts` as forbidden in a code comment on `/api/admin/prompts/[key]/route.ts` — explain why.
2. Alternatively, wire `freshnessKey` to a value that's stable across in-session saves but bumps when an external write happens. The AID `useAutoSaveForm.ts` shares this limitation — addressing it would be a suite-wide change to the hook contract.

---

## LOW — `/setup` (legacy page) ships a divergent setup UX that bypasses the new `/teacher/setup` shape entirely

**Files:**
- `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/app/setup/page.tsx` lines 1–351
- `/Users/hkoeze/code/super-grader-suite/handwritten-assignment-helper-v2-SGS/src/app/teacher/dashboard/page.tsx` lines 30–31

**Scenario.** Per the global memory `feedback_app-setup-consistency.md`, "Setup-page shape must match across the 4 satellite apps". HAH ships BOTH:
- `/setup` (`src/app/setup/page.tsx`) — old step-by-step "Step 1 / Step 2" client-component with `useState`-driven course selection + naming flow, and no card-text editor at all. The teacher dashboard redirects here on the new-teacher path (lines 30–31).
- `/teacher/setup` (`src/app/teacher/setup/page.tsx`) — newer server-component with `CanvasConnectionSection` + `CardTextEditor` + Drive placeholder. This is the one CLAUDE.md and `loadCardTextDefaults` revalidations target.

Two consequences:
1. A new teacher hits `/setup` (per the redirect) and never sees the card-text editor — they have to discover it via the nav bar (`nav-bar.tsx:59` does link to `/teacher/setup`, so it's reachable, but the welcome flow doesn't surface it).
2. Documentation and `revalidatePath` calls reference `/teacher/setup` while the actual landing path is `/setup`. The diverged shape is exactly the consistency miss the global memory predicts.

**Fix direction (out of pure-auto-save scope but adjacent).**
1. Either delete `/setup` and redirect the dashboard's new-teacher path to `/teacher/setup`, OR
2. Re-purpose `/setup` as a wrapper around `/teacher/setup` that conditionally shows the course-load wizard only when the teacher has no courses yet.
3. Either way, surface the card-text editor in the welcome flow — currently new teachers ship Canvas cards with school-default text and have no in-flow nudge to customise.

This isn't an auto-save bug per se, but it sits inside the audit scope ("Check the teacher's setup page particularly carefully — is the auto-save pattern correctly applied?"). The answer: half-applied, because the page the teacher actually lands on doesn't contain an editor at all.

---

## Out-of-scope / clean

- **`useAutoSaveForm` itself is byte-for-byte AID's hook.** Same in-flight gap (covered above) but no NEW issues vs AID — `isFormDirty` walks `input` / `textarea` / `select`, handles checkbox / radio correctly, ignores `hidden` / `submit` / `button` inputs.
- **`getCurrentAdminEmail` / `isAdmin`** return null instead of redirecting (`src/lib/auth/admin.ts` lines 15–55). Server actions / API routes check the boolean and return 403, no redirect from a server action — no mid-typing redirect-on-error risk.
- **`CanvasConnectionSection`** uses imperative buttons (Test / Save Canvas / Sync) — correctly button-driven per the memo's "Imperative actions stay button-driven" carve-out. No auto-save needed here.
- **`CourseAccordion` BulkActions** — also imperative (Install / Uninstall), correctly button-driven.
- **PromptEditor's manual `defaultValue` re-baseline on save success** (line 67) — correctly applied, mirrors AID's `SystemPromptCard` pattern.
- **PATCH route's response shape** — returns the updated row including `version` and `updated_at`, lets the client re-baseline cleanly. Good.

---

## Severity ranking (worst-first)

1. **HIGH** — `/teacher/setup` CardTextEditor never ported to auto-save (data loss on tab close).
2. **HIGH** — `/admin/card-text` CardTextDefaultsEditor never ported to auto-save (data loss on tab close, admin-side).
3. **HIGH** — No optimistic-concurrency fence on the PATCH route (two-tab silent overwrite).
4. **HIGH** — No single-flight guard in the auto-save hook (overlapping PATCH races even from one tab).
5. **HIGH** — Aggregator pill green-washes errors when multiple editors share the provider.
6. **MEDIUM** — Server's `z.string().min(1)` accepts whitespace-only bodies.
7. **MEDIUM** — Version increment is not atomic (audit-trail skip under load).
8. **MEDIUM** — Pill has no "unsaved changes" state; "Saved" is misleading inside the 800ms debounce window.
9. **LOW** — `freshnessKey` wired to a prop that never changes within a session — latent landmine for a future `revalidatePath` PR.
10. **LOW** — `/setup` legacy page diverges from `/teacher/setup` shape; teachers never land on the card-text editor in the welcome flow.

Findings 1 and 2 are the AID HIGH-severity bugs repeating verbatim. Findings 3, 4, 5, 8 are suite-wide root causes #2, #5, #4, #4 respectively. Finding 10 cross-references the global memory's app-setup-consistency note.
