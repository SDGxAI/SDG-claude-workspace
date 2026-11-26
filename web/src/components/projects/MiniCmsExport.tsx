"use client";

import { useEffect, useState } from "react";

interface Issue {
  level: "error" | "warn" | "info";
  text: string;
}

interface Result {
  name: string;
  url: string;
  sizeBytes: number;
  files: number;
  issues: Issue[];
}

const GROUPS: { level: Issue["level"]; title: string; dot: string; box: string }[] = [
  { level: "error", title: "Vor dem Versand erledigen", dot: "bg-red-500", box: "border-red-200 bg-red-50/60" },
  { level: "warn", title: "Bitte prüfen", dot: "bg-amber-400", box: "border-amber-200 bg-amber-50/60" },
  { level: "info", title: "Automatisch erledigt", dot: "bg-neutral-300", box: "border-neutral-200 bg-neutral-50" },
];

function formatMb(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Export für das MiniCMS der Agentur: baut das Projekt im Agentur-Format,
 * zeigt die Prüfung (was vor dem Versand noch fehlt) und den Download.
 */
export function MiniCmsExport({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [state, setState] = useState<"running" | "done" | "error">("running");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let alive = true;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    (async () => {
      try {
        const res = await fetch(`/projects/${projectId}/export/minicms`, { method: "POST" });
        const json = await res.json().catch(() => ({ error: "Der Export hat zu lange gedauert. Bitte noch einmal versuchen." }));
        if (!alive) return;
        if (!res.ok || json.error) {
          setError(json.error ?? "Der Export ist fehlgeschlagen.");
          setState("error");
        } else {
          setResult(json);
          setState("done");
        }
      } catch {
        if (alive) {
          setError("Keine Verbindung. Bitte noch einmal versuchen.");
          setState("error");
        }
      } finally {
        clearInterval(timer);
      }
    })();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId]);

  const errors = result?.issues.filter((i) => i.level === "error").length ?? 0;
  const warnings = result?.issues.filter((i) => i.level === "warn").length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button aria-label="Schließen" onClick={onClose} className="absolute inset-0 bg-neutral-900/30 backdrop-blur-sm" />
      <div className="relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-neutral-100 px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-neutral-900">MiniCMS-Entwurf</h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              Automatisch umgebaute Vorstufe mit Texten in DE/EN/FR. Für die Agentur wird daraus noch ein sauberes Quellprojekt (Twig, SCSS, JS) gebaut.
            </p>
          </div>
          <button onClick={onClose} aria-label="Schließen" className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {state === "running" && (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-200 border-t-sdg-red" />
              <p className="mt-5 font-semibold text-neutral-800">Seite wird umgebaut …</p>
              <p className="mt-1 max-w-sm text-sm text-neutral-500">
                {seconds < 4
                  ? "Texte, Bilder und Skripte werden ins MiniCMS-Format gebracht."
                  : seconds < 40
                    ? "Bilder werden umgewandelt und die Texte ins Englische und Französische übersetzt."
                    : "Fast fertig – die Prüfung läuft."}
              </p>
              <p className="mt-3 text-xs text-neutral-400">{seconds} s · dauert bis zu einer Minute</p>
            </div>
          )}

          {state === "error" && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          )}

          {state === "done" && result && (
            <div className="space-y-4">
              <div
                className={`rounded-2xl p-4 text-sm ${
                  errors ? "bg-red-50 text-red-900" : warnings ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"
                }`}
              >
                <p className="font-semibold">
                  {errors
                    ? `${errors} ${errors === 1 ? "Punkt muss" : "Punkte müssen"} noch erledigt werden.`
                    : warnings
                      ? "Entwurf fertig – bitte die gelben Punkte prüfen."
                      : "Entwurf fertig und geprüft."}
                </p>
                <p className="mt-1 opacity-80">
                  Nicht direkt an die Agentur schicken: Sie braucht echte Quelldateien (Twig mit Daten und Schleifen, SCSS, sauberes JS). Die baut Claude aus diesem Entwurf als eigenes MiniCMS-Projekt.
                </p>
              </div>

              {GROUPS.map((g) => {
                const items = result.issues.filter((i) => i.level === g.level);
                if (!items.length) return null;
                return (
                  <div key={g.level}>
                    <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      <span className={`h-2 w-2 rounded-full ${g.dot}`} />
                      {g.title}
                    </h3>
                    <ul className={`space-y-1.5 rounded-2xl border p-3 text-sm text-neutral-700 ${g.box}`}>
                      {items.map((i, n) => (
                        <li key={n} className="leading-snug">
                          {i.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}

              <p className="text-xs text-neutral-400">
                {result.name}.zip · {result.files} Dateien · {formatMb(result.sizeBytes)} · Link gilt eine Stunde
              </p>
            </div>
          )}
        </div>

        {state !== "running" && (
          <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-6 py-4">
            <button onClick={onClose} className="rounded-full px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-100">
              Schließen
            </button>
            {state === "done" && result && (
              <a
                href={result.url}
                className={`rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm transition ${
                  errors ? "bg-neutral-500 hover:bg-neutral-600" : "bg-sdg-red hover:brightness-95"
                }`}
              >
                {errors ? "Trotzdem herunterladen" : "⬇ ZIP herunterladen"}
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
