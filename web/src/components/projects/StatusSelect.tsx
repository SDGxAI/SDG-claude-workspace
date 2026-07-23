"use client";

import { useState, useTransition } from "react";
import { setProjectStatus } from "@/lib/actions/projects";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/status";
import type { ProjectStatus } from "@/types/database";

export function StatusSelect({
  projectId,
  currentStatus,
}: {
  projectId: string;
  currentStatus: ProjectStatus;
}) {
  const [value, setValue] = useState<ProjectStatus>(currentStatus);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as ProjectStatus;
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await setProjectStatus(projectId, next);
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
        className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-sdg-red focus:ring-2 focus:ring-sdg-red/20 disabled:opacity-50"
      >
        {STATUS_ORDER.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {error && <p className="mt-1 text-xs text-sdg-red-dark">{error}</p>}
    </div>
  );
}
