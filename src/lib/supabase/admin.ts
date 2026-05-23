import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — bypasses RLS. Use only in server-side
 * background jobs / route handlers that genuinely need it (system-to-system
 * paths). Named to match the suite-wide convention (AID's
 * `createAdminDbClient`), renamed from `createAdminClient` 2026-05-22 as
 * part of M4.13.
 */
export function createAdminDbClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
