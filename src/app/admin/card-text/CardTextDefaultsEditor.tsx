"use client";

import { useState, useTransition } from "react";
import type { HandwrittenCardText } from "@/lib/canvas/install";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle>Canvas card text — system defaults</CardTitle>
        <CardDescription>
          What teachers see as the placeholder fallback per field. Each
          teacher can override any subset on their own{" "}
          <code className="rounded bg-paper px-1">/teacher/setup</code>{" "}
          page; changes here apply to anyone who hasn&apos;t overridden the
          field. Updated {new Date(initial.updated_at).toLocaleDateString()}.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
              <Button type="submit" disabled={status === "saving"}>
                {status === "saving" && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save defaults
              </Button>
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
      </CardContent>
    </Card>
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
      <Label htmlFor={`admin-${name}`}>{label}</Label>
      {multiline ? (
        <Textarea
          id={`admin-${name}`}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          rows={4}
        />
      ) : (
        <Input
          id={`admin-${name}`}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
        />
      )}
    </div>
  );
}
