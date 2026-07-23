"use client";

import { useState } from "react";

export function ExportMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-sdg-red hover:text-sdg-red"
      >
        Exportieren ▾
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-64 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg">
          <a
            href={`/projects/${projectId}/export?format=html`}
            className="block rounded px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <span className="font-medium">Als HTML-Datei</span>
            <span className="block text-xs text-neutral-400">
              Eine Datei, Bilder eingebettet (Base64)
            </span>
          </a>
          <a
            href={`/projects/${projectId}/export?format=zip`}
            className="block rounded px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <span className="font-medium">Als ZIP-Archiv</span>
            <span className="block text-xs text-neutral-400">
              HTML + Bilder-Ordner (relative Pfade)
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
