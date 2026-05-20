"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/admin";

// M6.15 — server actions for the Canvas card text editors.
//
// `updateCardTextDefaults` is admin-only and edits the singleton
// card_text_defaults row (all 5 fields required, non-empty).
//
// `updateMyCardOverrides` + `resetMyCardOverride` are teacher-scoped and
// flip per-field columns on the caller's `teachers` row between
// "overridden" (non-empty string) and "inherit" (NULL).

type ActionResult = { ok: true } | { ok: false; error: string };

const CARD_FIELDS = [
  "card_kicker",
  "card_title",
  "card_body",
  "card_cta_label",
  "card_footnote",
] as const;
type CardField = (typeof CARD_FIELDS)[number];

const DEFAULT_FIELDS = [
  "kicker",
  "title",
  "body",
  "cta_label",
  "footnote",
] as const;

// =========================================================================
// Admin
// =========================================================================

/**
 * Replace every field on the singleton defaults row. Each field is
 * required + non-empty — the table's columns are NOT NULL and the
 * teacher-side resolver depends on these always having values.
 */
export async function updateCardTextDefaults(
  formData: FormData,
): Promise<ActionResult> {
  if (!(await isAdmin())) {
    return { ok: false, error: "Admin only." };
  }

  const values: Record<(typeof DEFAULT_FIELDS)[number], string> = {
    kicker: "",
    title: "",
    body: "",
    cta_label: "",
    footnote: "",
  };
  for (const field of DEFAULT_FIELDS) {
    const v = String(formData.get(field) ?? "").trim();
    if (!v) {
      return {
        ok: false,
        error: "All five card-text defaults are required — none can be blank.",
      };
    }
    values[field] = v;
  }

  // Service-role client because the table's admin-write policy gates on
  // is_admin() which is_admin() in the SQL helper — we've already checked
  // it above, so going through service-role removes one round-trip.
  const admin = createAdminClient();
  const { error } = await admin
    .from("card_text_defaults")
    .update(values)
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/card-text");
  revalidatePath("/teacher/setup");
  return { ok: true };
}

// =========================================================================
// Teacher
// =========================================================================

async function loadAuthedTeacherId(): Promise<string | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: teacher } = await supabase
    .from("teachers")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return (teacher?.id as string | undefined) ?? null;
}

/**
 * Save the teacher's per-field overrides. Each form field is plain text;
 * empty submissions land as NULL (re-inherit). Any field whose value
 * matches the current admin default also collapses to NULL so a teacher
 * who hits "use default" by retyping the same string doesn't accidentally
 * pin an override that decays if the admin later changes the default.
 */
export async function updateMyCardOverrides(
  formData: FormData,
): Promise<ActionResult> {
  const teacherId = await loadAuthedTeacherId();
  if (!teacherId) return { ok: false, error: "Not signed in." };

  const admin = createAdminClient();
  const { data: defaultsRow } = await admin
    .from("card_text_defaults")
    .select("kicker, title, body, cta_label, footnote")
    .eq("id", 1)
    .maybeSingle();
  const defaults = {
    card_kicker: (defaultsRow?.kicker as string | undefined) ?? "",
    card_title: (defaultsRow?.title as string | undefined) ?? "",
    card_body: (defaultsRow?.body as string | undefined) ?? "",
    card_cta_label: (defaultsRow?.cta_label as string | undefined) ?? "",
    card_footnote: (defaultsRow?.footnote as string | undefined) ?? "",
  } satisfies Record<CardField, string>;

  const patch: Record<CardField, string | null> = {
    card_kicker: null,
    card_title: null,
    card_body: null,
    card_cta_label: null,
    card_footnote: null,
  };
  for (const field of CARD_FIELDS) {
    const submitted = String(formData.get(field) ?? "").trim();
    if (submitted === "") {
      patch[field] = null;
    } else if (submitted === defaults[field]) {
      patch[field] = null;
    } else {
      patch[field] = submitted;
    }
  }

  const { error } = await admin
    .from("teachers")
    .update(patch)
    .eq("id", teacherId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/teacher/setup");
  return { ok: true };
}

/** Clear a single override → re-inherit the admin default. */
export async function resetMyCardOverride(
  formData: FormData,
): Promise<ActionResult> {
  const teacherId = await loadAuthedTeacherId();
  if (!teacherId) return { ok: false, error: "Not signed in." };

  const field = String(formData.get("field") ?? "");
  if (!CARD_FIELDS.includes(field as CardField)) {
    return { ok: false, error: `Field "${field}" can't be reset.` };
  }

  const admin = createAdminClient();
  const patch = { [field]: null } as Record<CardField, null>;
  const { error } = await admin
    .from("teachers")
    .update(patch)
    .eq("id", teacherId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/teacher/setup");
  return { ok: true };
}
