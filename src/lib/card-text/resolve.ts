// M6.15: resolve effective Canvas-card text strings for a teacher.
//
// Stack of fallbacks per field:
//   1. teacher's own override column (teachers.card_*) — null if unset
//   2. system default row in card_text_defaults (singleton id=1)
//   3. DEFAULT_HANDWRITTEN_CARD_TEXT compiled into @/lib/canvas/install — only
//      reached if the defaults row is missing/corrupt
//
// Called by the install path before composing the branded card so every
// teacher gets fresh text on each install (no caching — admin can edit the
// defaults and the next install picks them up).

import "server-only";
import {
  DEFAULT_HANDWRITTEN_CARD_TEXT,
  type HandwrittenCardText,
} from "@/lib/canvas/install";
import { createAdminDbClient } from "@/lib/supabase/admin";

type TeacherOverrides = {
  card_kicker?: string | null;
  card_title?: string | null;
  card_body?: string | null;
  card_cta_label?: string | null;
  card_footnote?: string | null;
};

type SystemDefaults = {
  kicker: string;
  title: string;
  body: string;
  cta_label: string;
  footnote: string;
};

export async function resolveCardTextForTeacher(
  teacherId: string,
): Promise<HandwrittenCardText> {
  const admin = createAdminDbClient();

  // Fetch both rows in parallel — admin client bypasses RLS, fine here
  // because the data is non-sensitive and the install path already
  // established teacher identity.
  const [teacherRes, defaultsRes] = await Promise.all([
    admin
      .from("teachers")
      .select(
        "card_kicker, card_title, card_body, card_cta_label, card_footnote",
      )
      .eq("id", teacherId)
      .maybeSingle(),
    admin
      .from("card_text_defaults")
      .select("kicker, title, body, cta_label, footnote")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  const teacher = (teacherRes.data ?? {}) as TeacherOverrides;
  const defaults = (defaultsRes.data ?? null) as SystemDefaults | null;

  return {
    kicker:
      teacher.card_kicker ??
      defaults?.kicker ??
      DEFAULT_HANDWRITTEN_CARD_TEXT.kicker,
    title:
      teacher.card_title ??
      defaults?.title ??
      DEFAULT_HANDWRITTEN_CARD_TEXT.title,
    body:
      teacher.card_body ??
      defaults?.body ??
      DEFAULT_HANDWRITTEN_CARD_TEXT.body,
    ctaLabel:
      teacher.card_cta_label ??
      defaults?.cta_label ??
      DEFAULT_HANDWRITTEN_CARD_TEXT.ctaLabel,
    footnote:
      teacher.card_footnote ??
      defaults?.footnote ??
      DEFAULT_HANDWRITTEN_CARD_TEXT.footnote,
  };
}

export type CardTextDefaultsRow = SystemDefaults & { updated_at: string };

/** Load the singleton defaults row in raw column shape (snake_case) — used
 *  by the admin editor which submits via FormData with snake_case names. */
export async function loadCardTextDefaultsRow(): Promise<CardTextDefaultsRow> {
  const admin = createAdminDbClient();
  const { data } = await admin
    .from("card_text_defaults")
    .select("kicker, title, body, cta_label, footnote, updated_at")
    .eq("id", 1)
    .maybeSingle();
  const row = (data ?? null) as CardTextDefaultsRow | null;
  return {
    kicker: row?.kicker ?? DEFAULT_HANDWRITTEN_CARD_TEXT.kicker,
    title: row?.title ?? DEFAULT_HANDWRITTEN_CARD_TEXT.title,
    body: row?.body ?? DEFAULT_HANDWRITTEN_CARD_TEXT.body,
    cta_label: row?.cta_label ?? DEFAULT_HANDWRITTEN_CARD_TEXT.ctaLabel,
    footnote: row?.footnote ?? DEFAULT_HANDWRITTEN_CARD_TEXT.footnote,
    updated_at: row?.updated_at ?? new Date(0).toISOString(),
  };
}

/** Resolve just the defaults (no teacher overrides). Used as the
 *  placeholder source for the teacher's per-field overrides. */
export async function loadCardTextDefaults(): Promise<HandwrittenCardText> {
  const row = await loadCardTextDefaultsRow();
  return {
    kicker: row.kicker,
    title: row.title,
    body: row.body,
    ctaLabel: row.cta_label,
    footnote: row.footnote,
  };
}

/** Fetch a teacher's per-field overrides (null = inherit). Used by the
 *  teacher-side edit UI to render current state. */
export async function loadTeacherCardOverrides(teacherId: string): Promise<{
  card_kicker: string | null;
  card_title: string | null;
  card_body: string | null;
  card_cta_label: string | null;
  card_footnote: string | null;
}> {
  const admin = createAdminDbClient();
  const { data } = await admin
    .from("teachers")
    .select(
      "card_kicker, card_title, card_body, card_cta_label, card_footnote",
    )
    .eq("id", teacherId)
    .maybeSingle();
  return {
    card_kicker: (data?.card_kicker as string | null) ?? null,
    card_title: (data?.card_title as string | null) ?? null,
    card_body: (data?.card_body as string | null) ?? null,
    card_cta_label: (data?.card_cta_label as string | null) ?? null,
    card_footnote: (data?.card_footnote as string | null) ?? null,
  };
}
