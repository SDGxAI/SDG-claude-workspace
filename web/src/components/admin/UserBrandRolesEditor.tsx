"use client";

import { useState, useTransition } from "react";
import { setUserBrandRole } from "@/lib/actions/invite";
import { BrandRoleRows, type BrandRoleMap } from "@/components/admin/BrandRoleRows";
import type { ProjectRole } from "@/types/database";

/**
 * Marken-Rollen einer Person bearbeiten (gilt automatisch für alle Projekte
 * der Marke). Änderungen werden sofort gespeichert.
 */
export function UserBrandRolesEditor({
  userId,
  brands,
  current,
}: {
  userId: string;
  brands: string[];
  current: BrandRoleMap;
}) {
  const [map, setMap] = useState<BrandRoleMap>(current);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function change(brand: string, role: ProjectRole | null) {
    setMap((prev) => {
      const next = { ...prev };
      if (role === null) delete next[brand];
      else next[brand] = role;
      return next;
    });
    setError(null);
    startTransition(async () => {
      const res = await setUserBrandRole(userId, brand, role);
      if (!res.ok) setError(res.error);
    });
  }

  const active = Object.keys(map);
  const summary =
    active.length === 0
      ? "Keine Marken"
      : active.length <= 2
        ? active.join(", ")
        : `${active.length} Marken`;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
      >
        <span className="text-neutral-400">🏷</span>
        Marken &amp; Rollen:{" "}
        <span className="font-medium text-neutral-900">{summary}</span>
        {isPending && <span className="text-xs text-neutral-400">speichert …</span>}
      </button>
      {error && <p className="mt-1 text-xs text-sdg-red-dark">{error}</p>}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-neutral-900">
                  Marken &amp; Rollen
                </h3>
                <p className="mt-1 text-xs text-neutral-500">
                  Die Rolle gilt automatisch für ALLE Projekte der Marke – auch
                  für neue. Änderungen werden sofort gespeichert.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-neutral-400 hover:text-neutral-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <BrandRoleRows
                brands={brands}
                value={map}
                onChange={change}
                disabled={isPending}
              />
            </div>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-sdg-red px-4 py-1.5 text-sm font-medium text-white hover:bg-sdg-red-dark"
              >
                Fertig
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
