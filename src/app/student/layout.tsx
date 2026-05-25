import { getServerDbClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BrandHeader } from "@/components/brand/BrandHeader";
import { SignOutButton } from "@/components/layout/SignOutButton";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Don't use getCurrentStudent() here — a freshly-signed-in EHS user
  // who hasn't been roster-synced has no students row yet, and the
  // join-via-class-code flow on /student/dashboard is what creates one.
  // Just require a session.
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <BrandHeader
        title="Handwritten Assignment Helper"
        logoHref="/student/dashboard"
        right={
          <nav className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-sm">
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
        Handwritten Assignment Helper &middot; Episcopal High School
      </footer>
    </div>
  );
}
