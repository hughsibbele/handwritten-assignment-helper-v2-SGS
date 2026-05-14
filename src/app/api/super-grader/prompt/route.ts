import { NextResponse } from "next/server";
import { checkSuperGraderBearer } from "@/lib/peers/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Pull-on-view prompt fetcher. Super-grader renders satellite-owned prompts
 * (read-only from its side) by fetching live from us. Matches the contract's
 * §11 "Handwritten Helper — pull instead of seed" pattern. Cache-Control
 * mirrors super-grader's own /api/prompts response so the prompts dashboard
 * stays responsive.
 */
export async function GET(request: Request) {
  const authFail = checkSuperGraderBearer(request);
  if (authFail) return authFail;

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "key is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("prompts")
    .select("owner, key, body, version")
    .eq("owner", "handwritten")
    .eq("key", key)
    .single();

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(row, {
    headers: { "Cache-Control": "private, max-age=600" },
  });
}
