"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUserRole, type UserRole } from "@/lib/actions/invite";
import { BrandCheckboxes } from "@/components/admin/BrandCheckboxes";

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  editor: "Editor",
  reviewer: "Reviewer",
};

/**
 * Button mit der Rolle einer Person (Admin / Editor / Reviewer). Klick öffnet
 * ein Fenster, in dem Rolle und – für Reviewer/Editor – die Marken geändert
 * werden. Die eigene Rolle ist nicht änderbar.
 */
export function RoleButton({
  userId,
  allBrands,
  initialRole,
  initialBrands,
  isSelf,
}: {
  userId: string;
  allBrands: string[];
  initialRole: UserRole;
  initialBrands: string[];
  isSelf: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<UserRole>(initialRole);
  const [brands, setBrands] = useState<string[]>(initialBrands);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const summary =
    initialRole === "admin"
      ? "Admin"
      : initialBrands.length === 0
        ? `${ROLE_LABEL[initialRole]} · kein Zugriff`
        : `${ROLE_LABEL[initialRole]} · ${
            initialBrands.length === allBrands.length
              ? "alle Marken"
              : `${initialBrands.length} Marke(n)`
          }`;

  function openModal() {
    setRole(initialRole);
    setBrands(initialBrands);
    setError(null);
    setOpen(true);
  }

  function save() {
    if (
      role === "admin" &&
      initialRole !== "admin" &&
      !window.confirm(
        "Diese Person zum Admin machen? Admins haben vollen Zugriff auf alle Projekte und können Nutzer verwalten.",
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await setUserRole(userId, role, brands);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  const colors =
    initialRole === "admin"
      ? "border-sdg-red bg-sdg-red-light text-sdg-red-dark"
      : initialRole === "editor"
        ? "border-neutral-800 bg-neutral-800 text-white"
        : "border-neutral-300 bg-white text-neutral-700";

  return (
    <>
      <button
        type="button"
        onClick={isSelf ? undefined : openModal}
        disabled={isSelf}
        title={isSelf ? "Deine eigene Rolle kannst du nicht ändern" : "Rolle ändern"}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-sm font-medium transition-opacity ${colors} ${
          isSelf ? "cursor-default" : "hover:opacity-80"
        }`}
      >
        {summary}
        {!isSelf && <span className="text-xs opacity-70">▾</span>}
      </button>

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
              <h3 className="font-semibold text-neutral-900">Rolle festlegen</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-neutral-400 hover:text-neutral-700"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {(["reviewer", "editor", "admin"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${
                    role === r
                      ? "border-sdg-red bg-sdg-red text-white"
                      : "border-neutral-300 text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
                  }`}
                >
                  {ROLE_LABEL[r]}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {role === "admin"
                ? "Voller Zugriff auf alle Projekte, darf Nutzer und Rollen verwalten."
                : role === "editor"
                  ? "Darf Seiten der gewählten Marken bearbeiten und kommentieren."
                  : "Darf Seiten der gewählten Marken ansehen und kommentieren."}
            </p>

            {role !== "admin" && (
              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium text-neutral-700">
                  Berechtigt für Marken
                </label>
                <BrandCheckboxes
                  brands={allBrands}
                  selected={brands}
                  onChange={setBrands}
                  disabled={isPending}
                />
                <p className="mt-1 text-xs text-neutral-400">
                  Gilt für alle Projekte dieser Marken – auch neue.
                </p>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-sdg-red-dark">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-500 hover:text-neutral-800"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={save}
                disabled={isPending}
                className="rounded-lg bg-sdg-red px-4 py-1.5 text-sm font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50"
              >
                {isPending ? "Speichert …" : "Speichern"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
