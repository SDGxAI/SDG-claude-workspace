"use client";

import type { ProjectRole } from "@/types/database";

export type BrandRoleMap = Record<string, ProjectRole>;

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "Kein Zugriff" },
  { value: "reviewer", label: "Reviewer (kommentieren)" },
  { value: "editor", label: "Editor (bearbeiten)" },
];

/**
 * Zeigt alle Marken mit je einem Rollen-Dropdown. „Kein Zugriff" = die Marke
 * ist nicht im Map enthalten. Gilt für ALLE Projekte der jeweiligen Marke.
 */
export function BrandRoleRows({
  brands,
  value,
  onChange,
  disabled,
}: {
  brands: string[];
  value: BrandRoleMap;
  onChange: (brand: string, role: ProjectRole | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
      {brands.map((brand) => (
        <div
          key={brand}
          className="flex items-center justify-between gap-3 px-3 py-1.5"
        >
          <span className="text-sm text-neutral-800">{brand}</span>
          <select
            value={value[brand] ?? "none"}
            disabled={disabled}
            onChange={(e) =>
              onChange(
                brand,
                e.target.value === "none" ? null : (e.target.value as ProjectRole),
              )
            }
            className={`rounded-lg border px-2 py-1 text-sm outline-none focus:border-sdg-red disabled:opacity-50 ${
              value[brand]
                ? "border-sdg-red bg-sdg-red-light text-sdg-red-dark"
                : "border-neutral-300 bg-white text-neutral-600"
            }`}
          >
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
