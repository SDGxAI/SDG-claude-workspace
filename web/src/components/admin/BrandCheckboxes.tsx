"use client";

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
  function toggle(brand: string) {
    if (selected.includes(brand)) {
      onChange(selected.filter((b) => b !== brand));
    } else {
      onChange([...selected, brand]);
    }
  }

  const allSelected = brands.length > 0 && brands.every((b) => selected.includes(b));

  return (
    <div>
      <button
        type="button"
        onClick={() => onChange(allSelected ? [] : [...brands])}
        disabled={disabled}
        className="mb-2 text-xs font-medium text-sdg-red hover:text-sdg-red-dark disabled:opacity-50"
      >
        {allSelected ? "Alle abwählen" : "Alle auswählen"}
      </button>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {brands.map((brand) => (
          <label
            key={brand}
            className="flex items-center gap-1.5 text-sm text-neutral-700"
          >
            <input
              type="checkbox"
              checked={selected.includes(brand)}
              onChange={() => toggle(brand)}
              disabled={disabled}
              className="accent-sdg-red"
            />
            {brand}
          </label>
        ))}
      </div>
    </div>
  );
}
