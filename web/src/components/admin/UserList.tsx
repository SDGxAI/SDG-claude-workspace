"use client";

import { useState } from "react";
import { InviteForm } from "@/components/admin/InviteForm";
import { RoleButton } from "@/components/admin/RoleButton";
import { NameEditor } from "@/components/admin/NameEditor";
import { DeleteUserButton } from "@/components/admin/DeleteUserButton";
import type { UserRole } from "@/lib/actions/invite";

export interface UserRow {
  id: string;
  name: string | null;
  email: string;
  invited: boolean;
  role: UserRole;
  brands: string[];
  avatarUrl: string | null;
}

const GROUPS: { role: UserRole; title: string; hint: string }[] = [
  { role: "admin", title: "Admins", hint: "Voller Zugriff, verwalten Nutzer" },
  { role: "editor", title: "Editoren", hint: "Bearbeiten Seiten ihrer Marken" },
  { role: "reviewer", title: "Reviewer", hint: "Kommentieren Seiten ihrer Marken" },
];

/** „Person einladen“ als eigenes Fenster. */
export function InviteDialog({ brands }: { brands: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-full bg-sdg-red px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-sdg-red-dark"
      >
        + Person einladen
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/30 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl sm:p-7" onClick={(e) => e.stopPropagation()}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-neutral-900">Person einladen</h2>
                <p className="mt-1 text-sm text-neutral-500">
                  Die Person bekommt eine E-Mail und legt ihren Vornamen und ihr Passwort selbst fest.
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-lg p-1 text-neutral-400 hover:text-neutral-800" aria-label="Schließen">
                ✕
              </button>
            </div>
            <InviteForm brands={brands} onDone={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}

/** Personen nach Rolle gruppiert, mit Suche. */
export function UserList({ users, meId, allBrands }: { users: UserRow[]; meId: string; allBrands: string[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = q ? users.filter((u) => `${u.name ?? ""} ${u.email}`.toLowerCase().includes(q)) : users;

  return (
    <div>
      <div className="relative max-w-sm">
        <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name oder E-Mail suchen …"
          className="w-full rounded-full border border-neutral-200 bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm outline-none transition focus:border-sdg-red focus:ring-4 focus:ring-sdg-red/10"
        />
      </div>

      {shown.length === 0 && <p className="mt-8 text-center text-neutral-500">Niemand gefunden.</p>}

      {GROUPS.map((g) => {
        const rows = shown.filter((u) => u.role === g.role);
        if (rows.length === 0) return null;
        return (
          <section key={g.role} className="mt-8">
            <div className="mb-3 flex items-baseline gap-2 px-1">
              <h2 className="text-lg font-semibold text-neutral-900">{g.title}</h2>
              <span className="text-sm text-neutral-400">
                {rows.length} · {g.hint}
              </span>
            </div>
            <ul className="divide-y divide-neutral-100 overflow-hidden rounded-3xl border border-white bg-white/90 shadow-sm">
              {rows.map((u) => {
                const isSelf = u.id === meId;
                const initial = (u.name?.trim() || u.email).charAt(0).toUpperCase();
                return (
                  <li key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:flex-nowrap">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-orange-200 to-rose-200 font-semibold text-neutral-700">
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initial
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <NameEditor userId={u.id} currentName={u.name} />
                        {isSelf && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">Du</span>}
                        {u.invited && (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Einladung offen</span>
                        )}
                      </div>
                      <div className="truncate text-sm text-neutral-500">{u.email}</div>
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      <RoleButton userId={u.id} allBrands={allBrands} initialRole={u.role} initialBrands={u.brands} isSelf={isSelf} />
                      {isSelf ? <span className="w-8" /> : <DeleteUserButton userId={u.id} email={u.email} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
