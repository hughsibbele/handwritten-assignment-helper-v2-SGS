"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function AutoSubmitToggle({
  assignmentId,
  initial,
  disabled,
}: {
  assignmentId: string;
  initial: boolean;
  disabled: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={on}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.checked;
          setOn(next);
          startTransition(async () => {
            try {
              const res = await fetch(`/api/assignments/${assignmentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ canvas_submit_by_default: next }),
              });
              if (!res.ok) throw new Error();
              router.refresh();
            } catch {
              setOn(!next);
              toast.error("Failed to save");
            }
          });
        }}
        className="h-4 w-4 rounded border-gray-300"
      />
      <span>Auto-submit transcribed work to this assignment</span>
      {pending && <span className="text-xs text-muted-foreground">saving…</span>}
    </label>
  );
}
