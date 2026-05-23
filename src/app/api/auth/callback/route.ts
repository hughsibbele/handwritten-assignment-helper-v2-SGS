import { NextResponse } from "next/server";
import { getServerDbClient } from "@/lib/supabase/server";
import { createAdminDbClient } from "@/lib/supabase/admin";
import { encryptSecret } from "@/lib/crypto/secret";

// EHS Workspace domain gate (M4.11a). AID/OE enforce this via the
// callback; HAH didn't before 2026-05-22. Belt-and-suspenders on top of
// Google's `hd` OAuth param hint (which is client-side advisory and can
// be bypassed by sufficiently determined users).
const ALLOWED_DOMAIN = "episcopalhighschool.org";

// Phase 0b of REMEDIATION_PLAN.md — restrict the post-callback redirect
// target to relative same-origin paths. The previous behavior accepted
// anything in `next` and would happily redirect to `//evil.com` (browsers
// treat protocol-relative URLs as external).
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await getServerDbClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.session) {
      const userId = data.session.user.id;
      const userEmail = data.session.user.email;
      const providerToken = data.session.provider_token;
      const providerRefreshToken = data.session.provider_refresh_token;

      // M4.11a: hard-reject any non-EHS Workspace account. The
      // signOut() clears the cookie so the user doesn't get past the
      // proxy on the next navigation.
      const emailLower = userEmail?.toLowerCase() ?? "";
      if (!emailLower.endsWith(`@${ALLOWED_DOMAIN}`)) {
        await supabase.auth.signOut();
        return NextResponse.redirect(
          `${origin}/login?error=domain_not_allowed`,
        );
      }

      // M4.11b: extract the Google OAuth subject claim — stable across
      // EHS email renames, so it's the durable identifier for account
      // reconciliation. Persisted onto whichever role's row we touch
      // below.
      const googleIdentity = data.session.user.identities?.find(
        (i) => i.provider === "google",
      );
      const googleSub =
        (googleIdentity?.identity_data?.sub as string | undefined) ?? null;

      if (userEmail) {
        // Admin client required: must find students with NULL auth_user_id (RLS can't match)
        const admin = createAdminDbClient();

        // Try to find student by auth_user_id first, then by email
        const { data: studentById } = await admin
          .from("students")
          .select("id")
          .eq("auth_user_id", userId)
          .single();

        let studentId = studentById?.id;

        if (!studentId) {
          // Match by email (Canvas-synced students have email but no auth_user_id)
          const { data: studentByEmail } = await admin
            .from("students")
            .select("id, auth_user_id")
            .eq("email", userEmail)
            .single();

          if (studentByEmail) {
            studentId = studentByEmail.id;

            // Link the auth user to this Canvas student record
            if (!studentByEmail.auth_user_id) {
              await admin
                .from("students")
                .update({
                  auth_user_id: userId,
                  google_sub: googleSub,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", studentId);
            } else if (googleSub) {
              // Already linked — only refresh google_sub if we have one
              // and the column is null (don't clobber an existing value
              // — sub should be stable).
              await admin
                .from("students")
                .update({
                  google_sub: googleSub,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", studentId)
                .is("google_sub", null);
            }
          }
        }

        // Create a new student record for users not in Canvas (e.g. joining via class code)
        // Skip if user is a teacher — don't pollute the students table
        if (!studentId) {
          const { data: isTeacher } = await admin
            .from("teachers")
            .select("id")
            .eq("auth_user_id", userId)
            .single();

          if (!isTeacher) {
            const displayName =
              data.session.user.user_metadata?.full_name ||
              userEmail.split("@")[0];
            const { data: newStudent } = await admin
              .from("students")
              .insert({
                auth_user_id: userId,
                email: userEmail,
                display_name: displayName,
                google_sub: googleSub,
              })
              .select("id")
              .single();
            studentId = newStudent?.id;
          }
        }

        // Save Google tokens (only when provider returns them). Phase 0c:
        // tokens are AES-256-GCM-encrypted at rest. The encryption throws
        // if STUDENT_GDRIVE_TOKEN_ENC_KEY is unset — that's intentional;
        // silently falling back to plaintext re-opens the at-rest leak.
        // The session itself still completes so the user lands signed-in;
        // they just can't write to Drive until the operator sets the env.
        if (studentId && providerToken) {
          try {
            const accessEnc = encryptSecret(providerToken);
            const refreshEnc = providerRefreshToken
              ? encryptSecret(providerRefreshToken)
              : null;
            await admin
              .from("students")
              .update({
                google_access_token_encrypted: accessEnc,
                google_refresh_token_encrypted: refreshEnc,
                // Plaintext columns intentionally NOT written. Legacy rows
                // keep their plaintext until the backfill script + drop-
                // plaintext follow-up migration land.
                google_access_token: null,
                google_refresh_token: null,
                google_token_expires_at: new Date(
                  Date.now() + 3600 * 1000
                ).toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", studentId);
          } catch (err) {
            console.error(
              "[auth/callback] Google token encryption failed — student will be unable to write to Drive until env var is set",
              err,
            );
          }
        }
      }

      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocalEnv = process.env.NODE_ENV === "development";

      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`);
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`);
      } else {
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
