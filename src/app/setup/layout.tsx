import { redirect } from "next/navigation";
import { getServerDbClient } from "@/lib/supabase/server";
import { BrandHeader } from "@/components/brand/BrandHeader";
import { SignOutButton } from "@/components/layout/SignOutButton";

export default async function SetupLayout({
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

  return (
    <div className="flex min-h-screen flex-col">
      <BrandHeader
        eyebrow="Handwritten Helper · Setup"
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
        Handwritten Helper &middot; Episcopal High School
      </footer>
    </div>
  );
}
