import { redirect } from "next/navigation";
import { getServerDbClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Check if user is a teacher
  const { data: teacher } = await supabase
    .from("teachers")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (teacher) {
    redirect("/teacher/dashboard");
  }

  redirect("/student/dashboard");
}
