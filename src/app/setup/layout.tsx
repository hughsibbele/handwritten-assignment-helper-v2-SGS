import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { NavBar } from "@/components/layout/nav-bar";

export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <NavBar userEmail={user.email ?? ""} role="teacher" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
