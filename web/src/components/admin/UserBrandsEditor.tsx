"use client";

import { useState, useTransition } from "react";
import { setUserBrands } from "@/lib/actions/invite";
import { BrandCheckboxes } from "@/components/admin/BrandCheckboxes";

export function UserBrandsEditor({
  userId,
  brands,
  currentBrands,
}: {
  userId: string;
  brands: string[];
  currentBrands: string[];
}) {
  const [selected, setSelected] = useState<string[]>(currentBrands);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: string[]) {
    setSelected(next);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await setUserBrands(userId, next);
      if (result.ok) {
        setSaved(true);
      } else {
        setError(result.error);
      }
    });
  }

  // Zusammenfassung für den Button (kompakt, statt aller Häkchen).
  const summary =
    selected.length === 0
      ? "Alle Marken"
      : selected.length <= 2
        ? selected.join(", ")
        : `${selected.length} Marken`;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
      >
        <span className="text-neutral-400">🏷</span>
        Marken:{" "}
        <span className="font-medium text-neutral-900">{summary}</span>
        {isPending && <span className="text-xs text-neutral-400">speichert …</span>}
        {saved && !isPending && (
          <span className="text-xs text-green-600">✓</span>
        )}
      </button>
      {error && <p className="mt-1 text-xs text-sdg-red-dark">{error}</p>}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-neutral-900">
                  Marken-Berechtigung
                </h3>
                <p className="mt-1 text-xs text-neutral-500">
                  Für welche Marken darf diese Person Projekte anlegen und sehen?
                  <br />
                  Nichts ausgewählt = alle Marken erlaubt.
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
              <BrandCheckboxes
                brands={brands}
                selected={selected}
                onChange={handleChange}
                disabled={isPending}
              />
            </div>

            <div className="mt-5 flex items-center justify-between">
              <span className="text-xs text-neutral-400">
                {isPending
                  ? "speichert …"
                  : saved
                    ? "Automatisch gespeichert."
                    : "Änderungen werden automatisch gespeichert."}
              </span>
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
