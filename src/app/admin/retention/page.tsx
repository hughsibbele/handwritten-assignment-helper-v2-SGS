import { createAdminClient } from "@/lib/supabase/admin";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RetentionPanel } from "@/components/admin/retention-panel";

export default async function AdminRetentionPage() {
  const admin = createAdminClient();

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
      <Card>
        <CardHeader>
          <CardTitle>Retention</CardTitle>
          <CardDescription>
            Export submission data to CSV for archival, then hard-delete to
            free up storage at end of year. Delete is irreversible — there&apos;s
            a &ldquo;type DELETE&rdquo; confirm before it runs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <div className="text-muted-foreground">Submissions</div>
              <div className="text-2xl font-semibold">
                {submissionCount ?? 0}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Photo rows</div>
              <div className="text-2xl font-semibold">{photoCount ?? 0}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Oldest submission</div>
              <div className="text-2xl font-semibold">
                {oldest?.created_at
                  ? new Date(oldest.created_at).toLocaleDateString()
                  : "—"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <RetentionPanel />
    </div>
  );
}
