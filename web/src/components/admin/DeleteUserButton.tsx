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
        className="text-xs font-medium text-neutral-500 hover:text-sdg-red disabled:opacity-50"
      >
        {isPending ? "Wird gelöscht …" : "Zugang löschen"}
      </button>
      {error && <p className="mt-1 text-xs text-sdg-red-dark">{error}</p>}
    </div>
  );
}
