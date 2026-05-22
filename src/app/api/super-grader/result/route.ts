import { NextResponse } from "next/server";
import { checkSuperGraderBearer } from "@/lib/peers/auth";
import { buildEnvelopeForCanvasIds } from "@/lib/peers/envelope";
import { RosterMissingError } from "@/lib/anonymizer/roster";

export async function GET(request: Request) {
  const authFail = checkSuperGraderBearer(request);
  if (authFail) return authFail;

  const url = new URL(request.url);
  const canvasUserIdRaw = url.searchParams.get("canvas_user_id");
  const canvasAssignmentIdRaw = url.searchParams.get("canvas_assignment_id");
  if (!canvasUserIdRaw || !canvasAssignmentIdRaw) {
    return NextResponse.json(
      { error: "canvas_user_id and canvas_assignment_id are required" },
      { status: 400 },
    );
  }
  const canvasUserId = Number(canvasUserIdRaw);
  const canvasAssignmentId = Number(canvasAssignmentIdRaw);
  if (!Number.isFinite(canvasUserId) || !Number.isFinite(canvasAssignmentId)) {
    return NextResponse.json(
      { error: "canvas_user_id and canvas_assignment_id must be numeric" },
      { status: 400 },
    );
  }

  // Phase 0 fail-closed: if the course roster isn't usable, we refuse to
  // ship raw transcript text. Return 503 so super-grader retries instead
  // of caching a no-data response.
  let envelope;
  try {
    envelope = await buildEnvelopeForCanvasIds(
      canvasUserId,
      canvasAssignmentId,
    );
  } catch (err) {
    if (err instanceof RosterMissingError) {
      console.warn(
        `[super-grader/result] roster_missing canvas_user=${canvasUserId} canvas_assignment=${canvasAssignmentId} reason=${err.reason}`,
      );
      return NextResponse.json(
        { error: "roster_missing", message: err.reason },
        { status: 503 },
      );
    }
    throw err;
  }
  if (!envelope) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Short cache: super-grader pulls this on view, but state can change
  // between loads (resubmission, edits). 30s gives the burst-fetch case
  // a free ride without holding stale data for long.
  return NextResponse.json(envelope, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
