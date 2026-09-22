"use client";

import { useState } from "react";
import {
  getAnnounceRecipients,
  sendAnnouncement,
  type Recipient,
} from "@/lib/actions/announce";

/**
 * Admin-Funktion „📣 Mitteilung senden": kurze Nachricht an ausgewählte
 * Projektbeteiligte (Glocke, optional zusätzlich E-Mail).
 */
export function AnnounceButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("");
  const [alsoEmail, setAlsoEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  async function openModal() {
    setOpen(true);
    setLoading(true);
    const list = await getAnnounceRecipients(projectId);
    setRecipients(list);
    setSelected(new Set(list.map((r) => r.id))); // standardmäßig alle
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

  function allSelected() {
    return recipients.length > 0 && selected.size === recipients.length;
  }

  async function send() {
    setBusy(true);
    const res = await sendAnnouncement(
      projectId,
      body,
      [...selected],
      alsoEmail,
    );
    setBusy(false);
    if (res.ok) {
      window.alert(
        `Mitteilung an ${res.sent} Person(en) gesendet${
          res.emailNote ? ` – ${res.emailNote}` : ""
        }.`,
      );
      setOpen(false);
      setBody("");
      setAlsoEmail(false);
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
              Geht an die 🔔 Glocke der ausgewählten Personen.
            </p>

            <textarea
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Deine Nachricht … (z. B. „Neue Version ist online, bitte nochmal drüberschauen“)"
              className="w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-sdg-red"
            />

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium text-neutral-700">
                  Empfänger
                </span>
                {recipients.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(
                        allSelected()
                          ? new Set()
                          : new Set(recipients.map((r) => r.id)),
                      )
                    }
                    className="text-xs text-neutral-500 hover:text-sdg-red"
                  >
                    {allSelected() ? "Keine" : "Alle"}
                  </button>
                )}
              </div>
              {loading ? (
                <p className="text-sm text-neutral-500">Lädt …</p>
              ) : recipients.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Diesem Projekt sind keine Personen zugeordnet.
                </p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 p-2">
                  {recipients.map((r) => (
                    <li key={r.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded p-1 text-sm hover:bg-neutral-50">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                        <span className="truncate text-neutral-800">
                          {r.email}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={alsoEmail}
                onChange={(e) => setAlsoEmail(e.target.checked)}
              />
              Zusätzlich per E-Mail senden
            </label>

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
