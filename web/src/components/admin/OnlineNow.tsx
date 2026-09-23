"use client";

import { useEffect, useState } from "react";
import { getOnlineUsers, type OnlineUser } from "@/lib/actions/presence";

/** Live-Anzeige „Gerade online" (aktualisiert sich alle 30 Sekunden). */
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
      } else {
        setError(res.error);
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4">
      <h2 className="flex items-center gap-2 font-medium text-neutral-900">
        <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-green-500" />
        Gerade online{users ? ` (${users.length})` : ""}
      </h2>
      {error ? (
        <p className="mt-1 text-sm text-sdg-red-dark">{error}</p>
      ) : users === null ? (
        <p className="mt-1 text-sm text-neutral-500">Lädt …</p>
      ) : users.length === 0 ? (
        <p className="mt-1 text-sm text-neutral-500">Aktuell ist niemand in der App aktiv.</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {users.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-sm text-neutral-800 shadow-sm"
              title={u.email}
            >
              <span className="h-2 w-2 rounded-full bg-green-500" />
              {u.label}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-neutral-400">
        Aktiv in den letzten 2 Minuten · aktualisiert sich automatisch.
      </p>
    </section>
  );
}
