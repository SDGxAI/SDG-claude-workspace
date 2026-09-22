"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addComment,
  addReply,
  setCommentStatus,
  deleteComment,
  editComment,
} from "@/lib/actions/comments";
import {
  getVersionHtml,
  deleteVersion,
  restoreVersion,
  saveVersion,
  type VersionMeta,
} from "@/lib/actions/versions";
import { umsetzenComment } from "@/lib/actions/umsetzen";
import { withBlankLinks } from "@/lib/html/previewLinks";
import type { PageVersionSource, StoredComment } from "@/types/database";

/** Kurze, verständliche Bezeichnung, woher eine Version stammt. */
const VERSION_SOURCE_LABEL: Record<PageVersionSource, string> = {
  manual: "Gespeichert",
  editor: "Editor",
  claude: "Aus Claude",
  umsetzen: "KI-Umsetzung",
  import: "Import",
  ki: "KI-Bearbeitung",
};

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
  versions: VersionMeta[];
}

function formatVersionTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Prozentwert auf 0–100 begrenzen. */
function clampPct(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function CommentablePreview({
  previewHtml,
  pageId,
  projectId,
  threads,
  canComment,
  canModerate,
  currentUserEmail,
  versions,
}: Props) {
  const router = useRouter();
  const overlayRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [commentMode, setCommentMode] = useState(false);
  // Vorschau-Ansicht: Desktop (Editor-Breite) oder Mobil (Handy-Rahmen).
  const [view, setView] = useState<"desktop" | "mobile">("desktop");
  // Kommentarspalte ein-/ausblenden (ausgeblendet = breitere Vorschau).
  const [showComments, setShowComments] = useState(true);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [pendingText, setPendingText] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [replyText, setReplyText] = useState<Record<string, string>>({});

  // Versionsverlauf: Leiste ein-/ausblenden, aktuell betrachtete Version
  // (null = aktueller/live Stand), deren HTML und Vergleichsmodus.
  const [showVersions, setShowVersions] = useState(false);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [versionHtml, setVersionHtml] = useState("");
  const [versionComments, setVersionComments] = useState<StoredComment[]>([]);
  const [loadingVersion, setLoadingVersion] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  // Erledigte Kommentare sind in der aktuellen Version standardmäßig
  // ausgeblendet (nur offene). Über den Schalter kurz einblendbar.
  const [showDone, setShowDone] = useState(false);

  // In der aktuellen Ansicht nur offene Kommentare zeigen (erledigte sind
  // in den alten Versionen weiter nachvollziehbar).
  const displayThreads = showDone
    ? threads
    : threads.filter((t) => t.status !== "erledigt");
  const doneCount = threads.filter((t) => t.status === "erledigt").length;

  const activeVersion = versions.find((v) => v.id === activeVersionId) ?? null;

  /** Wechselt die betrachtete Version (null = aktueller Stand). */
  const selectVersion = useCallback(async (v: VersionMeta | null) => {
    setCommentMode(false);
    setPending(null);
    setCompareMode(false);
    if (!v) {
      setActiveVersionId(null);
      setVersionHtml("");
      setVersionComments([]);
      return;
    }
    setActiveVersionId(v.id);
    setLoadingVersion(true);
    const res = await getVersionHtml(v.id);
    setLoadingVersion(false);
    setVersionHtml(res.ok ? res.html : "");
    setVersionComments(res.ok ? res.comments : []);
  }, []);

  async function removeVersion(v: VersionMeta) {
    if (!window.confirm(`Version ${v.versionNo} wirklich löschen?`)) return;
    setBusy(true);
    await deleteVersion(v.id, projectId);
    setBusy(false);
    if (activeVersionId === v.id) await selectVersion(null);
    router.refresh();
  }

  async function handleSaveVersion() {
    setBusy(true);
    const res = await saveVersion(pageId, projectId);
    setBusy(false);
    if (res.ok) {
      setShowVersions(true);
      router.refresh();
    } else {
      window.alert(res.error);
    }
  }

  async function restore(v: VersionMeta) {
    if (
      !window.confirm(
        `Version ${v.versionNo} als aktuellen Stand wiederherstellen?\n\n` +
          "Der jetzige Stand wird vorher automatisch als Version gesichert.",
      )
    )
      return;
    setBusy(true);
    const res = await restoreVersion(v.id, pageId, projectId);
    setBusy(false);
    if (res.ok) {
      await selectVersion(null);
      router.refresh();
    } else {
      window.alert(res.error);
    }
  }

  // Die Vorschau wird so hoch dargestellt wie die ECHTE Seite (kein innerer
  // Scrollbalken) – man scrollt die ganze Seite wie im echten Browser. Die
  // Pins liegen als Overlay in Prozent der Seitenhöhe darüber und wandern
  // dadurch von selbst mit.
  const [contentHeight, setContentHeight] = useState(0);

  const openCount = threads.filter((t) => t.status === "offen").length;

  /** Echte Inhaltshöhe der Vorschau messen (same-origin iframe). */
  const measure = useCallback(() => {
    const iframe = iframeRef.current;
    try {
      const doc = iframe?.contentDocument;
      if (!doc) return;
      const h = Math.max(
        doc.documentElement.scrollHeight,
        doc.body?.scrollHeight ?? 0,
        400,
      );
      setContentHeight(h);
    } catch {
      /* iframe noch nicht bereit */
    }
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let observer: ResizeObserver | null = null;

    const attach = () => {
      try {
        const body = iframe.contentDocument?.body;
        if (body) {
          observer?.disconnect();
          observer = new ResizeObserver(() => measure());
          observer.observe(body);
        }
        measure();
      } catch {
        /* ignore */
      }
    };

    iframe.addEventListener("load", attach);
    attach(); // falls die Vorschau schon geladen ist
    window.addEventListener("resize", measure);

    return () => {
      iframe.removeEventListener("load", attach);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [previewHtml, measure]);

  // Nach Rückkehr aus einer Alt-Version die Live-Vorschau neu vermessen.
  useEffect(() => {
    if (!activeVersionId) requestAnimationFrame(() => measure());
  }, [activeVersionId, measure]);

  /** Springt (in der ganzen Seite) zu der Stelle, an der ein Kommentar sitzt. */
  const scrollToThread = useCallback((thread: CommentThread) => {
    setSelectedId(thread.id);
    const overlay = overlayRef.current;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const target =
      rect.top + window.scrollY + (thread.yPct / 100) * rect.height;
    window.scrollTo({
      top: Math.max(0, target - window.innerHeight / 2),
      behavior: "smooth",
    });
  }, []);

  function handleOverlayClick(e: React.MouseEvent) {
    if (!commentMode || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = clampPct(((e.clientX - rect.left) / rect.width) * 100);
    const y = clampPct(((e.clientY - rect.top) / rect.height) * 100);
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

  const [umsetzenId, setUmsetzenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  function startEdit(thread: CommentThread) {
    setEditingId(thread.id);
    setEditText(thread.body);
  }

  async function saveEdit(thread: CommentThread) {
    const text = editText.trim();
    if (!text) return;
    setBusy(true);
    const res = await editComment(thread.id, projectId, text);
    setBusy(false);
    if (res.ok) {
      setEditingId(null);
      router.refresh();
    } else {
      window.alert(res.error);
    }
  }

  async function handleUmsetzen(thread: CommentThread) {
    setUmsetzenId(thread.id);
    const res = await umsetzenComment(thread.id, pageId, projectId);
    setUmsetzenId(null);
    if (res.ok) {
      window.alert(
        "Erledigt: Die KI hat die Änderung übernommen und eine neue Version angelegt. " +
          "Prüfe das Ergebnis und markiere den Kommentar bei Bedarf als erledigt.",
      );
      // Zurück zum aktuellen Stand, damit die Änderung sofort sichtbar ist.
      await selectVersion(null);
      router.refresh();
    } else {
      window.alert(res.error);
    }
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
    <div>
      {/* Obere Werkzeugleiste: Kommentare + Ansicht (Desktop/Mobil).
          Gleiche Breite/Ausrichtung wie die Kopfzeile und die Navi-Leiste,
          damit die Buttons nicht bis zum Bildschirmrand ragen. */}
      <div className="mx-auto mb-3 flex max-w-6xl flex-wrap items-center gap-3 px-4">
        {canComment && (
          <button
            onClick={() => {
              // Beim Betrachten einer alten Version zurück zum aktuellen Stand,
              // denn Kommentare gehen nur dort.
              if (activeVersionId !== null) selectVersion(null);
              setCommentMode((m) => !m);
              setPending(null);
              setShowComments(true);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              commentMode && activeVersionId === null
                ? "bg-sdg-red text-white"
                : "border border-neutral-300 text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
            }`}
          >
            {commentMode && activeVersionId === null
              ? "Kommentarmodus aktiv – klicke in die Vorschau"
              : "Kommentar hinzufügen"}
          </button>
        )}

        {/* Kommentarspalte rechts ein-/ausblenden */}
        <button
          type="button"
          onClick={() => setShowComments((s) => !s)}
          aria-pressed={showComments}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            showComments
              ? "border-sdg-red bg-sdg-red-light text-sdg-red-dark"
              : "border-neutral-300 text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
          }`}
          title="Kommentarspalte rechts ein-/ausblenden"
        >
          {showComments ? "Kommentare ausblenden" : `Kommentare einblenden (${threads.length})`}
        </button>

        {openCount > 0 && (
          <span className="text-sm text-neutral-500">{openCount} offen</span>
        )}

        {/* Versionsverlauf ein-/ausblenden */}
        <button
          type="button"
          onClick={() => setShowVersions((s) => !s)}
          aria-pressed={showVersions}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            showVersions
              ? "border-sdg-red bg-sdg-red-light text-sdg-red-dark"
              : "border-neutral-300 text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
          }`}
          title="Frühere Versionen ansehen und vergleichen"
        >
          🕘 Versionen ({versions.length})
        </button>

        {canModerate && (
          <button
            type="button"
            onClick={handleSaveVersion}
            disabled={busy}
            className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 transition-colors hover:border-sdg-red hover:text-sdg-red disabled:opacity-50"
            title="Aktuellen Stand als Version merken"
          >
            Version speichern
          </button>
        )}

        {/* Ansicht: Desktop (Editor-Breite) / Mobil (Handy) */}
        <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-neutral-300">
          {(
            [
              ["desktop", "🖥 Desktop"],
              ["mobile", "📱 Mobil"],
            ] as const
          ).map(([key, label], i) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              aria-pressed={view === key}
              title={
                key === "desktop"
                  ? "Desktop – so wie die Seite am Computer aussieht"
                  : "Mobil – so wie die Seite auf dem Handy aussieht"
              }
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                i > 0 ? "border-l border-neutral-300" : ""
              } ${
                view === key
                  ? "bg-sdg-red text-white"
                  : "bg-white text-neutral-600 hover:text-sdg-red"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Versionsleiste: aktueller Stand + frühere Versionen zum Ansehen,
          Vergleichen, Wiederherstellen und Löschen. */}
      {showVersions && (
        <div className="mb-3 px-4 lg:px-6">
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm font-medium text-neutral-700">
                Versionen:
              </span>

              {/* Aktueller (Live-)Stand */}
              <button
                type="button"
                onClick={() => selectVersion(null)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  activeVersionId === null
                    ? "bg-sdg-red text-white"
                    : "border border-neutral-300 bg-white text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
                }`}
                title="Der aktuelle Stand – hier wird kommentiert und bearbeitet"
              >
                Aktuell
              </button>

              {versions.length === 0 && (
                <span className="text-sm text-neutral-500">
                  Noch keine früheren Versionen vorhanden.
                </span>
              )}

              {versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => selectVersion(v)}
                  className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                    activeVersionId === v.id
                      ? "bg-sdg-red text-white"
                      : "border border-neutral-300 bg-white text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
                  }`}
                  title={`${VERSION_SOURCE_LABEL[v.source]} · ${formatVersionTime(v.createdAt)}${
                    v.authorEmail ? ` · ${v.authorEmail}` : ""
                  }`}
                >
                  V{v.versionNo}
                </button>
              ))}
            </div>

            {/* Aktionen für die gerade betrachtete Version */}
            {activeVersion && (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-3">
                <span className="text-sm text-neutral-600">
                  Version {activeVersion.versionNo} ·{" "}
                  {VERSION_SOURCE_LABEL[activeVersion.source]} ·{" "}
                  {formatVersionTime(activeVersion.createdAt)}
                </span>
                <label className="flex items-center gap-1.5 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={compareMode}
                    onChange={(e) => setCompareMode(e.target.checked)}
                  />
                  Mit aktuellem vergleichen
                </label>
                {canModerate && (
                  <>
                    <button
                      type="button"
                      onClick={() => restore(activeVersion)}
                      disabled={busy}
                      className="rounded-lg border border-neutral-300 px-3 py-1 text-sm font-medium text-neutral-700 transition-colors hover:border-sdg-red hover:text-sdg-red disabled:opacity-50"
                    >
                      Wiederherstellen
                    </button>
                    <button
                      type="button"
                      onClick={() => removeVersion(activeVersion)}
                      disabled={busy}
                      className="rounded-lg px-3 py-1 text-sm font-medium text-neutral-500 transition-colors hover:text-sdg-red disabled:opacity-50"
                    >
                      Löschen
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => selectVersion(null)}
                  className="ml-auto text-sm text-neutral-500 hover:text-sdg-red"
                >
                  ← Zur aktuellen Version
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Nur-Ansicht einer früheren Version (kein Kommentieren möglich). */}
      {activeVersion && (
        <div className="mb-3 px-4 lg:px-6">
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Du siehst <strong>Version {activeVersion.versionNo}</strong> (nur
            Ansicht). Kommentare sind nur in der aktuellen Version möglich.
          </div>

          {loadingVersion ? (
            <div className="flex h-[40vh] items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-500">
              Version wird geladen …
            </div>
          ) : compareMode ? (
            <div className="flex flex-col gap-4 lg:flex-row">
              <div className="min-w-0 lg:flex-1">
                <div className="mb-1 text-sm font-medium text-neutral-600">
                  Version {activeVersion.versionNo} (vorher)
                </div>
                <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
                  <iframe
                    title={`Version ${activeVersion.versionNo}`}
                    srcDoc={withBlankLinks(versionHtml)}
                    className="h-[70vh] w-full lg:h-[76vh]"
                    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  />
                </div>
              </div>
              <div className="min-w-0 lg:flex-1">
                <div className="mb-1 text-sm font-medium text-neutral-600">
                  Aktuell (jetzt)
                </div>
                <div className="overflow-hidden rounded-xl border border-sdg-red bg-white">
                  <iframe
                    title="Aktueller Stand"
                    srcDoc={withBlankLinks(previewHtml)}
                    className="h-[70vh] w-full lg:h-[76vh]"
                    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <iframe
                title={`Version ${activeVersion.versionNo}`}
                srcDoc={withBlankLinks(versionHtml)}
                className="h-[70vh] w-full lg:h-[76vh]"
                sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              />
            </div>
          )}

          {/* Kommentare, die zu dieser Version gehörten (nur zum Nachverfolgen). */}
          {!loadingVersion && (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-neutral-700">
                Kommentare dieser Version ({versionComments.length})
              </h3>
              {versionComments.length === 0 ? (
                <p className="text-sm text-neutral-500">
                  Zu dieser Version sind keine Kommentare gespeichert.
                </p>
              ) : (
                <ul className="space-y-2">
                  {versionComments.map((c, i) => (
                    <li
                      key={c.id}
                      className="rounded-lg border border-neutral-200 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-white ${
                            c.status === "erledigt" ? "bg-green-600" : "bg-sdg-red"
                          }`}
                        >
                          {i + 1}
                        </span>
                        <span className="truncate text-xs text-neutral-500">
                          {c.authorEmail}
                        </span>
                        <span
                          className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            c.status === "erledigt"
                              ? "bg-green-100 text-green-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {c.status === "erledigt" ? "Erledigt" : "Offen"}
                        </span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">
                        {c.body}
                      </p>
                      {c.replies.length > 0 && (
                        <ul className="mt-2 space-y-1 border-l-2 border-neutral-100 pl-3">
                          {c.replies.map((r) => (
                            <li key={r.id} className="text-sm text-neutral-700">
                              <span className="text-xs text-neutral-500">
                                {r.authorEmail}:{" "}
                              </span>
                              {r.body}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Vorschau-Fläche voll breit (nur seitlicher Innenabstand).
          Bei betrachteter Alt-Version ausgeblendet (Live-Stand bleibt aber
          im DOM, damit Scroll-/Pin-Logik erhalten bleibt). */}
      <div
        className={`flex flex-col gap-4 px-4 lg:flex-row lg:px-6 ${
          activeVersion ? "hidden" : ""
        }`}
      >
        {/* Vorschau mit Pin-Overlay – so hoch wie die echte Seite, man scrollt
            die ganze Seite (kein innerer Scrollbalken). */}
        <div className="min-w-0 lg:flex-1">
          <div
            className={
              view === "mobile"
                ? "relative mx-auto w-full max-w-[400px] overflow-hidden rounded-[2.2rem] border-[10px] border-neutral-800 bg-white shadow-xl transition-all"
                : "relative w-full overflow-hidden rounded-xl border border-neutral-200 bg-white transition-all"
            }
          >
            <iframe
              ref={iframeRef}
              title="Vorschau"
              srcDoc={withBlankLinks(previewHtml)}
              scrolling="no"
              className="block w-full"
              style={{ height: contentHeight ? `${contentHeight}px` : "80vh" }}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            />

          {/* Overlay über der GESAMTEN Seitenhöhe: fängt Klicks nur im
              Kommentarmodus, Pins liegen prozentual und scrollen mit. */}
          <div
            ref={overlayRef}
            onClick={handleOverlayClick}
            className="absolute inset-0"
            style={{
              pointerEvents: commentMode ? "auto" : "none",
              cursor: commentMode ? "crosshair" : "default",
            }}
          >
            {displayThreads.map((thread, i) => (
              <button
                key={thread.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(thread.id);
                  setShowComments(true);
                }}
                className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow ${
                  thread.status === "erledigt" ? "bg-green-600" : "bg-sdg-red"
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

      {/* Kommentar-Liste: bleibt beim Scrollen der langen Seite sichtbar
          (sticky) und scrollt bei Bedarf intern. */}
      {showComments && (
      <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-80 lg:shrink-0 lg:self-start lg:overflow-y-auto">
        <h2 className="mb-1 font-semibold text-neutral-900">
          Kommentare ({displayThreads.length})
        </h2>
        {doneCount > 0 && (
          <button
            type="button"
            onClick={() => setShowDone((s) => !s)}
            className="mb-3 text-xs text-neutral-500 hover:text-sdg-red"
          >
            {showDone
              ? "Erledigte ausblenden"
              : `+ ${doneCount} erledigte anzeigen`}
          </button>
        )}
        {displayThreads.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
            {threads.length === 0
              ? "Noch keine Kommentare."
              : "Keine offenen Kommentare – alles erledigt. 🎉"}
            {canComment &&
              threads.length === 0 &&
              " Klicke auf „Kommentar hinzufügen“, um Feedback zu geben."}
          </p>
        ) : (
          <ul className="space-y-3">
            {displayThreads.map((thread, i) => {
              const canToggle =
                canModerate || thread.authorEmail === currentUserEmail;
              return (
                <li
                  key={thread.id}
                  onClick={() => scrollToThread(thread)}
                  className={`cursor-pointer rounded-lg border p-3 transition-colors ${
                    selectedId === thread.id
                      ? "border-sdg-red ring-1 ring-sdg-red"
                      : "border-neutral-200 hover:border-neutral-300"
                  }`}
                  title="Zur Stelle in der Vorschau springen"
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
                  {editingId === thread.id ? (
                    <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                      <textarea
                        autoFocus
                        rows={3}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="w-full resize-y rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-sdg-red"
                      />
                      <div className="mt-1 flex justify-end gap-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded px-2 py-1 text-xs text-neutral-500 hover:text-neutral-800"
                        >
                          Abbrechen
                        </button>
                        <button
                          onClick={() => saveEdit(thread)}
                          disabled={busy || !editText.trim()}
                          className="rounded bg-sdg-red px-3 py-1 text-xs font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50"
                        >
                          Speichern
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800">
                      {thread.body}
                    </p>
                  )}
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

                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {canModerate && thread.status === "offen" && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUmsetzen(thread);
                        }}
                        disabled={busy || umsetzenId !== null}
                        className="rounded bg-sdg-red px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-sdg-red-dark disabled:opacity-50"
                        title="Die KI setzt dieses Feedback direkt in der Seite um (neue Version)"
                      >
                        {umsetzenId === thread.id ? "KI arbeitet …" : "✨ Umsetzen"}
                      </button>
                    )}
                    {(canModerate || thread.authorEmail === currentUserEmail) &&
                      editingId !== thread.id && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(thread);
                          }}
                          disabled={busy}
                          className="text-xs text-neutral-500 hover:text-sdg-red disabled:opacity-50"
                          title="Wortlaut des Kommentars anpassen (z. B. vor dem Umsetzen)"
                        >
                          Bearbeiten
                        </button>
                      )}
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
      )}
      </div>
    </div>
  );
}
