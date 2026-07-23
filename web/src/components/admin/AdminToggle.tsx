"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setUserAdmin } from "@/lib/actions/invite";

export function AdminToggle({
  userId,
  email,
  isAdmin,
}: {
  userId: string;
  email: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await setUserAdmin(userId, !isAdmin, password);
      if (result.ok) {
        setOpen(false);
        setPassword("");
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-neutral-500 hover:text-sdg-red"
      >
        {isAdmin ? "Admin-Rechte entziehen" : "Zum Admin machen"}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2">
      <p className="text-xs text-neutral-600">
        Bestätigungspasswort eingeben, um {email}{" "}
        {isAdmin ? "die Admin-Rechte zu entziehen" : "zum Admin zu machen"}:
      </p>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Bestätigungspasswort"
          className="rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-sdg-red"
        />
        <button
          onClick={submit}
          disabled={isPending || !password}
          className="rounded bg-sdg-red px-2 py-1 text-xs font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50"
        >
          Bestätigen
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setPassword("");
            setError(null);
          }}
          className="text-xs text-neutral-500 hover:text-neutral-800"
        >
          Abbrechen
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-sdg-red-dark">{error}</p>}
    </div>
  );
}
