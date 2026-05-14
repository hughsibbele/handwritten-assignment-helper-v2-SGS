import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Default per-teacher daily cap when neither teachers.gemini_daily_cap nor
 * the GEMINI_DEFAULT_DAILY_CAP env is set. Sized for one class × ~30
 * students × ~10 pages = 300 calls, with ~3× headroom for resubmits,
 * retries, and busier classrooms. Adjust via env or per-teacher row.
 */
const FALLBACK_CAP = 1000;

function envDefaultCap(): number {
  const raw = process.env.GEMINI_DEFAULT_DAILY_CAP;
  if (!raw) return FALLBACK_CAP;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : FALLBACK_CAP;
}

/**
 * Atomic check-and-increment against the per-teacher daily Gemini cap.
 * Returns true when the call is allowed (and was counted), false when the
 * cap was hit.
 *
 * Fail-open: DB hiccups or unexpected errors return `true` so a transient
 * Postgres glitch doesn't lock students out. The rate-limiter is a cost
 * guardrail, not a security boundary — over-serving on rare DB errors is
 * preferable to blocking a class from finishing their assignment.
 */
export async function checkAndIncrementGeminiCall(
  teacherId: string,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("check_and_increment_gemini_call", {
      p_teacher_id: teacherId,
      p_default_cap: envDefaultCap(),
    });
    if (error) {
      console.error("[rate-limit] RPC error, failing open", error);
      return true;
    }
    return Boolean(data);
  } catch (err) {
    console.error("[rate-limit] unexpected error, failing open", err);
    return true;
  }
}
