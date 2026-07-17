"use client";

import { useState, useTransition } from "react";
import { setProjectRole } from "@/lib/actions/members";
import type { ProjectRole } from "@/types/database";

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "none", label: "Kein Zugriff" },
  { value: "editor", label: "Editor (darf bearbeiten)" },
  { value: "reviewer", label: "Reviewer (darf kommentieren)" },
  { value: "viewer", label: "Viewer (darf nur ansehen)" },
];

export function RoleSelect({
  projectId,
  userId,
  currentRole,
}: {
  projectId: string;
  userId: string;
  currentRole: ProjectRole | null;
}) {
  const [value, setValue] = useState<string>(currentRole ?? "none");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newValue = e.target.value;
    const previous = value;
    setValue(newValue);
    setError(null);

    startTransition(async () => {
      const result = await setProjectRole(
        projectId,
        userId,
        newValue === "none" ? null : (newValue as ProjectRole),
      );
      if (!result.ok) {
        setValue(previous);
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <select
        value={value}
        onChange={handleChange}
        disabled={isPending}
        className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900 outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 disabled:opacity-50"
      >
        {ROLE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-sdg-red-dark">{error}</p>}
    </div>
  );
}
