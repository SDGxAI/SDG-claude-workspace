"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
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

/** Glocke mit Anzahl ungelesener Mitteilungen + Dropdown (einzeln/alle löschbar). */
export function NotificationBell({
  items,
  variant = "icon",
  compact = false,
}: {
  items: NotificationItem[];
  variant?: "icon" | "row";
  /** Nur Symbol (eingeklappte Seitenleiste). */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(items);
  const ref = useRef<HTMLDivElement>(null);
  const unread = list.filter((n) => !n.read).length;

  // Schließen bei Klick außerhalb (nicht beim Löschen im Dropdown).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      setList((prev) => prev.map((n) => ({ ...n, read: true })));
      await markAllNotificationsRead();
    }
  }

  async function remove(id: string) {
    setList((prev) => prev.filter((n) => n.id !== id));
    await deleteNotification(id);
  }

  async function removeAll() {
    if (!window.confirm("Alle Mitteilungen löschen?")) return;
    setList([]);
    await deleteAllNotifications();
  }

  return (
    <div className="relative" ref={ref}>
      {variant === "row" ? (
        <button
          onClick={toggle}
          title="Mitteilungen"
          className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition ${
            open ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-600 hover:bg-white/70 hover:text-neutral-900"
          }`}
        >
          <svg className="h-[18px] w-[18px] text-neutral-400 group-hover:text-neutral-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
          {!compact && <span className="flex-1 text-left">Mitteilungen</span>}
          {unread > 0 &&
            (compact ? (
              <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full border-2 border-white bg-sdg-red" />
            ) : (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sdg-red px-1.5 text-[11px] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ))}
        </button>
      ) : (
        <button
          onClick={toggle}
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
      )}

      {open && (
        <div
          className={`absolute z-50 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl ${
            variant === "row" ? "bottom-full left-0 mb-2 lg:bottom-0 lg:left-full lg:mb-0 lg:ml-3" : "right-0 mt-2"
          }`}
        >
          <div className="flex items-center justify-between border-b border-neutral-100 px-4 py-2">
            <span className="text-sm font-medium text-neutral-700">Mitteilungen</span>
            {list.length > 0 && (
              <button
                type="button"
                onClick={removeAll}
                className="text-xs text-neutral-400 hover:text-sdg-red"
              >
                Alle löschen
              </button>
            )}
          </div>
          {list.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-neutral-500">
              Keine Mitteilungen.
            </p>
          ) : (
            <ul className="max-h-96 divide-y divide-neutral-100 overflow-y-auto">
              {list.map((n) => {
                const inner = (
                  <>
                    <p className="text-sm text-neutral-800">{n.body}</p>
                    <p className="mt-1 text-[11px] text-neutral-400">
                      {formatTime(n.createdAt)}
                    </p>
                  </>
                );
                return (
                  <li key={n.id} className="group flex items-start gap-2 px-4 py-3 hover:bg-neutral-50">
                    {n.projectId || n.type.startsWith("briefing") ? (
                      <Link
                        href={n.projectId ? `/projects/${n.projectId}` : "/briefings"}
                        onClick={() => setOpen(false)}
                        className="block min-w-0 flex-1"
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="min-w-0 flex-1">{inner}</div>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(n.id)}
                      className="shrink-0 rounded p-1 text-neutral-300 hover:bg-neutral-100 hover:text-sdg-red"
                      title="Mitteilung löschen"
                      aria-label="Mitteilung löschen"
                    >
                      ✕
                    </button>
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
