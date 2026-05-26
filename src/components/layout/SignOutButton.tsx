"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * Sign-out button factored out of the legacy NavBar (M4.12). Layouts pass
 * this into the BrandHeader's `right` slot as part of their per-surface
 * nav so the headers can stay otherwise server-rendered.
 */
export function SignOutButton() {
  const supabase = createClient();
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <button onClick={handleSignOut} className="rounded-md px-2 py-1 text-xs text-stone-600 hover:bg-stone-100 disabled:opacity-50">
      <LogOut className="mr-1 h-4 w-4" />
      <span className="hidden sm:inline">Sign out</span>
      <span className="sm:hidden">Out</span>
    </button>
  );
}
