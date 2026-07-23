"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AppHeader({
  email,
  isAdmin,
}: {
  email: string;
  isAdmin: boolean;
}) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/projects" className="flex items-center gap-2">
          <span className="inline-block h-6 w-6 rounded bg-sdg-red" aria-hidden />
          <span className="font-semibold text-neutral-900">
            SDG Landingpage-Editor
          </span>
        </Link>

        <nav className="flex items-center gap-4 text-sm text-neutral-600">
          <Link href="/projects" className="hover:text-sdg-red">
            Projekte
          </Link>
          {isAdmin && (
            <Link href="/admin/users" className="hover:text-sdg-red">
              Nutzer &amp; Rechte
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link
            href="/profile"
            className="text-neutral-600 hover:text-sdg-red"
            title="Profil & Passwort"
          >
            {email}
          </Link>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-neutral-700 transition-colors hover:border-sdg-red hover:text-sdg-red"
          >
            Abmelden
          </button>
        </div>
      </div>
    </header>
  );
}
