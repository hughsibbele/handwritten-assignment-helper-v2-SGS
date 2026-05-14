# Handwritten Assignment Helper

Web app for Episcopal High School students to upload photos of handwritten
work, transcribe via AI, and save as Google Docs. Integrates with Canvas LMS
for assignments/rosters and can auto-submit back to Canvas.

Architecture, current status, and project state live in
[`CLAUDE.md`](./CLAUDE.md). Per-phase narrative of what's been built —
including the satellite integration with Super Grader — lives in
[`BUILD_PLAN.md`](./BUILD_PLAN.md). This README focuses on getting set up.

## Stack

Next.js 16 (App Router) · Supabase (Postgres + Auth + Storage) · Gemini 2.5
Flash · Inngest v4 · Tailwind + shadcn/ui · Google Drive/Docs · deployed on
Vercel.

## Commands

```bash
npm run dev                       # dev server on :3000
npx inngest-cli@latest dev        # Inngest dev server on :8288 (for background transcription)
npm run build                     # production build
npm run lint                      # ESLint
npx tsc --noEmit                  # type check
supabase db push                  # apply new migrations to remote
```

## Secrets

> **Policy: `.env.example` is the canonical source of truth.** If you add a
> new env var in code, add it to `.env.example` in the same PR. If you rename
> one on Vercel, rename it in `.env.example` too. When the two disagree,
> `.env.example` wins — Vercel and code should be brought in line, not the
> other way around.

### Local setup

1. `cp .env.example .env.local`
2. Fill in values (most come from the Supabase dashboard, Google Cloud
   Console, or are generated fresh — see annotations in `.env.example`)
3. The shared-ecosystem values (`SUPER_GRADER_SALT` etc. — see below) get
   copied from sibling projects rather than generated fresh

### Production setup (Vercel)

`vercel env ls` shows which vars are set on the project. To add one:

```bash
vercel env add VAR_NAME production
```

The CLI prompts for the value. To pull deployed values into local
`.env.local` for parity testing: `vercel env pull`.

### Shared-ecosystem secrets

HAH is one of several "satellite" tools that integrate with the Super Grader
project. Some secrets are **shared** across projects — they hold byte-identical
values, but each project names them after who it's talking to.

| Value | Where it lives | What it does |
|---|---|---|
| **Anonymization salt** | `SUPER_GRADER_SALT` in **HAH**, **AI Documenter**, and **Super Grader** | HMAC salt for the `anon_token`s that cross between tools. Same name everywhere. Rotating invalidates every stored token — treat as a security incident response. |
| **HAH inbound bearer** | `HANDWRITTEN_API_TOKEN` in both **HAH** and **Super Grader** | Same name on both sides. HAH accepts requests carrying this bearer; Super Grader presents it on outbound GETs to HAH's `/api/super-grader/*` endpoints. |
| **HAH outbound bearer** | `SUPER_GRADER_INGEST_TOKEN` in **HAH**, but `HANDWRITTEN_INGEST_TOKEN` in **Super Grader** | Asymmetric name. HAH presents this bearer on webhook POSTs to Super Grader; Super Grader verifies inbound requests against the same value. |
| **AI Documenter inbound bearer** | `AI_DOCUMENTER_API_TOKEN` in both **AI Documenter** and **Super Grader** | Same shape as the HAH one above, for AI Documenter's satellite. |
| **AI Documenter outbound bearer** | `SUPER_GRADER_INGEST_TOKEN` in **AI Documenter**, `AI_DOCUMENTER_INGEST_TOKEN` in **Super Grader** | Same asymmetric pattern as HAH's outbound bearer. |
| **Gemini API key** | `GEMINI_API_KEY` everywhere | One key, central billing, same name everywhere. |

**Mental model.** The name on **your side** describes who **you** are talking
to. The name on **the other side** describes who **they** are listening to.
That's why the same bearer can be `SUPER_GRADER_INGEST_TOKEN` in HAH (the
token I present to Super Grader) and `HANDWRITTEN_INGEST_TOKEN` in Super
Grader (the token I expect from Handwritten Helper).

### When you add a new secret

1. Add the var to `.env.example` with a comment explaining what it is, where
   to get the value from, and what happens if it's missing
2. Read it via `process.env.VAR_NAME` in code; if the var is required, fail
   loudly when it's unset rather than silently
3. Run `vercel env add VAR_NAME production` (and `preview`, `development` if
   the value differs across environments)
4. If the secret is shared with another project in this ecosystem, add a
   row to the cross-project table above

### Cross-project setup order

When provisioning a fresh deployment, set secrets in this order to avoid
"why is the other tool 401-ing me?" debugging:

1. `SUPER_GRADER_SALT` — generate once on whichever project gets deployed
   first; copy verbatim to all others. Never regenerate.
2. **Inbound bearers** (`HANDWRITTEN_API_TOKEN`, `AI_DOCUMENTER_API_TOKEN`)
   — generate fresh per peer, set on both the peer and Super Grader.
3. **Outbound bearers** (`HANDWRITTEN_INGEST_TOKEN`, etc.) — generate fresh
   per peer, set on both sides.
4. **URLs** (`SUPER_GRADER_API_URL`) — set once Super Grader has a URL.

## Branding

EHS Maroon `#7a1e46`, EHS Gray `#54565b`, Light Blue `#C4DCEB`, Dark Blue
`#006890`. Lora (serif) for headings, Geist Sans for body. Logo at
`/public/ehs-logo.webp`. Style guide:
<https://www.episcopalhighschool.org/ehs-style-guide>.
