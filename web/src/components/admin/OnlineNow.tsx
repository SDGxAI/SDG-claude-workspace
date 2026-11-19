"use client";

import { useEffect, useState } from "react";
import { getOnlineUsers, type OnlineUser } from "@/lib/actions/presence";

/** Kachel „Gerade online" (aktualisiert sich alle 30 Sekunden). */
export function OnlineNow() {
  const [users, setUsers] = useState<OnlineUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await getOnlineUsers();
      if (!active) return;
      if (res.ok) {
        setUsers(res.users);
        setError(null);
      } else setError(res.error);
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="rounded-3xl border border-white bg-white/90 p-5 shadow-sm" title="Aktiv in den letzten 2 Minuten">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
        Gerade online
      </div>
      <div className="mt-1 text-3xl font-bold tracking-tight text-neutral-900">{users ? users.length : "–"}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {error ? (
          <span className="text-xs text-sdg-red-dark">{error}</span>
        ) : (
          (users ?? []).map((u) => (
            <span key={u.id} title={u.email} className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              {u.label}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
