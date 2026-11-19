"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addReply,
  deleteComment,
  editComment,
  setCommentStatus,
} from "@/lib/actions/comments";
import type { StoredComment } from "@/types/database";

/** Ein Kommentar samt Antworten (aktueller Stand oder aus einer Version). */
export type Thread = StoredComment;

export interface AiLogEntry {
  /** Kommentar-ID oder „chat“. */
  key: string;
  question: string;
  answer: string;
  failed?: boolean;
  /** Sicherung vor der Änderung – damit lässt sie sich zurücknehmen. */
  versionNo?: number | null;
}

interface Props {
  projectId: string;
  pageId: string;
  threads: Thread[];
  visible: Thread[];
  numberOf: Map<string, number>;
  selected: string | null;
  onSelect: (id: string) => void;
  showDone: boolean;
  onShowDone: (value: boolean) => void;
  readOnly: boolean;
  canComment: boolean;
  canEdit: boolean;
  currentUserEmail: string;
  models: { id: string; label: string }[];
  defaultModel: string;
  aiBusy: string | null;
  log: AiLogEntry[];
  target: { sid: string; label: string } | null;
  picking: boolean;
  onPick: () => void;
  onAi: (input: { commentId?: string; instruction?: string; model: string }) => void;
  onUndo: (entry: AiLogEntry) => void;
}

