"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Undo2 } from "lucide-react";
import { toast } from "sonner";

type Prompt = {
  id: string;
  owner: string;
  key: string;
  body: string;
  version: number;
  updated_at: string;
};

export function PromptEditor({ prompt }: { prompt: Prompt }) {
  const [body, setBody] = useState(prompt.body);
  const [version, setVersion] = useState(prompt.version);
  const [savedAt, setSavedAt] = useState(prompt.updated_at);
  const [saving, setSaving] = useState(false);

  const dirty = body !== prompt.body && body.trim().length > 0;

  async function handleSave() {
    setSaving(true);
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
        throw new Error(err.error ?? "Save failed");
      }
      const { prompt: updated } = await res.json();
      setVersion(updated.version);
      setSavedAt(updated.updated_at);
      prompt.body = body;
      toast.success(`Saved (v${updated.version})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

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
      <CardContent className="space-y-3">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={20}
          className="font-mono text-xs"
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBody(prompt.body)}
            disabled={!dirty || saving}
          >
            <Undo2 className="mr-2 h-4 w-4" />
            Discard
          </Button>
          <Button onClick={handleSave} disabled={!dirty || saving} size="sm">
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
