import Link from "next/link";
import { isAdmin } from "@/lib/auth/admin";
import { getCurrentTeacher } from "@/lib/auth/teacher";
import { getServerDbClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/brand/BrandHeader";
import { SignOutButton } from "@/components/layout/SignOutButton";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // M4.11d: layout no longer redirects on missing teacher row. The proxy
  // already gates every /teacher/* path (except /teacher/setup) to
  // require a teacher row, so removing the layout check is safe and lets
  // first-time users hit /teacher/setup with their session intact. The
  // setup page handles the no-teacher-row case itself (showing only the
  // Canvas connection section until the row is created).
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const teacher = await getCurrentTeacher();
  const viewerIsAdmin = teacher ? await isAdmin() : false;

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <BrandHeader
        title="Handwritten Assignment Helper"
        logoHref="/teacher/dashboard"
        right={
          <nav className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm">
            <Link
              href="/teacher/dashboard"
              className="text-ink transition-colors hover:text-maroon"
            >
              Dashboard
            </Link>
            <Link
              href="/teacher/setup"
              className="text-ink transition-colors hover:text-maroon"
            >
              Canvas &amp; Drive
            </Link>
            {viewerIsAdmin && (
              <Link
                href="/admin/prompts"
                className="rounded-sm border border-dark-blue/40 px-2 py-0.5 text-xs font-medium text-dark-blue transition-colors hover:bg-dark-blue hover:text-white"
                title="School-wide admin console"
              >
                Admin →
              </Link>
            )}
            <span className="hidden text-xs italic text-cool-gray sm:inline">
              {teacher?.email ?? user.email ?? ""}
            </span>
            <SignOutButton />
          </nav>
        }
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-light-blue/40 bg-white/50 px-6 py-3 text-center text-xs italic text-cool-gray">
        Handwritten Assignment Helper &middot; Episcopal High School
      </footer>
    </div>
  );
}
