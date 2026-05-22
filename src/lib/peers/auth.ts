import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Bearer-auth gate for /api/super-grader/* endpoints. Returns null when the
 * request is authorized; returns a NextResponse to bail with otherwise.
 *
 * Missing env var → 500 (loud). The contract treats unconfigured satellites
 * as a setup error super-grader needs to flag, not as a silent 401 that
 * looks like a bad credential. Bad/missing token → 401 per contract.
 *
 * Phase 0b of REMEDIATION_PLAN.md: token compare uses crypto.timingSafeEqual
 * to close the byte-by-byte timing oracle on a long-lived shared bearer.
 * Realistic exploitability is low (TLS + Vercel jitter dominate), but the
 * hardening is one line — same shape we use everywhere else in the suite.
 */
export function checkSuperGraderBearer(request: Request): NextResponse | null {
  const expected = process.env.HANDWRITTEN_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "HANDWRITTEN_API_TOKEN is not configured on this satellite." },
      { status: 500 },
    );
  }
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const presented = Buffer.from(match[1], "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (
    presented.length !== expectedBuf.length ||
    !timingSafeEqual(presented, expectedBuf)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
