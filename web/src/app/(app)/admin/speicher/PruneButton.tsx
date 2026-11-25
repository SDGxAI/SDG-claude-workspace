"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pruneVersions } from "@/lib/actions/storage";

export function PruneButton({ count }: { count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!window.confirm(`${count} alte Versionen endgültig löschen?`)) return;
    setBusy(true);
    const res = await pruneVersions(true);
    setBusy(false);
    if (!res.ok) window.alert(res.error);
    router.refresh();
  }
  return (
    <button
      onClick={run}
      disabled={busy}
      className="rounded-full bg-sdg-red px-5 py-2.5 text-sm font-semibold text-white hover:bg-sdg-red-dark disabled:opacity-60"
    >
      {busy ? "Räumt auf …" : "Jetzt aufräumen"}
    </button>
  );
}
