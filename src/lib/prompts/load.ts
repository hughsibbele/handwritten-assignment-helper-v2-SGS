import { createAdminDbClient } from "@/lib/supabase/admin";

const TTL_MS = 10 * 60 * 1000;

type Cached = {
  expires: number;
  body: string;
  version: number;
};

const cache = new Map<string, Cached>();

/**
 * Load a prompt body by (owner='handwritten', key). 10-min in-process cache
 * matches the satellite-prompt cache TTL described in super-grader's
 * planning/integration-contract.md §11.
 *
 * Fallback: if the DB row is missing or unreachable, return `defaultBody`.
 * The contract calls this out explicitly — satellites must never fail an
 * LLM call because the registry is unreachable.
 */
export async function loadPrompt(
  key: string,
  defaultBody: string,
): Promise<string> {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.body;

  try {
    const admin = createAdminDbClient();
    const { data: row } = await admin
      .from("prompts")
      .select("body, version")
      .eq("owner", "handwritten")
      .eq("key", key)
      .single();
    if (row?.body) {
      cache.set(key, {
        expires: Date.now() + TTL_MS,
        body: row.body,
        version: row.version ?? 1,
      });
      return row.body;
    }
  } catch (err) {
    console.error("[prompts] load failed; falling back to default", err);
  }
  return defaultBody;
}

/** Invalidate on admin save so the next call re-reads. Best-effort across
 *  Fluid Compute workers — other workers expire on their own TTL. */
export function invalidatePromptCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}
