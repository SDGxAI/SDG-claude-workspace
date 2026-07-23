"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteProject } from "@/lib/actions/projects";

export function DeleteProjectButton({
  projectId,
  title,
}: {
  projectId: string;
  title: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (
      !window.confirm(
        `Möchtest du das Projekt „${title}“ wirklich löschen? Alle Inhalte, Snapshots und Kommentare gehen dabei verloren.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteProject(projectId);
      if (result.ok) {
        router.push("/projects");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={isPending}
        className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:border-sdg-red hover:text-sdg-red disabled:opacity-50"
      >
        {isPending ? "Wird gelöscht …" : "Projekt löschen"}
      </button>
      {error && <p className="mt-1 text-xs text-sdg-red-dark">{error}</p>}
    </>
  );
}
