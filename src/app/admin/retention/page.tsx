import { createAdminDbClient } from "@/lib/supabase/admin";
import { RetentionPanel } from "@/components/admin/RetentionPanel";

export default async function AdminRetentionPage() {
  const admin = createAdminDbClient();

  // Headline counts for the panel — total submissions + photo blobs still
  // in storage. The actual filtered list comes from the client component
  // hitting the export/delete routes; this is just the at-a-glance view.
  const { count: submissionCount } = await admin
    .from("submissions")
    .select("id", { count: "exact", head: true });
  const { count: photoCount } = await admin
    .from("submission_photos")
    .select("id", { count: "exact", head: true });
  const { data: oldest } = await admin
    .from("submissions")
    .select("created_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-stone-200 bg-white">
        <div className="px-5 pt-5">
          <div className="text-base font-medium text-ink leading-snug">Retention</div>
          <div className="mt-1 text-sm text-stone-500">
            Export submission data to CSV for archival, then hard-delete to
            free up storage at end of year. Delete is irreversible — there&apos;s
            a &ldquo;type DELETE&rdquo; confirm before it runs.
          </div>
        </div>
        <div className="px-5">
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <div className="text-cool-gray">Submissions</div>
              <div className="text-2xl font-semibold">
                {submissionCount ?? 0}
              </div>
            </div>
            <div>
              <div className="text-cool-gray">Photo rows</div>
              <div className="text-2xl font-semibold">{photoCount ?? 0}</div>
            </div>
            <div>
              <div className="text-cool-gray">Oldest submission</div>
              <div className="text-2xl font-semibold">
                {oldest?.created_at
                  ? new Date(oldest.created_at).toLocaleDateString()
                  : "—"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <RetentionPanel />
    </div>
  );
}
