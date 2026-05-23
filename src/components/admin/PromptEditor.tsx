"use client";

import { useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAutoSaveDispatch } from "@/components/auto-save/context";
import { useAutoSaveForm } from "@/components/auto-save/use-auto-save-form";

type Prompt = {
  id: string;
  owner: string;
  key: string;
  body: string;
  version: number;
  updated_at: string;
};

export function PromptEditor({ prompt }: { prompt: Prompt }) {
  const [version, setVersion] = useState(prompt.version);
  const [savedAt, setSavedAt] = useState(prompt.updated_at);
  const dispatch = useAutoSaveDispatch();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function save() {
    const body = textareaRef.current?.value ?? "";
    if (!body.trim()) {
      dispatch({ kind: "error", msg: "Prompt body cannot be empty" });
      return;
    }
    dispatch({ kind: "saving" });
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/prompts/${encodeURIComponent(prompt.key)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          dispatch({
            kind: "error",
            msg: err.error ?? `Save failed (${res.status})`,
          });
          return;
        }
        const { prompt: updated } = (await res.json()) as {
          prompt: { version: number; updated_at: string; body: string };
        };
        setVersion(updated.version);
        setSavedAt(updated.updated_at);
        // Realign the textarea's defaultValue so isFormDirty stops
        // reporting the field as dirty after a clean save. React
        // doesn't sync defaultValue on re-render, so we touch the DOM
        // directly here.
        if (textareaRef.current) {
          textareaRef.current.defaultValue = updated.body;
        }
        dispatch({ kind: "saved", at: Date.now() });
      } catch (err) {
        dispatch({
          kind: "error",
          msg: err instanceof Error ? err.message : "Save failed",
        });
      }
    })();
  }

  useAutoSaveForm({ formRef, save, freshnessKey: prompt.updated_at });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="font-mono text-base">{prompt.key}</CardTitle>
            <CardDescription>
              owner: {prompt.owner} · last saved{" "}
              {new Date(savedAt).toLocaleString()}
            </CardDescription>
          </div>
          <Badge variant="outline">v{version}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
          <Textarea
            ref={textareaRef}
            name="body"
            defaultValue={prompt.body}
            rows={20}
            className="font-mono text-xs"
          />
        </form>
      </CardContent>
    </Card>
  );
}
