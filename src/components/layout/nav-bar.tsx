"use client";

import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import Link from "next/link";

export function NavBar({
  userEmail,
  role,
}: {
  userEmail: string;
  role: "teacher" | "student";
}) {
  const supabase = createClient();
  const router = useRouter();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  const dashboardPath =
    role === "teacher" ? "/teacher/dashboard" : "/student/dashboard";

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href={dashboardPath} className="flex items-center gap-2">
          <span
            className="text-lg font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <span className="text-primary">EHS</span>{" "}
            <span className="hidden text-foreground sm:inline">
              Assignment Helper
            </span>
          </span>
          {role === "teacher" && (
            <span className="ml-1 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Teacher
            </span>
          )}
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {userEmail}
          </span>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
            <span className="sm:hidden">Out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
