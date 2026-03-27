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
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run lint` — ESLint
- `npx tsc --noEmit` — type check

## Architecture
- `src/app/` — Next.js App Router pages and API routes
- `src/lib/` — shared libraries (supabase, canvas, gemini, inngest, utils)
- `src/components/` — React components (ui/ for shadcn, others organized by feature)
- `supabase/migrations/` — SQL migration files (run in order)
- Google Docs are created in the student's own Drive, shared with the teacher
