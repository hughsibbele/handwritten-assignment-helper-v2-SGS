import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { NavBar } from "@/components/layout/nav-bar";

export default async function TeacherLayout({
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

  // Verify teacher role
  const { data: teacher } = await supabase
    .from("teachers")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!teacher) {
    redirect("/student/dashboard");
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
