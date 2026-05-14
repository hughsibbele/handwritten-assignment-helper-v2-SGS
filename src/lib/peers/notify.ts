import type { HandwrittenEnvelope } from "./types";
import { buildEnvelopeForCanvasIds } from "./envelope";

const TIMEOUT_MS = 5_000;

/**
 * Fire-and-forget push to super-grader's /api/ingest/handwritten. Composes the
 * same envelope shape the GET endpoint returns so super-grader hits one
 * deserializer either way.
 *
 * Silent no-op when SUPER_GRADER_API_URL or SUPER_GRADER_INGEST_TOKEN is
 * unset — that's the local/preview shape where super-grader isn't deployed
 * (or isn't deployed yet). The student/teacher flow on the calling route
 * must never block on this; awaited in the caller only so we log failures.
 *
 * Also silent when no envelope can be built (no confirmed submission for
 * the pair) — the caller might invoke us with stale ids.
 */
export async function pushToSuperGrader(
  canvasUserId: number,
  canvasAssignmentId: number,
): Promise<void> {
  const ingestUrl = process.env.SUPER_GRADER_API_URL;
  const ingestToken = process.env.SUPER_GRADER_INGEST_TOKEN;
  if (!ingestUrl || !ingestToken) {
    console.log(
      "[super-grader] push skipped (ingest URL/token not configured)",
      { canvasUserId, canvasAssignmentId, skipped: true },
    );
    return;
  }

  let envelope: HandwrittenEnvelope | null;
  try {
    envelope = await buildEnvelopeForCanvasIds(canvasUserId, canvasAssignmentId);
  } catch (err) {
    console.error("[super-grader] envelope build failed", err);
    return;
  }
  if (!envelope) {
    console.log("[super-grader] no envelope to push", {
      canvasUserId,
      canvasAssignmentId,
    });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ingestUrl}/api/ingest/handwritten`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ingestToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[super-grader] push non-2xx", {
        status: res.status,
        body: await res.text().catch(() => ""),
      });
    }
  } catch (err) {
    console.error("[super-grader] push failed", err);
  } finally {
    clearTimeout(timeout);
  }
}
