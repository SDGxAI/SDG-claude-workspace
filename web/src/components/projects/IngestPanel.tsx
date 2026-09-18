"use client";

import { useState } from "react";
import {
  regenerateIngestToken,
  revokeIngestToken,
} from "@/lib/actions/ingest-token";

/**
 * Panel „Automatisch aus Claude aktualisieren": zeigt/erzeugt den geheimen
 * Update-Schlüssel eines Projekts und eine fertige Anleitung, mit der ein
 * verbundener Claude die Seite direkt einspielen kann.
 */
export function IngestPanel({
  projectId,
  initialToken,
}: {
  projectId: string;
  initialToken: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(initialToken);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://…";
  const endpoint = `${origin}/api/ingest`;

  const instruction = token
    ? `Aktualisiere die SDG-Landingpage über die App-Schnittstelle: ` +
      `Schicke das fertige, vollständige HTML per HTTP POST an ${endpoint} ` +
      `mit dem Header „Authorization: Bearer ${token}" und dem JSON-Body ` +
      `{"html": "<hier das komplette HTML>"}. Nutze genau diesen Schlüssel und diese Adresse.`
    : "";

  const curl = token
    ? `curl -X POST ${endpoint} \\\n` +
      `  -H "Authorization: Bearer ${token}" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '{"html": "<!doctype html> … "}'`
    : "";

  async function copy(text: string, which: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* Clipboard nicht verfügbar */
    }
  }

  async function generate() {
    setBusy(true);
    const res = await regenerateIngestToken(projectId);
    setBusy(false);
    if (res.ok) {
      setToken(res.token);
      setReveal(true);
    } else {
      window.alert(res.error);
    }
  }

  async function revoke() {
    if (
      !window.confirm(
        "Update-Schlüssel deaktivieren? Danach kann Claude die Seite nicht mehr automatisch aktualisieren, bis ein neuer Schlüssel erzeugt wird.",
      )
    )
      return;
    setBusy(true);
    const res = await revokeIngestToken(projectId);
    setBusy(false);
    if (res.ok) {
      setToken(null);
      setReveal(false);
    } else {
      window.alert(res.error);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-neutral-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-neutral-700 hover:text-sdg-red"
      >
        <span>🔗 Automatisch aus Claude aktualisieren</span>
        <span className="text-neutral-400">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-neutral-200 px-4 py-4 text-sm">
          <p className="mb-3 text-neutral-600">
            Mit dem Update-Schlüssel kann ein verbundener Claude die fertige
            Seite <strong>direkt in dieses Projekt schieben</strong> – ohne
            Speichern und Hochladen. Jeder Import legt automatisch eine Version
            an. Behandle den Schlüssel wie ein Passwort.
          </p>

          {!token ? (
            <button
              type="button"
              onClick={generate}
              disabled={busy}
              className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
            >
              Update-Schlüssel erzeugen
            </button>
          ) : (
            <div className="space-y-4">
              {/* Schlüssel */}
              <div>
                <div className="mb-1 font-medium text-neutral-700">
                  Update-Schlüssel
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded border border-neutral-200 bg-neutral-50 px-2 py-1.5 font-mono text-xs text-neutral-800">
                    {reveal ? token : "•".repeat(24)}
                  </code>
                  <button
                    type="button"
                    onClick={() => setReveal((r) => !r)}
                    className="rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-600 hover:border-sdg-red hover:text-sdg-red"
                  >
                    {reveal ? "Verbergen" : "Anzeigen"}
                  </button>
                  <button
                    type="button"
                    onClick={() => copy(token, "token")}
                    className="rounded border border-neutral-300 px-2 py-1.5 text-xs text-neutral-600 hover:border-sdg-red hover:text-sdg-red"
                  >
                    {copied === "token" ? "Kopiert ✓" : "Kopieren"}
                  </button>
                </div>
              </div>

              {/* Fertige Anleitung für Claude */}
              <div>
                <div className="mb-1 font-medium text-neutral-700">
                  Anleitung für Claude (kopieren und in den Claude-Chat einfügen)
                </div>
                <textarea
                  readOnly
                  rows={4}
                  value={instruction}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full resize-y rounded border border-neutral-200 bg-neutral-50 p-2 font-mono text-xs text-neutral-800"
                />
                <button
                  type="button"
                  onClick={() => copy(instruction, "instruction")}
                  className="mt-1 rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-sdg-red hover:text-sdg-red"
                >
                  {copied === "instruction" ? "Kopiert ✓" : "Anleitung kopieren"}
                </button>
              </div>

              {/* Technische Variante (curl) */}
              <details>
                <summary className="cursor-pointer text-xs text-neutral-500 hover:text-sdg-red">
                  Technische Variante (curl)
                </summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre rounded border border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px] text-neutral-800">
                  {curl}
                </pre>
                <button
                  type="button"
                  onClick={() => copy(curl, "curl")}
                  className="mt-1 rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-sdg-red hover:text-sdg-red"
                >
                  {copied === "curl" ? "Kopiert ✓" : "curl kopieren"}
                </button>
              </details>

              <div className="flex flex-wrap gap-3 border-t border-neutral-100 pt-3">
                <button
                  type="button"
                  onClick={generate}
                  disabled={busy}
                  className="text-xs font-medium text-neutral-600 hover:text-sdg-red disabled:opacity-50"
                >
                  Neuen Schlüssel erzeugen (alten ungültig machen)
                </button>
                <button
                  type="button"
                  onClick={revoke}
                  disabled={busy}
                  className="text-xs font-medium text-neutral-500 hover:text-sdg-red disabled:opacity-50"
                >
                  Deaktivieren
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
