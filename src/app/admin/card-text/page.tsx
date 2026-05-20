import { loadCardTextDefaultsRow } from "@/lib/card-text/resolve";
import { CardTextDefaultsEditor } from "./CardTextDefaultsEditor";

export default async function AdminCardTextPage() {
  const defaults = await loadCardTextDefaultsRow();
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div>
      <CardTextDefaultsEditor initial={defaults} appBaseUrl={appBaseUrl} />
    </div>
  );
}
