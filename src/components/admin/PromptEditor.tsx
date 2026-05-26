"use client";

import { useRef, useState } from "react";
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
    <div className="rounded-md border border-stone-200 bg-white">
      <div className="px-5 pt-5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-base font-medium text-ink leading-snug font-mono">{prompt.key}</div>
            <div className="mt-1 text-sm text-stone-500">
              owner: {prompt.owner} · last saved{" "}
              {new Date(savedAt).toLocaleString()}
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-stone-300 px-2 py-0.5 text-xs text-stone-500">v{version}</span>
        </div>
      </div>
      <div className="px-5">
        <form ref={formRef} onSubmit={(e) => e.preventDefault()}>
          <textarea
            ref={textareaRef}
            name="body"
            defaultValue={prompt.body}
            rows={20}
            className="w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm leading-snug focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon disabled:opacity-50 font-mono text-xs"
          />
        </form>
      </div>
    </div>
  );
}
