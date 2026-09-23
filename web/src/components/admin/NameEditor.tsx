"use client";

import { useState, useTransition } from "react";
import { setUserName } from "@/lib/actions/invite";

/** Zeigt/ändert den Anzeigenamen einer Person (für die Anrede). */
export function NameEditor({
  userId,
  currentName,
}: {
  userId: string;
  currentName: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentName ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setUserName(userId, name);
      if (res.ok) setEditing(false);
      else setError(res.error);
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-sm text-neutral-500 hover:text-sdg-red"
        title="Namen bearbeiten"
      >
        {currentName ? (
          <span className="font-medium text-neutral-700">{currentName}</span>
        ) : (
          <span className="italic">Name hinzufügen</span>
        )}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder="Name"
        className="w-40 rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-sdg-red"
      />
      <button
        type="button"
        onClick={save}
        disabled={isPending}
        className="rounded bg-sdg-red px-2 py-1 text-xs font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50"
      >
        {isPending ? "…" : "OK"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        className="text-xs text-neutral-400 hover:text-neutral-700"
      >
        ✕
      </button>
      {error && <span className="text-xs text-sdg-red-dark">{error}</span>}
    </span>
  );
}
