"use client";

import { useState, useTransition } from "react";
import type { HandwrittenCardText } from "@/lib/canvas/install";
import { Loader2 } from "lucide-react";
import { CardPreview } from "@/components/card-text/CardPreview";
import { updateCardTextDefaults } from "@/lib/card-text/actions";

type Initial = {
  kicker: string;
  title: string;
  body: string;
  cta_label: string;
  footnote: string;
  updated_at: string;
};

/**
 * Admin-only editor for the five system-default card-text strings. Lives
 * as an always-open box on /admin/card-text (no collapsible) so admins
 * see the live preview as they type. Mirrors the teacher's setup-page
 * editor; the teacher version adds per-field reset buttons.
 *
 * Every field is required + non-empty here — the singleton row's columns
 * are NOT NULL with sane seeded defaults, and the resolver chain falls
 * back to these values for any teacher who hasn't overridden the field.
 */
export function CardTextDefaultsEditor({
  initial,
  appBaseUrl,
}: {
  initial: Initial;
  appBaseUrl: string;
}) {
  const [kicker, setKicker] = useState(initial.kicker);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [ctaLabel, setCtaLabel] = useState(initial.cta_label);
  const [footnote, setFootnote] = useState(initial.footnote);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | string>(
    "idle",
  );
  const [, startTransition] = useTransition();

  const effective: HandwrittenCardText = {
    kicker: kicker.trim() || initial.kicker,
    title: title.trim() || initial.title,
    body: body.trim() || initial.body,
    ctaLabel: ctaLabel.trim() || initial.cta_label,
    footnote: footnote.trim() || initial.footnote,
  };

  function handleSubmit(fd: FormData) {
    setStatus("saving");
    startTransition(async () => {
      const result = await updateCardTextDefaults(fd);
      if (result.ok) {
        setStatus("saved");
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
      } else {
        setStatus(result.error);
      }
    });
  }

  return (
    <div className="rounded-md border border-stone-200 bg-white">
      <div className="px-5 pt-5">
        <div className="text-base font-medium text-ink leading-snug">Canvas card text — system defaults</div>
        <div className="mt-1 text-sm text-stone-500">
          What teachers see as the placeholder fallback per field. Each
          teacher can override any subset on their own{" "}
          <code className="rounded bg-stone-50 px-1">/teacher/setup</code>{" "}
          page; changes here apply to anyone who hasn&apos;t overridden the
          field. Updated {new Date(initial.updated_at).toLocaleDateString()}.
        </div>
      </div>
      <div className="px-5">
        <div className="grid gap-6 lg:grid-cols-2">
          <form action={handleSubmit} className="space-y-4">
            <Field
              label="Kicker (ALL CAPS line at top)"
              name="kicker"
              value={kicker}
              setValue={setKicker}
            />
            <Field label="Title" name="title" value={title} setValue={setTitle} />
            <Field
              label="Body paragraph"
              name="body"
              value={body}
              setValue={setBody}
              multiline
            />
            <Field
              label="Button label"
              name="cta_label"
              value={ctaLabel}
              setValue={setCtaLabel}
            />
            <Field
              label="Footnote (italic line under the button)"
              name="footnote"
              value={footnote}
              setValue={setFootnote}
            />
            <div className="flex items-center gap-3">
              <button type="submit" disabled={status === "saving"} className="rounded-md bg-maroon px-3 py-1.5 text-sm font-medium text-white hover:bg-maroon-dark disabled:opacity-50">
                {status === "saving" && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save defaults
              </button>
              {status === "saved" && (
                <span className="text-sm text-green-700">Saved.</span>
              )}
              {status !== "idle" &&
                status !== "saving" &&
                status !== "saved" && (
                  <span className="text-sm text-red-600">
                    Error: {status}
                  </span>
                )}
            </div>
          </form>

          <div className="lg:sticky lg:top-4 self-start">
            <CardPreview appBaseUrl={appBaseUrl} text={effective} />
            <p className="mt-2 text-xs text-cool-gray">
              Live preview reflects your draft. The button doesn&apos;t go
              anywhere in this preview.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  setValue,
  multiline,
}: {
  label: string;
  name: string;
  value: string;
  setValue: (s: string) => void;
  multiline?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={`admin-${name}`} className="text-sm font-medium">{label}</label>
      {multiline ? (
        <textarea
          id={`admin-${name}`}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          rows={4}
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm leading-snug focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon disabled:opacity-50"
        />
      ) : (
        <input
          id={`admin-${name}`}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          className="w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon disabled:opacity-50"
        />
      )}
    </div>
  );
}
