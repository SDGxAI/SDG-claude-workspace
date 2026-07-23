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

  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-medium text-neutral-500">
        Berechtigt für Firma/Marke{" "}
        <span className="font-normal">(nichts = alle Marken)</span>
        {isPending && <span className="ml-2 text-neutral-400">speichert …</span>}
        {saved && !isPending && (
          <span className="ml-2 text-green-600">gespeichert</span>
        )}
      </p>
      <BrandCheckboxes
        brands={brands}
        selected={selected}
        onChange={handleChange}
        disabled={isPending}
      />
      {error && <p className="mt-1 text-xs text-sdg-red-dark">{error}</p>}
    </div>
  );
}
