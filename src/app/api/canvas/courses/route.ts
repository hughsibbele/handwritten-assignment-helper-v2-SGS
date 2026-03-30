import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CanvasClient } from "@/lib/canvas/client";

// GET: List available courses from Canvas (no DB writes)
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: teacher } = await admin
    .from("teachers")
    .select("canvas_base_url, canvas_api_token")
    .eq("auth_user_id", user.id)
    .single();

  if (!teacher?.canvas_base_url || !teacher?.canvas_api_token) {
    return NextResponse.json(
      { error: "Canvas not configured" },
      { status: 400 }
    );
  }

  const canvas = new CanvasClient(
    teacher.canvas_base_url,
    teacher.canvas_api_token
  );

  const courses = await canvas.getCourses();
  // Sort by term descending so current courses are first
  const sorted = courses.sort((a, b) => {
    const termA = a.term?.name ?? "";
    const termB = b.term?.name ?? "";
    return termB.localeCompare(termA);
  });
  return NextResponse.json({
    courses: sorted.map((c) => ({
      id: c.id,
      name: c.name,
      term: c.term?.name ?? null,
    })),
  });
}
