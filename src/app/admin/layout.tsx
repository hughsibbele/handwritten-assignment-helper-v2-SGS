import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentTeacher } from "@/lib/auth/teacher";
import { getCurrentAdminEmail } from "@/lib/auth/admin";
import { BrandHeader } from "@/components/brand/BrandHeader";
import { SignOutButton } from "@/components/layout/SignOutButton";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const teacher = await getCurrentTeacher();
  const email = await getCurrentAdminEmail();
  if (!email) redirect("/");

  const nav = (
    <nav className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm">
      <Link
        href="/admin/prompts"
        className="text-ink transition-colors hover:text-dark-blue"
      >
        Prompts
      </Link>
      <Link
        href="/admin/card-text"
        className="text-ink transition-colors hover:text-dark-blue"
      >
        Card text
      </Link>
      <Link
        href="/admin/retention"
        className="text-ink transition-colors hover:text-dark-blue"
      >
        Retention
      </Link>
      <Link
        href="/teacher/dashboard"
        className="text-cool-gray transition-colors hover:text-maroon"
      >
        ← Dashboard
      </Link>
      <span className="text-xs italic text-cool-gray" title={email}>
        {teacher?.display_name ?? email}
      </span>
      <SignOutButton />
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <BrandHeader
        title="Handwritten Assignment Helper"
        logoHref="/admin/prompts"
        ruleClassName="h-0.5 border-0 bg-dark-blue"
        right={nav}
      />

      <main className="flex-1 px-6 py-8">{children}</main>

      <footer className="border-t border-light-blue/40 bg-white/50 px-6 py-3 text-center text-xs italic text-cool-gray">
        Handwritten Assignment Helper &middot; Admin &middot; Episcopal High School
      </footer>
    </div>
  );
}
