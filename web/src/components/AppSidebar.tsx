"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SdgLogo } from "@/components/SdgLogo";
import { NotificationBell } from "@/components/NotificationBell";
import type { NotificationItem } from "@/lib/actions/notifications";

/**
 * Navigation links an der Seite (wie bei Chat-Apps): jede Seite ein eigener,
 * klar erkennbarer Punkt. Am Handy als ausklappbares Menü.
 */

const ICONS: Record<string, string> = {
  projects: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  briefings: "M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1zM8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2M8 12h8M8 16h5",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  shop: "M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6 6 18",
  collapse: "M3 4h18v16H3zM9 4v16M16 10l-2 2 2 2",
  expand: "M3 4h18v16H3zM9 4v16M14 10l2 2-2 2",
};

function Icon({ name, className = "h-[18px] w-[18px]" }: { name: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

const NAV_KEY = "sdg-sites-navigation";

interface Props {
  name: string | null;
  email: string;
  isAdmin: boolean;
  avatarUrl: string | null;
  notifications: NotificationItem[];
}

export function AppSidebar({ name, email, isAdmin, avatarUrl, notifications }: Props) {
  const router = useRouter();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // Am Desktop schmal einklappbar (wird im Browser gemerkt).
  const [slim, setSlim] = useState(false);
  useEffect(() => {
    try {
      setSlim(window.localStorage.getItem(NAV_KEY) === "schmal");
    } catch {
      /* ohne Speicher: ausgeklappt */
    }
  }, []);
  function toggleSlim() {
    setSlim((v) => {
      try {
        window.localStorage.setItem(NAV_KEY, v ? "breit" : "schmal");
      } catch {
        /* egal */
      }
      return !v;
    });
  }

  // Menü am Handy nach jedem Seitenwechsel schließen.
  useEffect(() => setOpen(false), [path]);

  async function logout() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const item = (href: string, label: string, icon: string, compact: boolean) => {
    const active = path === href || path.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        title={compact ? label : undefined}
        className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition ${
          active ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:bg-white/70 hover:text-neutral-900"
        }`}
      >
        <span className={active ? "text-sdg-red" : "text-neutral-400 group-hover:text-neutral-600"}>
          <Icon name={icon} />
        </span>
        {!compact && <span className="min-w-0 flex-1 truncate">{label}</span>}
      </Link>
    );
  };

  const display = name?.trim() || email.split("@")[0];

  const panel = (compact: boolean) => (
    <div className="flex h-full flex-col">
      <div className={`flex items-start pb-6 pt-1.5 ${compact ? "justify-center" : "gap-2 pl-3"}`}>
        {!compact && (
          <Link href="/projects" className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
            <SdgLogo className="h-4 w-auto max-w-full" />
            <span className="rounded-full bg-sdg-red-light px-2 py-0.5 text-[11px] font-semibold text-sdg-red">Sites</span>
          </Link>
        )}
        <button
          onClick={toggleSlim}
          title={compact ? "Navigation ausklappen" : "Navigation einklappen"}
          aria-label={compact ? "Navigation ausklappen" : "Navigation einklappen"}
          className="hidden rounded-lg p-1.5 text-neutral-400 transition hover:bg-white hover:text-neutral-700 lg:block"
        >
          <Icon name={compact ? "expand" : "collapse"} />
        </button>
      </div>

      <nav className="space-y-1">
        {item("/projects", "Projekte", "projects", compact)}
        {item("/briefings", "Briefings", "briefings", compact)}
      </nav>

      {isAdmin && (
        <>
          {compact ? (
            <div className="mx-3 my-5 h-px bg-neutral-200" />
          ) : (
            <div className="mt-7 px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Verwaltung</div>
          )}
          <nav className="space-y-1">
            {item("/admin/users", "Nutzer & Rechte", "users", compact)}
            {item("/admin/shopify", "Shopify", "shop", compact)}
          </nav>
        </>
      )}

      <div className="mt-auto space-y-1 pt-6">
        <NotificationBell items={notifications} variant="row" compact={compact} />
        <div className={`flex items-center gap-1 rounded-xl p-1.5 transition hover:bg-white/70 ${compact ? "flex-col" : ""}`}>
          <Link href="/profile" className="flex min-w-0 flex-1 items-center gap-2.5" title="Profil & Passwort">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-orange-200 to-rose-200 text-sm font-semibold text-neutral-700">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                display.charAt(0).toUpperCase()
              )}
            </span>
            {!compact && (
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-neutral-800">{display}</span>
                <span className="block truncate text-[11px] text-neutral-400">{email}</span>
              </span>
            )}
          </Link>
          <button
            onClick={logout}
            title="Abmelden"
            aria-label="Abmelden"
            className="rounded-lg p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800"
          >
            <Icon name="logout" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop: feste Leiste links */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-white/80 bg-white/55 py-5 backdrop-blur-xl transition-[width] duration-200 lg:block ${
          slim ? "w-[4.5rem] px-2" : "w-64 px-3"
        }`}
      >
        {panel(slim)}
      </aside>

      {/* Handy: schmale Leiste oben + ausklappbares Menü */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/80 bg-white/80 px-4 py-2.5 backdrop-blur-xl lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="Menü öffnen" className="-ml-1 rounded-lg p-1.5 text-neutral-700 hover:bg-neutral-100">
          <Icon name="menu" className="h-6 w-6" />
        </button>
        <Link href="/projects" className="flex items-center gap-2">
          <SdgLogo className="h-4 w-auto" />
          <span className="rounded-full bg-sdg-red-light px-2 py-0.5 text-[11px] font-semibold text-sdg-red">Sites</span>
        </Link>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Menü schließen" onClick={() => setOpen(false)} className="absolute inset-0 bg-neutral-900/30 backdrop-blur-sm" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-neutral-50 px-3 py-5 shadow-xl">
            <button onClick={() => setOpen(false)} aria-label="Menü schließen" className="absolute right-3 top-4 rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">
              <Icon name="close" className="h-5 w-5" />
            </button>
            {panel(false)}
          </aside>
        </div>
      )}
    </>
  );
}
