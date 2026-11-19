"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SdgLogo } from "@/components/SdgLogo";
import { NotificationBell } from "@/components/NotificationBell";
import type { NotificationItem } from "@/lib/actions/notifications";

export function AppHeader({
  email,
  isAdmin,
  avatarUrl,
  notifications,
}: {
  email: string;
  isAdmin: boolean;
  avatarUrl: string | null;
  notifications: NotificationItem[];
}) {
  const router = useRouter();
  const path = usePathname();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const links = [
    { href: "/projects", label: "Projekte" },
    { href: "/briefings", label: "Briefings" },
    ...(isAdmin
      ? [
          { href: "/admin/users", label: "Nutzer & Rechte" },
          { href: "/admin/shopify", label: "Shopify" },
        ]
      : []),
  ];

  return (
    <header className="sticky top-0 z-20 border-b border-white/60 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <Link href="/projects" className="flex shrink-0 items-center gap-2.5">
          <SdgLogo className="h-6 w-auto" />
          <span className="hidden rounded-full bg-sdg-red-light px-2 py-0.5 text-xs font-semibold text-sdg-red sm:inline">
            Sites
          </span>
        </Link>

        <nav className="-mx-1 order-last flex w-full items-center gap-1 overflow-x-auto px-1 text-sm md:order-none md:mx-0 md:w-auto md:px-0">
          {links.map((l) => {
            const active = path === l.href || path.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`whitespace-nowrap rounded-full px-3.5 py-1.5 font-medium transition-colors ${
                  active ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 text-sm">
          <NotificationBell items={notifications} />
          <Link
            href="/profile"
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 text-neutral-600 transition-colors hover:bg-neutral-100 sm:pr-3"
            title="Profil & Passwort"
          >
            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-orange-200 to-rose-200 text-xs font-semibold text-neutral-700">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Profilbild" className="h-full w-full object-cover" />
              ) : (
                email.charAt(0).toUpperCase()
              )}
            </span>
            <span className="hidden max-w-[12rem] truncate lg:inline">{email}</span>
          </Link>
          <button
            onClick={handleLogout}
            title="Abmelden"
            className="rounded-full px-3 py-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900"
          >
            <span className="hidden sm:inline">Abmelden</span>
            <svg className="h-4 w-4 sm:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Abmelden">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
