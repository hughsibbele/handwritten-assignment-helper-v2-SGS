import { createAdminDbClient } from "@/lib/supabase/admin";
import { PromptEditor } from "@/components/admin/PromptEditor";
import { AutoSaveProvider } from "@/components/auto-save/context";

type PromptRow = {
  id: string;
  owner: string;
  key: string;
  body: string;
  version: number;
  updated_at: string;
};

export default async function AdminPromptsPage() {
  const admin = createAdminDbClient();
  const { data: rows } = await admin
    .from("prompts")
    .select("id, owner, key, body, version, updated_at")
    .eq("owner", "handwritten")
    .order("key");

  const prompts = (rows as PromptRow[] | null) ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-stone-200 bg-white">
        <div className="px-5 pt-5">
          <div className="text-base font-medium text-ink leading-snug">Prompts</div>
          <div className="mt-1 text-sm text-stone-500">
            Edit the prompts the app sends to Gemini. Changes propagate within
            ~10 minutes (in-process cache TTL). The version number bumps on
            every save so you can audit drift.
          </div>
        </div>
      </div>
      {prompts.length === 0 ? (
        <div className="rounded-md border border-stone-200 bg-white">
          <div className="px-5 py-8 text-center text-sm text-cool-gray">
            No prompts found. Re-run migration 021 to seed the OCR prompt.
          </div>
        </div>
      ) : (
        <AutoSaveProvider>
          {prompts.map((p) => (
            <PromptEditor key={p.id} prompt={p} />
          ))}
        </AutoSaveProvider>
      )}
    </div>
  );
}
