"use client";

import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Image from "next/image";

export default function LoginPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  // Restrict the redirect target to a same-origin path to avoid open-redirect
  // shenanigans — only honor strings starting with "/".
  const rawNext = searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") ? rawNext : "/";

  async function handleGoogleLogin() {
    const callback = new URL("/api/auth/callback", window.location.origin);
    if (next !== "/") callback.searchParams.set("next", next);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
        scopes:
          "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/documents",
        queryParams: {
          access_type: "offline",
        },
      },
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <Image
              src="/ehs-logo.webp"
              alt="Episcopal High School"
              width={280}
              height={80}
              priority
            />
          </div>
          <CardTitle className="text-2xl">Handwritten Assignment Helper</CardTitle>
          <CardDescription>
            Upload your handwritten work and get it transcribed to a Google Doc
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleGoogleLogin} className="w-full" size="lg">
            Sign in with Google
          </Button>
          <p className="mt-4 text-center text-sm text-cool-gray">
            Use your school Google account to sign in
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
