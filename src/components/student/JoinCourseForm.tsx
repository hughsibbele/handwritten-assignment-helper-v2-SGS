"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function JoinCourseForm() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return;

    setLoading(true);
    try {
      const res = await fetch("/api/courses/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinCode: joinCode.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Failed to join course");
        return;
      }

      toast.success(`Joined ${data.course.name}!`);
      setJoinCode("");
      router.refresh();
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        placeholder="Enter class code"
        value={joinCode}
        onChange={(e) => setJoinCode(e.target.value)}
        className="w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-maroon focus:outline-none focus:ring-1 focus:ring-maroon disabled:opacity-50 max-w-xs"
        disabled={loading}
      />
      <button type="submit" disabled={loading || !joinCode.trim()} className="rounded-md bg-maroon px-3 py-1.5 text-sm font-medium text-white hover:bg-maroon-dark disabled:opacity-50">
        {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
        Join
      </button>
    </form>
  );
}
