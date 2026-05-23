import { NextResponse } from "next/server";
import { createAdminDbClient } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/auth/admin";
import { z } from "zod";

const bodySchema = z.object({
  beforeDate: z.string().nullable().optional(),
});

const CHUNK = 200;

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const before = parsed.data.beforeDate || null;

  const admin = createAdminDbClient();

  // Step 1: list the submission ids in scope. We pull ids in one shot
  // (cheap, even at scale) so the chunked deletes below have a stable target
  // and don't keep growing as cascades happen.
  let listQuery = admin.from("submissions").select("id");
  if (before) listQuery = listQuery.lt("created_at", before);
  const { data: subRows, error: listErr } = await listQuery;
  if (listErr) {
    console.error("[admin/retention/delete] list failed", listErr);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
  const submissionIds = ((subRows ?? []) as { id: string }[]).map((r) => r.id);

  if (submissionIds.length === 0) {
    return NextResponse.json({ deletedSubmissions: 0, deletedPhotos: 0 });
  }

  // Step 2: pull every photo's storage_path so we can delete the actual
  // bucket objects after the DB rows go. Storage and DB live on separate
  // backends; cascading the DB row doesn't free the photo blob.
  const storagePaths: string[] = [];
  for (let i = 0; i < submissionIds.length; i += CHUNK) {
    const chunk = submissionIds.slice(i, i + CHUNK);
    const { data: photos } = await admin
      .from("submission_photos")
      .select("storage_path")
      .in("submission_id", chunk);
    for (const p of (photos ?? []) as { storage_path: string | null }[]) {
      if (p.storage_path) storagePaths.push(p.storage_path);
    }
  }

  // Step 3: delete storage objects in chunks (Supabase storage.remove accepts
  // an array but a giant array can time out — same logic as the DB deletes).
  for (let i = 0; i < storagePaths.length; i += CHUNK) {
    const chunk = storagePaths.slice(i, i + CHUNK);
    const { error: storageErr } = await admin.storage
      .from("submission-photos")
      .remove(chunk);
    if (storageErr) {
      // Logged but not fatal — orphan blobs are recoverable later; failing
      // halfway through would leave DB rows pointing at gone files which is
      // worse than the inverse.
      console.error("[admin/retention/delete] storage remove failed", storageErr);
    }
  }

  // Step 4: delete DB rows. submission_photos has ON DELETE CASCADE from
  // submissions, so dropping submissions handles both — but we still chunk
  // it to stay under the statement timeout on big batches.
  let deletedSubmissions = 0;
  for (let i = 0; i < submissionIds.length; i += CHUNK) {
    const chunk = submissionIds.slice(i, i + CHUNK);
    const { error, count } = await admin
      .from("submissions")
      .delete({ count: "exact" })
      .in("id", chunk);
    if (error) {
      console.error("[admin/retention/delete] submission chunk failed", error);
      return NextResponse.json(
        { error: "Delete failed midway", deletedSubmissions },
        { status: 500 },
      );
    }
    deletedSubmissions += count ?? 0;
  }

  return NextResponse.json({
    deletedSubmissions,
    deletedPhotos: storagePaths.length,
  });
}
