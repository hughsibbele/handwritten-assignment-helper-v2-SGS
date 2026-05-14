@AGENTS.md

# Handwritten Assignment Helper

## Project overview
Web app for Episcopal High School students to upload photos of handwritten work, transcribe via AI, and save as Google Docs. Integrates with Canvas LMS for assignments/rosters and can auto-submit back to Canvas.

## Tech stack
- Next.js 16 (App Router, TypeScript)
- Supabase (Postgres, Auth, Storage, Realtime)
- Gemini 2.5 Flash (handwriting transcription)
- Inngest v4 (background job orchestration)
- Tailwind CSS + shadcn/ui
- Google APIs (Drive, Docs) for document creation
- Deploy target: Vercel

## Commands
- `npm run dev` — start dev server (port 3000)
- `npx inngest-cli@latest dev` — start Inngest dev server (port 8288, needed for background transcription)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npx tsc --noEmit` — type check
- `supabase db push` — push new migrations to remote Supabase
- `supabase db reset --linked` — drop public schema + re-apply 001-NNN against the linked project. Destructive — wipes all data. Used 2026-05-13 to recover from a cross-project mis-link.
- `supabase migration list --linked` — diff local migrations vs remote `schema_migrations`. First thing to run when `db push` complains about drift.
- `supabase migration repair --status {applied|reverted} <version>...` — surgically fix migration tracking when local and remote disagree (e.g., versions applied via Studio that the CLI never recorded).

## Architecture
- `src/app/` — Next.js App Router pages and API routes
- `src/lib/` — shared libraries (supabase, canvas, gemini, google, inngest, anonymizer, peers, prompts, telemetry, utils)
- `src/components/` — React components (ui/ for shadcn, upload/, teacher/, student/, admin/, layout/)
- `src/proxy.ts` — Next.js 16 proxy (auth guard + role routing + `ADMIN_EMAILS` gate, formerly middleware.ts)
- `instrumentation.ts` + `instrumentation-client.ts` (project root) — Sentry wiring, env-gated on `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`
- `supabase/migrations/` — SQL migration files (run in order, 001-022 applied)
- Google Docs are created in the student's own Drive, in auto-created per-course folders shared with the teacher

### Key library modules
- `src/lib/anonymizer/` — HMAC-SHA256 `Student_xxxxxx` token (matches super-grader's integration-contract §2 byte-for-byte) + roster-driven name scrubber compiled and cached 5-min per course
- `src/lib/peers/` — super-grader envelope builder + outbound webhook (fire-and-forget, silent no-op when SG env vars unset) + bearer-auth guard for inbound `/api/super-grader/*`
- `src/lib/prompts/load.ts` — DB-backed prompt loader with 10-min in-process TTL, hardcoded default fallback if the row is missing/unreachable. Wired into `transcribeImage()`.
- `src/lib/gemini/rate-limit.ts` — atomic check-and-increment via SECURITY DEFINER RPC. Fail-open on DB error.
- `src/lib/academic-year.ts` + `src/lib/assignment-sort.ts` — current-term filter for Canvas sync + proximity sort (just-passed and upcoming-soon first)
- `src/lib/telemetry/sentry-init.ts` — DSN-gated Sentry init; no-op until configured

### Routes added since the 2026-04-08 snapshot
- `/admin` — admin shell (gated by `ADMIN_EMAILS` proxy allowlist)
- `/admin/prompts` — edit the seeded OCR prompt; version bumps on save
- `/admin/retention` — CSV export (UTF-8 BOM) + chunked hard delete with "type DELETE" confirm
- `/api/super-grader/result` — GET, bearer-auth via `HANDWRITTEN_API_TOKEN`, returns the `PeerResultEnvelope<HandwrittenSummary>`
- `/api/super-grader/prompt` — GET, same bearer, returns the live OCR prompt body so SG's prompts dashboard mirrors it without seeding
- `/api/admin/prompts/[key]` — PATCH the prompt body; invalidates the local-worker cache
- `/api/admin/retention/export` — CSV download
- `/api/admin/retention/delete` — chunked 200/batch delete (storage objects, then DB cascade)

## Known issues
- The new Supabase key format (`sb_publishable_` / `sb_secret_`) works for auth but does NOT work with the Supabase REST API directly (expects JWT). The SDK handles it fine.

## Admin client usage
RLS recursion was fixed via SECURITY DEFINER helper functions (migrations 015-016). Most API routes now use the user's Supabase client with RLS. `createAdminClient()` is still used where genuinely needed:
- **Inngest background jobs** — no user session/auth cookies (includes the rate-limit RPC call)
- **Auth callback** — must find students with NULL `auth_user_id`
- **Canvas sync routes** — bulk upserts creating records for other students
- **Confirm submission** — student needs teacher's Canvas credentials (cross-role access); also fires the super-grader webhook
- **Google auth/drive helpers** — read any student's tokens from system context
- **Course join API** — student can't see unenrolled courses via RLS
- **`/api/super-grader/*`** — system-to-system endpoints, no user session
- **`/admin/*` + `/api/admin/*`** — admin client behind the `ADMIN_EMAILS` proxy gate. There's intentionally no `admins` table or `is_admin()` SQL helper yet — see Future work below.

## Migration template (new tables)

Supabase is dropping the default `public`-schema auto-grant on new tables — enforced on existing projects 2026-10-30 (per their 2026-05-13 announcement). Existing tables keep their grants; nothing breaks today. But every `CREATE TABLE` in `public` from here on should pair the CREATE with explicit grants + RLS + policies in the same migration:

```sql
CREATE TABLE public.your_table ( ... );

ALTER TABLE public.your_table ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.your_table TO service_role;
-- intentionally NO grant to anon — Handwritten Helper is authenticated-only;
--   anon has no business reading or writing anything in this schema.

CREATE POLICY "..." ON public.your_table FOR ... TO authenticated USING (...);
```

Same rule for new helper functions: `GRANT EXECUTE ... TO authenticated, service_role`, with an explicit `REVOKE EXECUTE ... FROM anon` if the function ends up in the `public` schema. Supabase auto-grants EXECUTE to `anon` on every new public function and its `REVOKE ... FROM PUBLIC` doesn't clear role-specific grants, so the explicit revoke is the safe pattern.

## Branding
- EHS Maroon: `#7a1e46`, EHS Gray: `#54565b`, Light Blue: `#C4DCEB`, Dark Blue: `#006890`
- Headings: Lora (serif). Body: Geist Sans.
- Logo: `/public/ehs-logo.webp`
- Style guide: https://www.episcopalhighschool.org/ehs-style-guide

## Current status (as of 2026-05-13)

Phases 1, 2, and 3 shipped in code on 2026-05-13 (this session). See `BUILD_PLAN.md` for the per-phase narrative. Quick summary of what was added on top of the pre-Phase-1 baseline (the original 2026-04-08 feature set — auth, Canvas sync, photo upload, transcription pipeline, Google Docs, Canvas submission, mobile UX, EHS branding — is all still here, unchanged):

- **Phase 1** — transcription guardrails (`maxOutputTokens: 4096`, prompt skips Name/Date/Period headers), upfront block on assignments Canvas can't accept, Sentry env-gated, active-term Canvas-sync filter, proximity sort + search on both teacher/student assignment lists
- **Phase 2** — super-grader satellite integration: anonymizer (HMAC token + roster scrub), `/api/super-grader/result` and `/api/super-grader/prompt` GET endpoints with bearer auth, fire-and-forget webhook on submission confirm, sentinel marker on Canvas body, lazy `anon_token` backfill, admin layer (`ADMIN_EMAILS` env-var allowlist), `/admin/prompts` editor with version-bump-on-save, DB-backed prompt loader with 10-min in-process cache
- **Phase 3** — per-teacher Gemini daily cap with SECURITY DEFINER atomic check (`FOR UPDATE` row lock), fail-open on DB error, `/admin/retention` page with UTF-8-BOM CSV export and "type DELETE" hard-delete chunked at 200/batch

### Services configured
- Supabase project: `ynpfipjjnltqxujavdba` (linked via CLI). **Migrations 001-022 applied 2026-05-13 via `supabase db reset --linked` after a separate Claude session in the Harkness Helper repo accidentally linked the same Supabase project and ran HH's migrations against it. The reset wiped all data (rosters, courses, submissions, photo metadata). Pre-Phase-1 testing data is gone; auth.users survived. Next teacher dashboard load will re-sync Canvas.**
- Google Cloud: OAuth consent screen (internal), Drive + Docs APIs enabled, OAuth credentials created
- Gemini API key configured
- Inngest: account created, local dev mode works
- Canvas: connected to `episcopalhighschool.instructure.com`, 2 courses (FLC + Chekhov, 2025-2026) — re-sync needed after the 2026-05-13 data wipe

### What's NOT done yet
1. **Phase 1-3 production deploy** — code is committed but not pushed to Vercel. Need to deploy + set new env vars on the project (`SUPER_GRADER_SALT`, `HANDWRITTEN_API_TOKEN`, `ADMIN_EMAILS`, optional `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `GEMINI_DEFAULT_DAILY_CAP`). See `README.md` → Secrets and `BUILD_PLAN.md` → Pending deploy work.
2. **Smoke test in browser** — verify `/admin/prompts` edit + version bump, `/admin/retention` CSV download, a submission flow produces the sentinel marker on the Canvas body
3. **Super Grader webhook target** — `SUPER_GRADER_API_URL` + `SUPER_GRADER_INGEST_TOKEN` stay blank until SG deploys. Our `pushToSuperGrader()` silently no-ops, so this is fine — but the webhook plumbing isn't validated end-to-end yet.
4. **Admin layer graduation** — currently `ADMIN_EMAILS` env-var allowlist. If we ever add a second admin or a second admin surface beyond the prompt editor + retention, graduate to AI Documenter's `admins` table + `is_admin()` SECURITY DEFINER + `INITIAL_ADMIN_EMAIL` self-bootstrap pattern. See project memory.
5. **GitHub template repo** — plan to create a GitHub template repository so other schools can self-host their own instance. Needs generic branding (remove EHS-specific references), a setup guide for Supabase/Google Cloud/Gemini/Inngest/Vercel, and `.env.example` cleanup. The app is already multi-tenant per-teacher.

### To resume development
**Remind the user to start the dev server themselves** — it's better for them to run it so they can see the logs. Walk them through it if needed:
1. Open a terminal, `cd ~/Code/handwritten-assignment-helper`
2. Run `npm run dev` (leave this terminal open — logs appear here)
3. Open a second terminal for Claude or other commands
4. Optionally, in a third terminal: `npx inngest-cli@latest dev` (needed for background transcription)
5. App runs at http://localhost:3000
6. Teacher dashboard: http://localhost:3000/teacher/dashboard
7. Admin (requires email in `ADMIN_EMAILS`): http://localhost:3000/admin/prompts and http://localhost:3000/admin/retention
8. Test transcription: http://localhost:3000/test-transcribe
9. Stop the server with Ctrl+C when done

**Next priority**: Finish wiring `.env.local` (Vercel env pull for the existing secrets + paste the salt + generate `HANDWRITTEN_API_TOKEN`), smoke-test Phase 2 surfaces in the browser, then push Phase 1-3 to production Vercel.
