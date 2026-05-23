import { NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/admin";
import { invalidatePromptCache } from "@/lib/prompts/load";
import { z } from "zod";

const bodySchema = z.object({
  body: z.string().min(1).max(50_000),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { key } = await params;
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const admin = createAdminDbClient();

  // Read current version to compute the next one atomically-enough for
  // single-admin use. Last-write-wins is fine here — admin is one person.
  const { data: existing } = await admin
    .from("prompts")
    .select("version")
    .eq("owner", "handwritten")
    .eq("key", key)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  const nextVersion = (existing.version ?? 1) + 1;
  const { data: updated, error } = await admin
    .from("prompts")
    .update({
      body: parsed.data.body,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("owner", "handwritten")
    .eq("key", key)
    .select("id, owner, key, body, version, updated_at")
    .single();

  if (error || !updated) {
    console.error("[admin/prompts] update failed", error);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  // Local-worker cache invalidation. Other Fluid Compute workers expire
  // on their own 10-min TTL — acceptable per the contract.
  invalidatePromptCache(key);

  return NextResponse.json({ prompt: updated });
}
