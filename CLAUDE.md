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
- `supabase db query --linked "SQL"` — run SQL against remote database

## Architecture
- `src/app/` — Next.js App Router pages and API routes
- `src/lib/` — shared libraries (supabase, canvas, gemini, google, inngest, utils)
- `src/components/` — React components (ui/ for shadcn, upload/, teacher/, student/, layout/)
- `src/proxy.ts` — Next.js 16 proxy (auth guard + role routing, formerly middleware.ts)
- `supabase/migrations/` — SQL migration files (run in order, 001-016 applied)
- Google Docs are created in the student's own Drive, in auto-created per-course folders shared with the teacher

## Known issues
- The new Supabase key format (`sb_publishable_` / `sb_secret_`) works for auth but does NOT work with the Supabase REST API directly (expects JWT). The SDK handles it fine.

## Admin client usage
RLS recursion was fixed via SECURITY DEFINER helper functions (migrations 015-016). Most API routes now use the user's Supabase client with RLS. `createAdminClient()` is still used where genuinely needed:
- **Inngest background jobs** — no user session/auth cookies
- **Auth callback** — must find students with NULL `auth_user_id`
- **Canvas sync routes** — bulk upserts creating records for other students
- **Confirm submission** — student needs teacher's Canvas credentials (cross-role access)
- **Google auth/drive helpers** — read any student's tokens from system context
- **Course join API** — student can't see unenrolled courses via RLS

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

## Current status (as of 2026-04-08)

### What's done
- **Auth**: Google OAuth login via Supabase, role detection (teacher vs student), proxy protection
- **Student enrollment linking**: Auth callback matches Google login email to Canvas-synced student record, sets `auth_user_id` and stores Google OAuth tokens. New users (not in Canvas) get a student record created automatically.
- **Teacher setup**: `/setup` page — enter Canvas URL + API token, select courses to sync, set short display names per course (used for Drive folder names)
- **Canvas sync**: Fetches courses, assignments (with submission_types and discussion_topic_id), and student rosters. Background sync fires on teacher dashboard load. Manual re-sync button on course detail page.
- **Teacher dashboard**: `/teacher/dashboard` — shows synced courses with short names, student/assignment counts. Background Canvas sync on load.
- **Teacher course detail**: `/teacher/courses/[courseId]` — assignment list with per-assignment Canvas auto-submit toggle, re-sync button
- **Student dashboard**: `/student/dashboard` — shows enrolled courses, upcoming assignments, recent submissions
- **Photo upload**: Drag-and-drop + camera capture (`PhotoDropzone`), drag-to-reorder pages (@dnd-kit), supports JPG/PNG/WebP/HEIC/HEIF
- **Student assignment page**: `/student/courses/[courseId]/assignments/[assignmentId]` — upload photos for an assignment
- **Submission review page**: `/student/submissions/[submissionId]` — real-time transcription status, text editor, Canvas submission toggle (pre-set from teacher default), confirm button
- **Google Drive/Docs integration**: On confirm, creates a Google Doc in the student's Drive inside an auto-created course folder ("FLC - Smith"), shared with the teacher. Folder ID stored on enrollment for reuse.
- **Canvas submission**: On confirm (if toggled), submits transcription text to Canvas as `online_text_entry` for assignments or posts as discussion entry for discussion-type assignments. Teacher token submits on behalf of student. Fails gracefully — never blocks doc creation.
- **Inngest transcription pipeline**: Background function downloads photo from Supabase Storage → sends to Gemini 2.5 Flash with correct MIME type → saves transcription → checks if all pages done → combines text
- **Class code join flow**: Students not in Canvas can join courses via class code. Dashboard shows join form for unenrolled students. Canvas submission toggle hidden for non-Canvas students.
- **API routes**: auth callback, teacher setup, canvas sync, course detail, course re-sync, course join, assignment update, create submission, upload photos, confirm submission
- **Database**: 16 migrations applied (015-016 fix RLS recursion with SECURITY DEFINER functions)
- **Deployed to Vercel** — end-to-end tested with real student account (2026-03-31)
- **Mobile optimization**: Camera capture button, touch-friendly drag reorder, always-visible remove buttons, responsive nav bar and textarea sizing
- **EHS branding**: Maroon/gray theme, Lora serif headings, EHS logo on login
- **Test page**: `/test-transcribe` — direct transcription test bypassing the full flow

### Services configured
- Supabase project: `ynpfipjjnltqxujavdba` (linked via CLI, migrations pushed)
- Google Cloud: OAuth consent screen (internal), Drive + Docs APIs enabled, OAuth credentials created
- Gemini API key configured
- Inngest: account created, local dev mode works (`INNGEST_DEV=1`)
- Canvas: connected to `episcopalhighschool.instructure.com`, 2 courses synced (FLC + Chekhov, 2025-2026)

### What's NOT done yet
1. **GitHub template repo** — plan to create a GitHub template repository (like user's other template repos) so other schools can self-host their own instance. Would need: generic branding (remove EHS-specific references), a setup guide for Supabase/Google Cloud/Gemini/Inngest/Vercel, and `.env.example` with clear documentation. The app is already multi-tenant per-teacher, so no architecture changes needed — just branding cleanup and documentation.

### To resume development
**Remind the user to start the dev server themselves** — it's better for them to run it so they can see the logs. Walk them through it if needed:
1. Open a terminal, `cd ~/Documents/Code/Handwritten-Assignment-Helper`
2. Run `npm run dev` (leave this terminal open — logs appear here)
3. Open a second terminal for Claude or other commands
4. Optionally, in a third terminal: `npx inngest-cli@latest dev` (needed for background transcription)
5. App runs at http://localhost:3000
6. Teacher dashboard: http://localhost:3000/teacher/dashboard
7. Test transcription: http://localhost:3000/test-transcribe
8. Stop the server with Ctrl+C when done

**Next priority**: Test the class code join flow with a non-Canvas student account. Then work on the GitHub template repo.