const MODEL_KEY = "sdg-sites-ki-modell";
const when = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function StudioSidebar(p: Props) {
  const router = useRouter();
  const [model, setModel] = useState(p.defaultModel);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(MODEL_KEY);
    if (saved && p.models.some((m) => m.id === saved)) setModel(saved);
  }, [p.models]);

  // Angeklickter Pin → zugehörige Karte in den Blick holen.
  useEffect(() => {
    if (p.selected) list.current?.querySelector(`[data-thread="${p.selected}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [p.selected]);

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    const res = await action();
    setBusy(false);
    if (!res.ok) window.alert(res.error);
    else router.refresh();
    return res.ok;
  }

  function send() {
    if (!text.trim() || p.aiBusy) return;
    p.onAi({ instruction: text.trim(), model });
    setText("");
  }

  const doneCount = p.threads.filter((t) => t.status === "erledigt").length;
  const chat = p.log.filter((e) => e.key === "chat").slice(-3);
  const small = "text-[11px] text-neutral-400 hover:text-sdg-red disabled:opacity-50";

  return (
    <aside className="flex max-h-[85vh] min-h-0 w-full shrink-0 flex-col gap-3 lg:max-h-none lg:w-[22rem]">
      {/* KI */}
      {p.canEdit && !p.readOnly && (
        <div className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-900">✨ Mit KI ändern</span>
            {p.models.length > 0 && (
              <select
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  window.localStorage.setItem(MODEL_KEY, e.target.value);
                }}
                className="max-w-[11rem] rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-[11px] text-neutral-600"
                title="KI-Modell (schnellere Modelle antworten in wenigen Sekunden)"
              >
                {p.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          {chat.map((e, i) => (
            <div key={i} className="mt-2 rounded-lg bg-neutral-50 px-2.5 py-2 text-xs">
              <div className="text-neutral-500">{e.question}</div>
              <div className={e.failed ? "mt-1 text-sdg-red-dark" : "mt-1 text-neutral-800"}>{e.answer}</div>
              {e.versionNo ? (
                <button onClick={() => p.onUndo(e)} disabled={!!p.aiBusy} className={`mt-1 ${small}`}>
                  ↩ Zurücknehmen
                </button>
              ) : null}
            </div>
          ))}
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Was soll geändert werden?"
            className="mt-2 w-full resize-y rounded-lg border border-neutral-300 px-2.5 py-2 text-sm outline-none focus:border-sdg-red"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              onClick={p.onPick}
              className={`min-w-0 flex-1 truncate rounded-lg border px-2 py-1.5 text-left text-xs ${
                p.target || p.picking ? "border-sdg-red bg-sdg-red-light text-sdg-red-dark" : "border-neutral-200 text-neutral-600 hover:border-sdg-red"
              }`}
              title="Mit gewählter Stelle arbeitet die KI am schnellsten und genauesten."
            >
              {p.target ? `🎯 ${p.target.label} ✕` : p.picking ? "🎯 Jetzt auf die Stelle klicken …" : "🎯 Stelle wählen (schneller)"}
            </button>
            <button
              onClick={send}
              disabled={!text.trim() || !!p.aiBusy}
              className="rounded-lg bg-sdg-red px-3 py-1.5 text-sm font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50"
            >
              {p.aiBusy === "chat" ? "Arbeitet …" : "✨ Ändern"}
            </button>
          </div>
        </div>
      )}

      {/* Kommentare */}
      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2">
          <span className="text-sm font-semibold text-neutral-900">
            Kommentare ({p.threads.length - doneCount} offen)
          </span>
          {doneCount > 0 && (
            <label className="flex cursor-pointer items-center gap-1 text-[11px] text-neutral-500">
              <input type="checkbox" checked={p.showDone} onChange={(e) => p.onShowDone(e.target.checked)} />
              {doneCount} erledigte zeigen
            </label>
          )}
        </div>
        <div ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {p.visible.length === 0 && (
            <p className="p-4 text-center text-sm text-neutral-400">
              {p.threads.length === 0 ? "Noch keine Kommentare." : "Keine offenen Kommentare."}
            </p>
          )}
          {p.visible.map((t) => {
            const done = t.status === "erledigt";
            const mine = t.authorEmail === p.currentUserEmail;
            const last = [...p.log].reverse().find((e) => e.key === t.id);
            return (
              <div
                key={t.id}
                data-thread={t.id}
                onClick={() => p.onSelect(t.id)}
                className={`cursor-pointer rounded-lg border p-2.5 transition-colors ${
                  p.selected === t.id ? "border-sdg-red bg-sdg-red-light/40" : "border-neutral-200 hover:border-neutral-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${done ? "bg-green-600" : "bg-sdg-red"}`}>
                    {p.numberOf.get(t.id)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">{t.authorEmail}</span>
                  <span className="text-[10px] text-neutral-400">{when(t.createdAt)}</span>
                </div>

                {editing?.id === t.id ? (
                  <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      rows={3}
                      value={editing.text}
                      onChange={(e) => setEditing({ id: t.id, text: e.target.value })}
                      className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-sdg-red"
                    />
                    <div className="mt-1 flex justify-end gap-3">
                      <button onClick={() => setEditing(null)} className={small}>
                        Abbrechen
                      </button>
                      <button
                        disabled={busy || !editing.text.trim()}
                        onClick={async () => {
                          if (await run(() => editComment(t.id, p.projectId, editing.text))) setEditing(null);
                        }}
                        className="text-[11px] font-medium text-sdg-red disabled:opacity-50"
                      >
                        Speichern
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-neutral-800">{t.body}</p>
                )}

                {t.replies.map((r) => (
                  <div key={r.id} className="mt-2 border-l-2 border-neutral-100 pl-2.5">
                    <div className="flex items-center gap-2 text-[11px] text-neutral-500">
                      <span className="min-w-0 flex-1 truncate">{r.authorEmail}</span>
                      {!p.readOnly && (p.canEdit || r.authorEmail === p.currentUserEmail) && (
                        <button
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm("Diese Antwort löschen?")) void run(() => deleteComment(r.id, p.projectId));
                          }}
                          className={small}
                        >
                          Löschen
                        </button>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-neutral-800">{r.body}</p>
                  </div>
                ))}

                {last && (
                  <div className={`mt-2 rounded-md px-2 py-1.5 text-xs ${last.failed ? "bg-sdg-red-light text-sdg-red-dark" : "bg-green-50 text-green-800"}`}>
                    {last.failed ? last.answer : `✓ ${last.answer}`}
                    {last.versionNo ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          p.onUndo(last);
                        }}
                        disabled={!!p.aiBusy}
                        className="ml-2 underline disabled:opacity-50"
                      >
                        Zurücknehmen
                      </button>
                    ) : null}
                  </div>
                )}

                {!p.readOnly && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1" onClick={(e) => e.stopPropagation()}>
                    {p.canEdit && !done && (
                      <button
                        onClick={() => p.onAi({ commentId: t.id, model })}
                        disabled={!!p.aiBusy}
                        className="rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                      >
                        {p.aiBusy === t.id ? "KI arbeitet …" : "✨ Umsetzen"}
                      </button>
                    )}
                    {p.canComment && (
                      <button
                        disabled={busy}
                        onClick={() => run(() => setCommentStatus(t.id, p.projectId, done ? "offen" : "erledigt"))}
                        className={done ? small : "text-[11px] font-medium text-green-700 hover:underline disabled:opacity-50"}
                      >
                        {done ? "Wieder öffnen" : "✓ Erledigt"}
                      </button>
                    )}
                    {(p.canEdit || mine) && (
                      <>
                        <button onClick={() => setEditing({ id: t.id, text: t.body })} className={small} title="Wortlaut des Kommentars anpassen (z. B. vor dem Umsetzen)">
                          Wortlaut ändern
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm("Diesen Kommentar samt Antworten löschen?")) void run(() => deleteComment(t.id, p.projectId));
                          }}
                          className={small}
                        >
                          Löschen
                        </button>
                      </>
                    )}
                  </div>
                )}

                {!p.readOnly && p.canComment && p.selected === t.id && (
                  <form
                    className="mt-2 flex gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const body = reply[t.id]?.trim();
                      if (!body) return;
                      const ok = await run(() =>
                        addReply({ pageId: p.pageId, projectId: p.projectId, parentId: t.id, body, xPct: t.xPct, yPct: t.yPct }),
                      );
                      if (ok) setReply((r) => ({ ...r, [t.id]: "" }));
                    }}
                  >
                    <input
                      value={reply[t.id] ?? ""}
                      onChange={(e) => setReply((r) => ({ ...r, [t.id]: e.target.value }))}
                      placeholder="Antworten …"
                      className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-sdg-red"
                    />
                    <button disabled={busy || !reply[t.id]?.trim()} className="rounded-lg bg-neutral-800 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
                      Senden
                    </button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
