import * as Sentry from "@sentry/nextjs";

/**
 * Init Sentry once per process / browser session. DSN gates activation:
 * when `SENTRY_DSN` (server) or `NEXT_PUBLIC_SENTRY_DSN` (client) is
 * unset, this is a no-op — no init, no events, no perf overhead.
 *
 * tracesSampleRate: 0 deliberately. We want error events; perf events get
 * turned on once we have a cost-shape baseline. sendDefaultPii: false
 * because teacher Canvas tokens and student photos pass through request
 * scope on some routes — no redaction story yet.
 */
export function initSentry(runtime: "node" | "edge" | "browser") {
  const dsn =
    runtime === "browser"
      ? process.env.NEXT_PUBLIC_SENTRY_DSN
      : process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:
      process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    initialScope: { tags: { runtime } },
  });
}
