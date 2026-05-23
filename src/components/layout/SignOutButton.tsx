"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

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
    <Button variant="ghost" size="sm" onClick={handleSignOut}>
      <LogOut className="mr-1 h-4 w-4" />
      <span className="hidden sm:inline">Sign out</span>
      <span className="sm:hidden">Out</span>
    </Button>
  );
}
