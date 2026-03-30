@AGENTS.md

# Reading Journal Helper

## Project overview
Web app for students to upload photos of handwritten work, transcribe via AI, and save as Google Docs. Integrates with Canvas LMS for assignments/rosters.

## Tech stack
- Next.js 15 (App Router, TypeScript)
- Supabase (Postgres, Auth, Storage, Realtime)
- Gemini 2.5 Flash Preview (handwriting transcription)
- Inngest v4 (background job orchestration)
- Tailwind CSS + shadcn/ui
- Deploy target: Vercel

## Commands
- `npm run dev` — start dev server (port 3000)
- `npx inngest-cli@latest dev` — start Inngest dev server (port 8288, needed for background transcription)
- `npm run build` — production build
- `npm run lint` — ESLint
- `npx tsc --noEmit` — type check
- `supabase db push` — push new migrations to remote Supabase
- `supabase db query --linked "SQL"` — run SQL against remote database

## Architecture
- `src/app/` — Next.js App Router pages and API routes
- `src/lib/` — shared libraries (supabase, canvas, gemini, inngest, utils)
- `src/components/` — React components (ui/ for shadcn, others organized by feature)
- `supabase/migrations/` — SQL migration files (run in order, 001-012 applied)
- Google Docs will be created in the student's own Drive, shared with the teacher

## Known issues
- RLS policies cause infinite recursion on some cross-table queries. Workaround: server-side API routes and dashboard pages use `createAdminClient()` (service role, bypasses RLS) instead of the user's Supabase client for DB operations. Auth is still checked via `supabase.auth.getUser()`.
- The new Supabase key format (`sb_publishable_` / `sb_secret_`) works for auth but does NOT work with the Supabase REST API directly (expects JWT). The SDK handles it fine.
- Next.js 16.2.1 warns that middleware is deprecated in favor of "proxy" — works fine for now, ignore the warning.

## Current status (as of 2026-03-29)

### What's done (Phase 1)
- **Auth**: Google OAuth login via Supabase, role detection (teacher vs student), middleware protection
- **Teacher setup**: `/setup` page — enter Canvas URL + API token, select courses to sync
- **Canvas sync**: Fetches courses, assignments, and student rosters from Canvas. Uses admin client to bypass RLS. Teacher can select which courses to import.
- **Teacher dashboard**: `/teacher/dashboard` — shows synced courses with student/assignment counts
- **Student dashboard**: `/student/dashboard` — shows enrolled courses, upcoming assignments, recent submissions
- **Photo upload UI**: Drag-and-drop photo uploader component (`PhotoDropzone`)
- **Student assignment page**: `/student/courses/[courseId]/assignments/[assignmentId]` — upload photos for an assignment
- **Submission review page**: `/student/submissions/[submissionId]` — real-time transcription status, text editor for review, confirm button
- **Inngest transcription pipeline**: Background function downloads photo from Supabase Storage → sends to Gemini 2.5 Flash → saves transcription → checks if all pages done → combines text
- **API routes**: auth callback, teacher setup, canvas sync, create submission, upload photos, confirm submission
- **Database**: 12 migrations applied (teachers, courses, students, enrollments, assignments, submissions, submission_photos, storage bucket, cross-table policies, RLS fixes)
- **Test page**: `/test-transcribe` — direct transcription test bypassing the full flow (needs middleware allowlist, added)

### Services configured
- Supabase project: `ynpfipjjnltqxujavdba` (linked via CLI, migrations pushed)
- Google Cloud: OAuth consent screen (internal), Drive + Docs APIs enabled, OAuth credentials created
- Gemini API key configured
- Inngest: account created, local dev mode works (`INNGEST_DEV=1`)
- Canvas: connected to `episcopalhighschool.instructure.com`, 2 courses synced (FLC + Chekhov, 2025-2026)

### What's NOT done yet
1. **Google Drive/Docs integration** (Phase 2, highest priority) — create Google Doc in student's Drive when they confirm transcription, share with teacher. Library stubs exist at `src/lib/google/` but are empty. The `googleapis` package is installed.
2. **Student enrollment linking** — students synced from Canvas don't have `auth_user_id` set, so when a student logs in with Google, they aren't matched to their Canvas record yet. Need to match by email on login.
3. **Full upload→transcribe→review flow end-to-end test** — individual pieces work but haven't been tested as a connected flow with a real student account.
4. **Canvas assignment submission** (Phase 2, future) — submit transcribed doc back to Canvas
5. **Multi-photo upload reordering** (Phase 3)
6. **Mobile optimization** (Phase 3)
7. **Class code join flow** (Phase 3, fallback auth)
8. **Production deployment to Vercel** — env vars need to be configured there

### To resume development
1. Start dev server: `npm run dev`
2. Start Inngest dev server (separate terminal): `npx inngest-cli@latest dev`
3. App runs at http://localhost:3000
4. Teacher dashboard: http://localhost:3000/teacher/dashboard
5. Test transcription: http://localhost:3000/test-transcribe
6. The most important next step is building the Google Drive/Docs integration (`src/lib/google/docs.ts` and `src/lib/google/drive.ts`) and wiring it into the confirm submission flow (`src/app/api/submissions/[id]/confirm/route.ts`).
