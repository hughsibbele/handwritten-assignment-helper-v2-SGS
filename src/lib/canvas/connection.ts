// Shared Canvas connectivity check used by the save endpoint (validates
// before persisting) and the test endpoint (lets teachers verify their
// token without overwriting the saved value).

export type CanvasConnectionResult =
  | { ok: true; user: { id: number; name: string; email: string | null } }
  | { ok: false; error: string };

export async function testCanvasConnection(
  baseUrl: string,
  token: string,
): Promise<CanvasConnectionResult> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/v1/users/self`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, error: "Could not reach Canvas. Check the URL." };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `Canvas rejected the token (HTTP ${res.status}).`,
    };
  }

  const data = (await res.json().catch(() => null)) as {
    id?: number;
    name?: string;
    primary_email?: string | null;
  } | null;

  if (!data || typeof data.id !== "number") {
    return { ok: false, error: "Unexpected response from Canvas." };
  }

  return {
    ok: true,
    user: {
      id: data.id,
      name: data.name ?? "Unknown user",
      email: data.primary_email ?? null,
    },
  };
}
