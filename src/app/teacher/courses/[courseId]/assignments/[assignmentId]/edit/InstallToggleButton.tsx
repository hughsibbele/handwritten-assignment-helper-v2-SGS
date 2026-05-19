"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InstallToggleButton({
  assignmentId,
  installed,
  disabled,
}: {
  assignmentId: string;
  installed: boolean;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function flip() {
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/teacher/assignments/${assignmentId}/install`,
          { method: installed ? "DELETE" : "POST" },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Install failed");
        }
        toast.success(
          installed
            ? "Card removed from Canvas"
            : "Card installed on Canvas",
        );
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Install failed");
      }
    });
  }

  return (
    <Button
      variant={installed ? "outline" : "default"}
      size="sm"
      onClick={flip}
      disabled={disabled || pending}
    >
      {pending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
      {installed ? "Uninstall card" : "Install card"}
    </Button>
  );
}
