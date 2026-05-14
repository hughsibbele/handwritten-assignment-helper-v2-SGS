import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Admin shell. The proxy guards this whole subtree against the ADMIN_EMAILS
 * env-var allowlist — see src/lib/supabase/proxy.ts. There's intentionally
 * no per-route auth check here.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Admin
          </p>
          <h1 className="text-2xl font-bold">Handwritten Helper</h1>
        </div>
        <nav className="flex gap-2">
          <Link href="/admin/prompts">
            <Button variant="ghost" size="sm">
              Prompts
            </Button>
          </Link>
          <Link href="/admin/retention">
            <Button variant="ghost" size="sm">
              Retention
            </Button>
          </Link>
          <Link href="/teacher/dashboard">
            <Button variant="outline" size="sm">
              Back to dashboard
            </Button>
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
