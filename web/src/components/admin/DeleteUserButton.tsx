"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteUser } from "@/lib/actions/invite";

export function DeleteUserButton({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (
      !window.confirm(
        `Möchtest du ${email} wirklich vollständig löschen? Der Zugang und alle Rollen werden entfernt.`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteUser(userId);
      if (result.ok) {
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="text-right">
      <button
        onClick={handleClick}
        disabled={isPending}
        title="Zugang löschen"
        aria-label={`Zugang von ${email} löschen`}
        className="rounded-lg p-2 text-neutral-300 transition hover:bg-sdg-red-light hover:text-sdg-red disabled:opacity-50"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
      {error && <p className="mt-1 text-xs text-sdg-red-dark">{error}</p>}
    </div>
  );
}
