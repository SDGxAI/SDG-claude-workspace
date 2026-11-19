"use client";

/** Mehrfach-Auswahl der Marken als Knöpfe (mit „Alle"-Schnellwahl). */
export function BrandCheckboxes({
  brands,
  selected,
  onChange,
  disabled,
}: {
  brands: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const allSelected = brands.length > 0 && brands.every((b) => selected.includes(b));
  const toggle = (brand: string) =>
    onChange(selected.includes(brand) ? selected.filter((b) => b !== brand) : [...selected, brand]);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {brands.map((brand) => {
          const on = selected.includes(brand);
          return (
            <button
              key={brand}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(brand)}
              disabled={disabled}
              className={`rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"
              }`}
            >
              {on ? "✓ " : ""}
              {brand}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => onChange(allSelected ? [] : [...brands])}
        disabled={disabled}
        className="mt-2.5 text-xs font-semibold text-sdg-red hover:text-sdg-red-dark disabled:opacity-50"
      >
        {allSelected ? "Alle abwählen" : "Alle Marken auswählen"}
      </button>
    </div>
  );
}
