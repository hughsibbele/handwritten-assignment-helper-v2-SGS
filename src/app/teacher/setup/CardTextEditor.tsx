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
import {
  resetMyCardOverride,
  updateMyCardOverrides,
} from "@/lib/card-text/actions";

type CardOverrides = {
  card_kicker: string | null;
  card_title: string | null;
  card_body: string | null;
  card_cta_label: string | null;
  card_footnote: string | null;
};

/**
 * Teacher-facing card-text customization. Five fields, each with an
 * inheriting placeholder + per-field "reset to default" button. Live
 * preview reflects the current draft so the teacher sees the effect
 * before saving.
 *
 * M6.15 — port of OE's CardTextEditor with HAH's shadcn primitives.
 */
export function CardTextEditor({
  defaults,
  overrides,
  appBaseUrl,
}: {
  defaults: HandwrittenCardText;
  overrides: CardOverrides;
  appBaseUrl: string;
}) {
  const [kicker, setKicker] = useState(overrides.card_kicker ?? "");
  const [title, setTitle] = useState(overrides.card_title ?? "");
  const [body, setBody] = useState(overrides.card_body ?? "");
  const [ctaLabel, setCtaLabel] = useState(overrides.card_cta_label ?? "");
  const [footnote, setFootnote] = useState(overrides.card_footnote ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | string>(
    "idle",
  );
  const [, startTransition] = useTransition();

  const effective: HandwrittenCardText = {
    kicker: kicker.trim() || defaults.kicker,
    title: title.trim() || defaults.title,
    body: body.trim() || defaults.body,
    ctaLabel: ctaLabel.trim() || defaults.ctaLabel,
    footnote: footnote.trim() || defaults.footnote,
  };

  function handleSave(fd: FormData) {
    setStatus("saving");
    startTransition(async () => {
      const result = await updateMyCardOverrides(fd);
      if (result.ok) {
        setStatus("saved");
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
      } else {
        setStatus(result.error);
      }
    });
  }

  function handleReset(field: keyof CardOverrides, setter: (s: string) => void) {
    setStatus("saving");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("field", field);
      const result = await resetMyCardOverride(fd);
      if (result.ok) {
        setter("");
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
        <CardTitle>Canvas card text</CardTitle>
        <CardDescription>
          The wording inside the branded card students see in Canvas. Leave
          a field blank to inherit the school-wide default. Changes apply
          to <strong>future installs</strong> — already-installed cards
          keep the old text until you re-install (uninstall + install).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:grid-cols-2">
          <form action={handleSave} className="space-y-4">
            <Field
              label="Kicker (ALL CAPS line at top)"
              field="card_kicker"
              value={kicker}
              setValue={setKicker}
              placeholder={defaults.kicker}
              onReset={() => handleReset("card_kicker", setKicker)}
            />
            <Field
              label="Title"
              field="card_title"
              value={title}
              setValue={setTitle}
              placeholder={defaults.title}
              onReset={() => handleReset("card_title", setTitle)}
            />
            <Field
              label="Body paragraph"
              field="card_body"
              value={body}
              setValue={setBody}
              placeholder={defaults.body}
              onReset={() => handleReset("card_body", setBody)}
              multiline
            />
            <Field
              label="Button label"
              field="card_cta_label"
              value={ctaLabel}
              setValue={setCtaLabel}
              placeholder={defaults.ctaLabel}
              onReset={() => handleReset("card_cta_label", setCtaLabel)}
            />
            <Field
              label="Footnote (italic line under the button)"
              field="card_footnote"
              value={footnote}
              setValue={setFootnote}
              placeholder={defaults.footnote}
              onReset={() => handleReset("card_footnote", setFootnote)}
            />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={status === "saving"}>
                {status === "saving" && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save card text
              </Button>
              {status === "saved" && (
                <span className="text-sm text-green-700">Saved.</span>
              )}
              {status !== "idle" &&
                status !== "saving" &&
                status !== "saved" && (
                  <span className="text-sm text-destructive">
                    Error: {status}
                  </span>
                )}
            </div>
          </form>

          <div className="lg:sticky lg:top-4 self-start">
            <CardPreview appBaseUrl={appBaseUrl} text={effective} />
            <p className="mt-2 text-xs text-muted-foreground">
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
  field,
  value,
  setValue,
  placeholder,
  onReset,
  multiline,
}: {
  label: string;
  field: string;
  value: string;
  setValue: (s: string) => void;
  placeholder: string;
  onReset: () => void;
  multiline?: boolean;
}) {
  const overriding = value.trim() !== "";
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={`teacher-${field}`}>{label}</Label>
        {overriding && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-primary hover:underline"
          >
            reset to default
          </button>
        )}
      </div>
      {multiline ? (
        <Textarea
          id={`teacher-${field}`}
          name={field}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          placeholder={placeholder}
        />
      ) : (
        <Input
          id={`teacher-${field}`}
          name={field}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {overriding
          ? "● overriding the default. Empty saves re-inherit."
          : "inherits the school-wide default shown as placeholder above"}
      </p>
    </div>
  );
}
