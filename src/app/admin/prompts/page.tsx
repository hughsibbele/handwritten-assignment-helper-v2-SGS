import { createAdminClient } from "@/lib/supabase/admin";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PromptEditor } from "@/components/admin/prompt-editor";

type PromptRow = {
  id: string;
  owner: string;
  key: string;
  body: string;
  version: number;
  updated_at: string;
};

export default async function AdminPromptsPage() {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("prompts")
    .select("id, owner, key, body, version, updated_at")
    .eq("owner", "handwritten")
    .order("key");

  const prompts = (rows as PromptRow[] | null) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Prompts</CardTitle>
          <CardDescription>
            Edit the prompts the app sends to Gemini. Changes propagate within
            ~10 minutes (in-process cache TTL). The version number bumps on
            every save so you can audit drift.
          </CardDescription>
        </CardHeader>
      </Card>
      {prompts.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No prompts found. Re-run migration 021 to seed the OCR prompt.
          </CardContent>
        </Card>
      ) : (
        prompts.map((p) => <PromptEditor key={p.id} prompt={p} />)
      )}
    </div>
  );
}
