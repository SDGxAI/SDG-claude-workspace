"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addComment,
  addReply,
  setCommentStatus,
  deleteComment,
} from "@/lib/actions/comments";

export interface CommentThread {
  id: string;
  body: string;
  xPct: number;
  yPct: number;
  status: "offen" | "erledigt";
  createdAt: string;
  authorEmail: string;
  replies: {
    id: string;
    body: string;
    createdAt: string;
    authorEmail: string;
  }[];
}

interface Props {
  previewHtml: string;
  pageId: string;
  projectId: string;
  threads: CommentThread[];
  canComment: boolean;
  canModerate: boolean;
  currentUserEmail: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CommentablePreview({
  previewHtml,
  pageId,
  projectId,
  threads,
  canComment,
  canModerate,
  currentUserEmail,
}: Props) {
  const router = useRouter();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [commentMode, setCommentMode] = useState(false);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState<Record<string, string>>({});

  const openCount = threads.filter((t) => t.status === "offen").length;

  function handleOverlayClick(e: React.MouseEvent) {
    if (!commentMode || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPending({ x, y });
    setPendingText("");
  }

  async function submitPending() {
    if (!pending || !pendingText.trim()) return;
    setBusy(true);
    const result = await addComment({
      pageId,
      projectId,
      body: pendingText,
      xPct: pending.x,
      yPct: pending.y,
    });
    setBusy(false);
    if (result.ok) {
      setPending(null);
      setPendingText("");
      setCommentMode(false);
      router.refresh();
    }
  }

  async function submitReply(thread: CommentThread) {
    const text = replyText[thread.id]?.trim();
    if (!text) return;
    setBusy(true);
    const result = await addReply({
      pageId,
      projectId,
      parentId: thread.id,
      body: text,
      xPct: thread.xPct,
      yPct: thread.yPct,
    });
    setBusy(false);
    if (result.ok) {
      setReplyText((prev) => ({ ...prev, [thread.id]: "" }));
      router.refresh();
    }
  }

  async function toggleStatus(thread: CommentThread) {
    setBusy(true);
    await setCommentStatus(
      thread.id,
      projectId,
      thread.status === "offen" ? "erledigt" : "offen",
    );
    setBusy(false);
    router.refresh();
  }

  async function handleDelete(commentId: string, isThread: boolean) {
    const msg = isThread
      ? "Diesen Kommentar samt Antworten löschen?"
      : "Diese Antwort löschen?";
    if (!window.confirm(msg)) return;
    setBusy(true);
    await deleteComment(commentId, projectId);
    setBusy(false);
    router.refresh();
  }

  function canDelete(authorEmail: string): boolean {
    return canModerate || authorEmail === currentUserEmail;
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Vorschau mit Pin-Overlay */}
      <div className="lg:flex-1">
        <div className="mb-2 flex items-center gap-3">
          {canComment && (
            <button
              onClick={() => {
                setCommentMode((m) => !m);
                setPending(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                commentMode
                  ? "bg-sdg-red text-white"
                  : "border border-neutral-300 text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
              }`}
            >
              {commentMode ? "Kommentarmodus aktiv – klicke in die Vorschau" : "Kommentar hinzufügen"}
            </button>
          )}
          <span className="text-sm text-neutral-500">
            {openCount} offen{openCount === 1 ? "er" : "e"} Kommentar
            {openCount === 1 ? "" : "e"}
          </span>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <iframe
            title="Vorschau"
            srcDoc={previewHtml}
            className="h-[60vh] w-full lg:h-[75vh]"
            sandbox="allow-same-origin"
          />

          {/* Overlay: fängt Klicks nur im Kommentarmodus, Pins immer klickbar */}
          <div
            ref={overlayRef}
            onClick={handleOverlayClick}
            className="absolute inset-0"
            style={{
              pointerEvents: commentMode ? "auto" : "none",
              cursor: commentMode ? "crosshair" : "default",
            }}
          >
            {threads.map((thread, i) => (
              <button
                key={thread.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(thread.id);
                }}
                className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow ${
                  thread.status === "erledigt"
                    ? "bg-green-600"
                    : "bg-sdg-red"
                } ${selectedId === thread.id ? "ring-2 ring-sdg-red ring-offset-1" : ""}`}
                style={{
                  left: `${thread.xPct}%`,
                  top: `${thread.yPct}%`,
                  pointerEvents: "auto",
                }}
                title={thread.body}
              >
                {i + 1}
              </button>
            ))}

            {pending && (
              <div
                className="absolute z-10 w-64 -translate-x-1/2 rounded-lg border border-neutral-300 bg-white p-3 shadow-lg"
                style={{
                  left: `${pending.x}%`,
                  top: `${pending.y}%`,
                  pointerEvents: "auto",
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <textarea
                  autoFocus
                  rows={3}
                  value={pendingText}
                  onChange={(e) => setPendingText(e.target.value)}
                  placeholder="Dein Kommentar …"
                  className="w-full resize-y rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-sdg-red"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setPending(null)}
                    className="rounded px-2 py-1 text-xs text-neutral-500 hover:text-neutral-800"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={submitPending}
                    disabled={busy || !pendingText.trim()}
                    className="rounded bg-sdg-red px-3 py-1 text-xs font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50"
                  >
                    Speichern
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Kommentar-Liste */}
      <div className="lg:w-80 lg:shrink-0">
        <h2 className="mb-3 font-semibold text-neutral-900">
          Kommentare ({threads.length})
        </h2>
        {threads.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
            Noch keine Kommentare.
            {canComment && " Klicke auf „Kommentar hinzufügen“, um Feedback zu geben."}
          </p>
        ) : (
          <ul className="space-y-3">
            {threads.map((thread, i) => {
              const canToggle =
                canModerate || thread.authorEmail === currentUserEmail;
              return (
                <li
                  key={thread.id}
                  onClick={() => setSelectedId(thread.id)}
                  className={`rounded-lg border p-3 ${
                    selectedId === thread.id
                      ? "border-sdg-red"
                      : "border-neutral-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white ${
                        thread.status === "erledigt" ? "bg-green-600" : "bg-sdg-red"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="truncate text-xs text-neutral-500">
                      {thread.authorEmail}
                    </span>
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        thread.status === "erledigt"
                          ? "bg-green-100 text-green-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {thread.status === "erledigt" ? "Erledigt" : "Offen"}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">
                    {thread.body}
                  </p>
                  <p className="mt-1 text-[10px] text-neutral-400">
                    {formatTime(thread.createdAt)}
                  </p>

                  {thread.replies.length > 0 && (
                    <ul className="mt-2 space-y-2 border-l-2 border-neutral-100 pl-3">
                      {thread.replies.map((reply) => (
                        <li key={reply.id}>
                          <p className="text-xs text-neutral-500">
                            {reply.authorEmail}
                          </p>
                          <p className="whitespace-pre-wrap text-sm text-neutral-800">
                            {reply.body}
                          </p>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] text-neutral-400">
                              {formatTime(reply.createdAt)}
                            </p>
                            {canDelete(reply.authorEmail) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(reply.id, false);
                                }}
                                disabled={busy}
                                className="text-[10px] text-neutral-400 hover:text-sdg-red disabled:opacity-50"
                              >
                                Löschen
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {canComment && (
                    <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={replyText[thread.id] ?? ""}
                        onChange={(e) =>
                          setReplyText((prev) => ({
                            ...prev,
                            [thread.id]: e.target.value,
                          }))
                        }
                        placeholder="Antworten …"
                        className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-sdg-red"
                      />
                      <button
                        onClick={() => submitReply(thread)}
                        disabled={busy || !(replyText[thread.id]?.trim())}
                        className="rounded bg-neutral-800 px-2 py-1 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
                      >
                        Senden
                      </button>
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-3">
                    {canToggle && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleStatus(thread);
                        }}
                        disabled={busy}
                        className="text-xs text-neutral-500 hover:text-sdg-red disabled:opacity-50"
                      >
                        {thread.status === "offen"
                          ? "Als erledigt markieren"
                          : "Wieder öffnen"}
                      </button>
                    )}
                    {canDelete(thread.authorEmail) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(thread.id, true);
                        }}
                        disabled={busy}
                        className="text-xs text-neutral-500 hover:text-sdg-red disabled:opacity-50"
                      >
                        Löschen
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
