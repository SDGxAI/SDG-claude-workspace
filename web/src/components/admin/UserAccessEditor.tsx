"use client";

import { useState, useTransition } from "react";
import { setUserBrandAccess, type AccessRole } from "@/lib/actions/invite";
import { BrandCheckboxes } from "@/components/admin/BrandCheckboxes";

/**
 * Zugriff einer Person: EINE Rolle (Reviewer/Editor) + die erlaubten Marken.
 * Die Rolle gilt für alle gewählten Marken und alle deren Projekte (auch neue).
 */
export function UserAccessEditor({
  userId,
  allBrands,
  initialRole,
  initialBrands,
}: {
  userId: string;
  allBrands: string[];
  initialRole: AccessRole;
  initialBrands: string[];
}) {
  const [role, setRole] = useState<AccessRole>(initialRole);
  const [brands, setBrands] = useState<string[]>(initialBrands);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function save(nextRole: AccessRole, nextBrands: string[]) {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await setUserBrandAccess(userId, nextRole, nextBrands);
      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  function changeRole(r: AccessRole) {
    setRole(r);
    save(r, brands);
  }
  function changeBrands(next: string[]) {
    setBrands(next);
    save(role, next);
  }

  const roleLabel = role === "editor" ? "Editor" : "Reviewer";
  const summary =
    brands.length === 0
      ? "kein Zugriff"
      : `${roleLabel} · ${
          brands.length === allBrands.length ? "alle Marken" : `${brands.length} Marke(n)`
        }`;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
      >
        <span className="text-neutral-400">🔑</span>
        Zugriff: <span className="font-medium text-neutral-900">{summary}</span>
        {isPending && <span className="text-xs text-neutral-400">speichert …</span>}
        {saved && !isPending && <span className="text-xs text-green-600">✓</span>}
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
              <h3 className="font-semibold text-neutral-900">Zugriff festlegen</h3>
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
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                Rolle
              </label>
              <select
                value={role}
                onChange={(e) => changeRole(e.target.value as AccessRole)}
                disabled={isPending}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red"
              >
                <option value="reviewer">Reviewer (kommentieren)</option>
                <option value="editor">Editor (bearbeiten)</option>
              </select>
              <p className="mt-1 text-xs text-neutral-400">
                Gilt für alle unten gewählten Marken – auch für neue Projekte.
              </p>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-neutral-700">
                Berechtigt für Marken
              </label>
              <BrandCheckboxes
                brands={allBrands}
                selected={brands}
                onChange={changeBrands}
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
