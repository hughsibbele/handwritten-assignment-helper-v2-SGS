import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerDbClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/admin";
import { BrandHeader } from "@/components/brand/BrandHeader";
import { SignOutButton } from "@/components/layout/SignOutButton";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Verify teacher role. The /teacher/setup carve-out lives in the proxy;
  // anyone past it without a teacher row got redirected before we got here.
  const { data: teacher } = await supabase
    .from("teachers")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!teacher) {
    redirect("/student/dashboard");
  }

  const viewerIsAdmin = await isAdmin();

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader
        eyebrow="Handwritten Helper · Teacher"
        logoHref="/teacher/dashboard"
        right={
          <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm">
            <Link
              href="/teacher/dashboard"
              className="text-cool-gray transition-colors hover:text-ink"
            >
              Dashboard
            </Link>
            <Link
              href="/teacher/setup"
              className="text-cool-gray transition-colors hover:text-ink"
            >
              Canvas &amp; Drive setup
            </Link>
            {viewerIsAdmin && (
              <Link
                href="/admin/prompts"
                className="rounded-sm border border-maroon/40 px-2 py-0.5 text-xs font-medium text-maroon transition-colors hover:bg-maroon hover:text-white"
                title="School-wide admin console"
              >
                Admin →
              </Link>
            )}
            <span className="hidden text-xs italic text-cool-gray sm:inline">
              {user.email ?? ""}
            </span>
            <SignOutButton />
          </nav>
        }
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-light-blue/40 bg-white/50 px-6 py-3 text-center text-xs italic text-cool-gray">
        Handwritten Helper &middot; Episcopal High School
      </footer>
    </div>
  );
}
