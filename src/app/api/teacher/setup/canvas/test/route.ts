import { NextResponse } from "next/server";
import { getServerDbClient } from "@/lib/supabase/server";
import { testCanvasConnection } from "@/lib/canvas/connection";
import { z } from "zod";

const bodySchema = z.object({
  canvasBaseUrl: z.string().url(),
  canvasApiToken: z.string().min(1),
});

export async function POST(request: Request) {
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const result = await testCanvasConnection(
    parsed.data.canvasBaseUrl.replace(/\/+$/, ""),
    parsed.data.canvasApiToken,
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true, user: result.user });
}
