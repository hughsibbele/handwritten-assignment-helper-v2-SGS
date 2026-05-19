import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { testCanvasConnection } from "@/lib/canvas/connection";
import { z } from "zod";

const bodySchema = z.object({
  canvasBaseUrl: z.string().url(),
  canvasApiToken: z.string().min(1),
});

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const canvasBaseUrl = parsed.data.canvasBaseUrl.replace(/\/+$/, "");
  const canvasApiToken = parsed.data.canvasApiToken;

  const test = await testCanvasConnection(canvasBaseUrl, canvasApiToken);
  if (!test.ok) {
    return NextResponse.json({ error: test.error }, { status: 400 });
  }

  // Upsert teacher record
  const { error } = await supabase.from("teachers").upsert(
    {
      auth_user_id: user.id,
      email: user.email!,
      display_name:
        user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "Teacher",
      canvas_base_url: canvasBaseUrl,
      canvas_api_token: canvasApiToken,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "auth_user_id" }
  );

  if (error) {
    return NextResponse.json(
      { error: "Failed to save teacher config" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
