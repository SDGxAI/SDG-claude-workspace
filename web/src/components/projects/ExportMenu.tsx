"use client";

import { useState } from "react";
import { MiniCmsExport } from "@/components/projects/MiniCmsExport";

const button =
  "inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50";

/**
 * Seite herunterladen: als HTML-Datei für alle (zum Anschauen im Browser),
 * zusätzlich als ZIP-Archiv und im MiniCMS-Format für die Agentur – nur Admins.
 */
export function ExportMenu({ projectId, isAdmin }: { projectId: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [miniCms, setMiniCms] = useState(false);
  const html = `/projects/${projectId}/export?format=html`;

  if (!isAdmin) {
    return (
      <a href={html} className={button} title="Die Seite als Datei herunterladen und im Browser öffnen">
        ⬇ Als HTML herunterladen
      </a>
    );
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} onBlur={() => setTimeout(() => setOpen(false), 150)} className={button}>
        ⬇ Exportieren ▾
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-72 rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-xl">
          <a href={html} className="block rounded-xl px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
            <span className="font-medium">Als HTML-Datei</span>
            <span className="block text-xs text-neutral-400">Eine Datei, Bilder eingebettet – für alle</span>
          </a>
          <a href={`/projects/${projectId}/export?format=zip`} className="block rounded-xl px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
            <span className="font-medium">Als ZIP-Archiv</span>
            <span className="block text-xs text-neutral-400">HTML + Bilder-Ordner – nur für Admins</span>
          </a>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(false);
              setMiniCms(true);
            }}
            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
          >
            <span className="font-medium">Für die Agentur (MiniCMS)</span>
            <span className="block text-xs text-neutral-400">Fertiges Projekt im MiniCMS-Format, DE/EN/FR, mit Prüfung</span>
          </button>
        </div>
      )}
      {miniCms && <MiniCmsExport projectId={projectId} onClose={() => setMiniCms(false)} />}
    </div>
  );
}
