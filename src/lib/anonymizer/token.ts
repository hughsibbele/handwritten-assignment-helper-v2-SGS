import { createHmac } from "node:crypto";

/**
 * HMAC-derived stable anonymization token. Algorithm is fixed across the
 * EHS satellite ecosystem (super-grader, AI Documenter, Handwritten Helper):
 *
 *   salt   = base64-decoded SUPER_GRADER_SALT (32+ random bytes)
 *   input  = "ehs\0" + canvas_user_id + "\0" + email_lowercased
 *   token  = "Student_" + first 6 hex chars of HMAC-SHA256(salt, input)
 *
 * The same student, in every tool, produces the same token. Rotating the
 * salt invalidates every stored token — treat rotation as a security
 * incident response, never routine.
 *
 * Source of truth: super-grader's planning/integration-contract.md §2.
 */
export function anonToken(canvasUserId: string | number, email: string): string {
  const salt = process.env.SUPER_GRADER_SALT;
  if (!salt) {
    throw new Error(
      "SUPER_GRADER_SALT is not set — cannot compute anonymization token.",
    );
  }
  const input = Buffer.concat([
    Buffer.from("ehs\0"),
    Buffer.from(String(canvasUserId)),
    Buffer.from("\0"),
    Buffer.from(email.trim().toLowerCase()),
  ]);
  const mac = createHmac("sha256", Buffer.from(salt, "base64"))
    .update(input)
    .digest("hex");
  return `Student_${mac.slice(0, 6)}`;
}
