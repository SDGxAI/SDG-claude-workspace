"use client";

import { useState } from "react";
import {
  getAnnounceRecipients,
  sendAnnouncement,
  rewriteAnnouncementText,
  type Recipient,
} from "@/lib/actions/announce";

/** Fertige Vorlagen zum Anklicken (nur diese Art von Infos verschicken wir). */
const PRESETS = [
  "Dein Kommentar wurde bearbeitet.",
  "Eine neue Version ist online – schau sie dir bitte an.",
  "Bitte gib dein Feedback zur aktuellen Version.",
];

/**
 * Admin-Funktion „📣 Mitteilung senden": kurze Nachricht an ausgewählte
 * Projektbeteiligte (Glocke, optional zusätzlich E-Mail).
 */
export function AnnounceButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [rewriting, setRewriting] = useState(false);

  async function rewrite() {
    if (!body.trim()) return;
    setRewriting(true);
    const res = await rewriteAnnouncementText(projectId, body);
    setRewriting(false);
    if (res.ok) setBody(res.text);
    else window.alert(res.error);
  }

  async function openModal() {
    setOpen(true);
    setLoading(true);
    const list = await getAnnounceRecipients(projectId);
    // Alphabetisch nach Name (sonst E-Mail); nichts vorausgewählt.
    list.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "de"));
    setRecipients(list);
    setSelected(new Set());
    setQuery("");
    setLoading(false);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Suche nach Name oder E-Mail.
  const q = query.trim().toLowerCase();
  const visibleRecipients = q
    ? recipients.filter(
        (r) =>
          (r.name ?? "").toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
      )
    : recipients;

  async function send() {
    setBusy(true);
    const res = await sendAnnouncement(projectId, body, [...selected]);
    setBusy(false);
    if (res.ok) {
      window.alert(
        `Mitteilung gesendet${res.emailNote ? ` – ${res.emailNote}` : ""}.`,
      );
      setOpen(false);
      setBody("");
    } else {
      window.alert(res.error);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:border-sdg-red hover:text-sdg-red"
      >
        📣 Mitteilung
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-lg font-semibold text-neutral-900">
              Mitteilung senden
            </h2>
            <p className="mb-3 text-sm text-neutral-500">
              Geht per E-Mail an die ausgewählten Personen (und zusätzlich in
              die 🔔 Glocke der App).
            </p>

            {/* Vorlagen zum Anklicken */}
            <div className="mb-2 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setBody(p)}
                  className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 hover:border-sdg-red hover:text-sdg-red"
                >
                  {p}
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Vorlage wählen – oder Stichpunkte tippen und „✨ KI-Umformulieren“ drücken."
              className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red"
            />
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={rewrite}
                disabled={rewriting || !body.trim()}
                className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:border-sdg-red hover:text-sdg-red disabled:opacity-50"
                title="Stichpunkte in eine schöne Nachricht umformulieren"
              >
                {rewriting ? "KI schreibt …" : "✨ KI-Umformulieren"}
              </button>
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-700">
                  Empfänger{selected.size > 0 ? ` (${selected.size} ausgewählt)` : ""}
                </span>
                {recipients.length > 0 && (
                  <span className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setSelected(new Set(recipients.map((r) => r.id)))}
                      className="text-xs font-medium text-sdg-red hover:text-sdg-red-dark"
                      title="Alle Personen mit Zugriff auf dieses Projekt auswählen"
                    >
                      Alle auswählen
                    </button>
                    {selected.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelected(new Set())}
                        className="text-xs text-neutral-500 hover:text-sdg-red"
                      >
                        Auswahl leeren
                      </button>
                    )}
                  </span>
                )}
              </div>
              {recipients.length > 0 && (
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name oder E-Mail suchen …"
                  className="mb-2 w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-sdg-red"
                />
              )}
              {loading ? (
                <p className="text-sm text-neutral-500">Lädt …</p>
              ) : recipients.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Für dieses Projekt ist noch niemand berechtigt.
                </p>
              ) : visibleRecipients.length === 0 ? (
                <p className="text-sm text-neutral-500">Keine Person gefunden.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 p-2">
                  {visibleRecipients.map((r) => (
                    <li key={r.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded p-1 text-sm hover:bg-neutral-50">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-neutral-800">
                            {r.name || r.email}
                          </span>
                          {r.name && (
                            <span className="block truncate text-[11px] text-neutral-400">
                              {r.email}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-neutral-500 hover:text-neutral-800"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={send}
                disabled={busy || !body.trim() || selected.size === 0}
                className="rounded-lg bg-sdg-red px-4 py-2 text-sm font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50"
              >
                {busy ? "Sendet …" : "Senden"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
