"use client";

import { useState } from "react";
import Link from "next/link";
import {
  markAllNotificationsRead,
  type NotificationItem,
} from "@/lib/actions/notifications";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Glocke mit Anzahl ungelesener Mitteilungen + Dropdown-Liste. */
export function NotificationBell({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(items);
  const unread = list.filter((n) => !n.read).length;

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Beim Öffnen als gelesen markieren.
      setList((prev) => prev.map((n) => ({ ...n, read: true })));
      await markAllNotificationsRead();
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-sdg-red"
        title="Mitteilungen"
        aria-label="Mitteilungen"
      >
        <span className="text-lg leading-none">🔔</span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sdg-red px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-lg">
          <div className="border-b border-neutral-100 px-4 py-2 text-sm font-medium text-neutral-700">
            Mitteilungen
          </div>
          {list.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">
              Keine Mitteilungen.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-neutral-100 overflow-y-auto">
              {list.map((n) => {
                const inner = (
                  <div className="px-4 py-3">
                    <p className="text-sm text-neutral-800">{n.body}</p>
                    <p className="mt-1 text-[11px] text-neutral-400">
                      {formatTime(n.createdAt)}
                    </p>
                  </div>
                );
                return (
                  <li key={n.id} className="hover:bg-neutral-50">
                    {n.projectId ? (
                      <Link
                        href={`/projects/${n.projectId}`}
                        onClick={() => setOpen(false)}
                        className="block"
                      >
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
