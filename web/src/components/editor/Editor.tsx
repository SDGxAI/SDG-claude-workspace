"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  applyColor,
  applyImage,
  applyText,
  applyLink,
  applyI18nLang,
  applyI18nValue,
} from "@/lib/html/liveApply";
import { savePageContent } from "@/lib/actions/pages";
import {
  createSnapshot,
  restoreSnapshot,
  type SnapshotEntry,
} from "@/lib/actions/pages";
import { uploadProjectImage } from "@/lib/actions/upload";
import type { ContentState, DetectedElement } from "@/types/database";

type SaveState = "idle" | "saving" | "saved" | "error";

const STORAGE_REF_PREFIX = "sb:";
const HISTORY_LIMIT = 50;
const COALESCE_MS = 800;

export interface EditorProps {
  projectId: string;
  pageId: string;
  projectTitle: string;
  brand: string;
  initialHtml: string;
  detectedElements: DetectedElement[];
  initialContentState: ContentState;
  resolvedImages: Record<string, string>;
  initialSnapshots: SnapshotEntry[];
  /** Übersetzungs-Schlüssel in Seitenreihenfolge (oben nach unten). */
  i18nKeyOrder?: string[];
  canEdit: boolean;
}

function toHex6(value: string): string {
  const v = value.trim();
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  const full = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(v);
  if (full) return `#${full[1]}`;
  return "#000000";
}

export function Editor({
  projectId,
  pageId,
  projectTitle,
  brand,
  initialHtml,
  detectedElements,
  initialContentState,
  resolvedImages,
  initialSnapshots,
  i18nKeyOrder,
  canEdit,
}: EditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [content, setContent] = useState<ContentState>(initialContentState);
  const [past, setPast] = useState<ContentState[]>([]);
  const [future, setFuture] = useState<ContentState[]>([]);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>(initialSnapshots);
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotMsg, setSnapshotMsg] = useState<string | null>(null);

  const langs = useMemo(
    () => Object.keys(initialContentState.i18n ?? {}),
    [initialContentState.i18n],
  );
  const i18nKeys = useMemo(() => {
    if (langs.length === 0) return [];
    const allKeys = Object.keys(initialContentState.i18n![langs[0]]);
    if (!i18nKeyOrder || i18nKeyOrder.length === 0) return allKeys;
    // Erst die Schlüssel in Seitenreihenfolge, dann übrige (z. B. meta.*).
    const ordered = i18nKeyOrder.filter((k) => allKeys.includes(k));
    const rest = allKeys.filter((k) => !ordered.includes(k));
    return [...ordered, ...rest];
  }, [initialContentState.i18n, langs, i18nKeyOrder]);
  const [lang, setLang] = useState<string>(langs[0] ?? "");

  const isFirstRender = useRef(true);
  const lastKey = useRef<string | null>(null);
  const lastTime = useRef(0);
  // Aktuelle literale Farbwerte im Dokument (für korrektes Ersetzen).
  const docColorValues = useRef<Record<string, string>>({ ...initialContentState.colors });
  // Signierte URLs je Storage-Referenz (für Undo/Redo von Bildern).
  const urlByRef = useRef<Map<string, string>>(new Map());

  // urlByRef aus den initial aufgelösten Bildern befüllen
  if (urlByRef.current.size === 0) {
    for (const [id, ref] of Object.entries(initialContentState.images)) {
      if (ref.startsWith(STORAGE_REF_PREFIX) && resolvedImages[id]) {
        urlByRef.current.set(ref, resolvedImages[id]);
      }
    }
  }

  const colors = useMemo(
    () => detectedElements.filter((el) => el.kind === "color"),
    [detectedElements],
  );
  const texts = useMemo(
    () => detectedElements.filter((el) => el.kind === "text"),
    [detectedElements],
  );
  const images = useMemo(
    () => detectedElements.filter((el) => el.kind === "image"),
    [detectedElements],
  );
  const links = useMemo(
    () => detectedElements.filter((el) => el.kind === "link"),
    [detectedElements],
  );

  const getDoc = useCallback(() => iframeRef.current?.contentDocument ?? null, []);

  const resolveImg = useCallback((value: string): string => {
    if (value.startsWith(STORAGE_REF_PREFIX)) {
      return urlByRef.current.get(value) ?? value;
    }
    return value;
  }, []);

  // Autosave (debounced)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (!canEdit) return;
    setSaveState("saving");
    const timer = setTimeout(async () => {
      const result = await savePageContent(pageId, projectId, content);
      setSaveState(result.ok ? "saved" : "error");
    }, COALESCE_MS);
    return () => clearTimeout(timer);
  }, [content, canEdit, pageId, projectId]);

  const commit = useCallback(
    (next: ContentState, key: string | null) => {
      const now = Date.now();
      const coalesce =
        key !== null && key === lastKey.current && now - lastTime.current < COALESCE_MS;
      if (!coalesce) {
        setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), content]);
        setFuture([]);
      }
      lastKey.current = key;
      lastTime.current = now;
      setContent(next);
    },
    [content],
  );

  const applyStateToDoc = useCallback(
    (state: ContentState) => {
      const doc = getDoc();
      if (!doc) return;
      for (const [id, v] of Object.entries(state.texts)) applyText(doc, id, v);
      for (const [id, v] of Object.entries(state.colors)) {
        applyColor(doc, id, v, docColorValues.current[id] ?? "");
        docColorValues.current[id] = v;
      }
      for (const [id, v] of Object.entries(state.images)) {
        applyImage(doc, id, resolveImg(v));
      }
      for (const [id, v] of Object.entries(state.links ?? {})) {
        applyLink(doc, id, v);
      }
      if (state.i18n && lang && state.i18n[lang]) {
        applyI18nLang(doc, state.i18n[lang]);
      }
    },
    [getDoc, resolveImg, lang],
  );

  // Beim Laden der Vorschau und beim Sprachwechsel die aktuelle Sprache
  // anwenden (die Vorschau selbst führt keine Skripte aus).
  const applyCurrentLang = useCallback(() => {
    const doc = getDoc();
    if (doc && content.i18n && lang && content.i18n[lang]) {
      applyI18nLang(doc, content.i18n[lang]);
    }
  }, [getDoc, content.i18n, lang]);

  useEffect(() => {
    applyCurrentLang();
  }, [lang, applyCurrentLang]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [content, ...f]);
    lastKey.current = null;
    applyStateToDoc(prev);
    setContent(prev);
  }, [past, content, applyStateToDoc]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, content]);
    lastKey.current = null;
    applyStateToDoc(next);
    setContent(next);
  }, [future, content, applyStateToDoc]);

  // Tastenkürzel Strg/Cmd+Z (Undo), Strg/Cmd+Shift+Z (Redo)
  useEffect(() => {
    if (!canEdit) return;
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, undo, redo]);

  function handleColorChange(id: string, value: string) {
    const doc = getDoc();
    const prevVal = docColorValues.current[id] ?? content.colors[id] ?? "";
    if (doc) applyColor(doc, id, value, prevVal);
    docColorValues.current[id] = value;
    commit({ ...content, colors: { ...content.colors, [id]: value } }, `color:${id}`);
  }

  function handleTextChange(id: string, value: string) {
    const doc = getDoc();
    if (doc) applyText(doc, id, value);
    commit({ ...content, texts: { ...content.texts, [id]: value } }, `text:${id}`);
  }

  function handleLinkChange(id: string, value: string) {
    const doc = getDoc();
    if (doc) applyLink(doc, id, value);
    commit(
      { ...content, links: { ...(content.links ?? {}), [id]: value } },
      `link:${id}`,
    );
  }

  function handleI18nChange(key: string, value: string) {
    if (!content.i18n) return;
    const doc = getDoc();
    if (doc) applyI18nValue(doc, key, value);
    commit(
      {
        ...content,
        i18n: {
          ...content.i18n,
          [lang]: { ...content.i18n[lang], [key]: value },
        },
      },
      `i18n:${lang}:${key}`,
    );
  }

  async function handleImageChange(id: string, file: File) {
    setUploadError(null);
    setUploadingId(id);
    const formData = new FormData();
    formData.append("file", file);
    const result = await uploadProjectImage(projectId, formData);
    setUploadingId(null);
    if (!result.ok) {
      setUploadError(result.error);
      return;
    }
    urlByRef.current.set(result.ref, result.url);
    const doc = getDoc();
    if (doc) applyImage(doc, id, result.url);
    commit({ ...content, images: { ...content.images, [id]: result.ref } }, null);
  }

  async function handleCreateSnapshot() {
    setSnapshotMsg(null);
    setSnapshotBusy(true);
    const result = await createSnapshot(pageId, snapshotLabel, content);
    setSnapshotBusy(false);
    if (result.ok) {
      setSnapshots(result.snapshots);
      setSnapshotLabel("");
      setSnapshotMsg("Snapshot gespeichert.");
    } else {
      setSnapshotMsg(result.error);
    }
  }

  async function handleRestore(snapshotId: string) {
    setSnapshotMsg(null);
    const result = await restoreSnapshot(snapshotId, pageId, projectId);
    if (!result.ok) {
      setSnapshotMsg(result.error);
      return;
    }
    // Wiederherstellen ist rückgängig machbar (als History-Schritt).
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), content]);
    setFuture([]);
    lastKey.current = null;
    applyStateToDoc(result.contentState);
    setContent(result.contentState);
    setSnapshotMsg("Snapshot wiederhergestellt.");
  }

  const saveLabel: Record<SaveState, string> = {
    idle: "",
    saving: "Wird gespeichert …",
    saved: "Gespeichert",
    error: "Fehler beim Speichern",
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col lg:flex-row">
      <aside className="w-full shrink-0 overflow-y-auto border-b border-neutral-200 bg-white lg:w-80 lg:border-b-0 lg:border-r">
        <div className="border-b border-neutral-200 p-4">
          <Link
            href={`/projects/${projectId}`}
            className="text-xs text-neutral-500 hover:text-sdg-red"
          >
            ← Zurück
          </Link>
          <h1 className="mt-1 truncate font-semibold text-neutral-900" title={projectTitle}>
            {projectTitle}
          </h1>
          <p className="text-xs text-neutral-400">{brand}</p>

          {canEdit ? (
            <>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={undo}
                  disabled={past.length === 0}
                  title="Rückgängig (Strg+Z)"
                  className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-700 enabled:hover:border-sdg-red enabled:hover:text-sdg-red disabled:opacity-40"
                >
                  ↶ Zurück
                </button>
                <button
                  onClick={redo}
                  disabled={future.length === 0}
                  title="Wiederholen (Strg+Umschalt+Z)"
                  className="rounded border border-neutral-300 px-2 py-1 text-sm text-neutral-700 enabled:hover:border-sdg-red enabled:hover:text-sdg-red disabled:opacity-40"
                >
                  ↷ Vor
                </button>
                <span className="ml-auto text-xs text-neutral-400">
                  {saveLabel[saveState]}
                </span>
              </div>
              <div className="mt-2 flex gap-3 text-xs">
                <a
                  href={`/projects/${projectId}/export?format=html`}
                  className="text-sdg-red hover:text-sdg-red-dark"
                >
                  Export HTML
                </a>
                <a
                  href={`/projects/${projectId}/export?format=zip`}
                  className="text-sdg-red hover:text-sdg-red-dark"
                >
                  Export ZIP
                </a>
              </div>
            </>
          ) : (
            <p className="mt-2 rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-500">
              Nur-Lese-Ansicht – du kannst Inhalte ansehen, aber nicht ändern.
            </p>
          )}
        </div>

        {canEdit && (
          <>
            {langs.length > 0 && (
              <section className="border-b border-neutral-200 p-4">
                <h2 className="mb-2 text-sm font-semibold text-neutral-900">
                  Sprache
                </h2>
                <div className="flex flex-wrap gap-2">
                  {langs.map((l) => (
                    <button
                      key={l}
                      onClick={() => setLang(l)}
                      className={`rounded px-3 py-1 text-sm font-medium ${
                        l === lang
                          ? "bg-sdg-red text-white"
                          : "border border-neutral-300 text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
                      }`}
                    >
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-neutral-400">
                  Die Vorschau und die Textfelder unten zeigen die gewählte
                  Sprache. Jede Sprache wird separat bearbeitet.
                </p>
              </section>
            )}

            {langs.length > 0 && (
              <section className="border-b border-neutral-200 p-4">
                <h2 className="mb-3 text-sm font-semibold text-neutral-900">
                  Texte {lang.toUpperCase()} ({i18nKeys.length})
                </h2>
                <div className="space-y-3">
                  {i18nKeys.map((key) => (
                    <div key={key}>
                      <label className="block truncate text-xs text-neutral-500" title={key}>
                        {key}
                      </label>
                      <textarea
                        rows={2}
                        value={content.i18n?.[lang]?.[key] ?? ""}
                        onChange={(e) => handleI18nChange(key, e.target.value)}
                        className="mt-1 w-full resize-y rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-sdg-red"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="border-b border-neutral-200 p-4">
              <h2 className="mb-3 text-sm font-semibold text-neutral-900">
                Farben ({colors.length})
              </h2>
              {colors.length === 0 ? (
                <p className="text-xs text-neutral-400">Keine Farben erkannt.</p>
              ) : (
                <div className="space-y-3">
                  {colors.map((el) => (
                    <div key={el.id} className="flex items-center gap-2">
                      <input
                        type="color"
                        value={toHex6(content.colors[el.id] ?? el.default)}
                        onChange={(e) => handleColorChange(el.id, e.target.value)}
                        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-neutral-300"
                        aria-label={el.label}
                      />
                      <div className="min-w-0 flex-1">
                        <label className="block truncate text-xs text-neutral-500">
                          {el.label}
                        </label>
                        <input
                          type="text"
                          value={content.colors[el.id] ?? el.default}
                          onChange={(e) => handleColorChange(el.id, e.target.value)}
                          className="w-full rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-sdg-red"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="border-b border-neutral-200 p-4">
              <h2 className="mb-3 text-sm font-semibold text-neutral-900">
                Bilder ({images.length})
              </h2>
              {uploadError && (
                <p className="mb-2 rounded bg-sdg-red-light px-2 py-1 text-xs text-sdg-red-dark">
                  {uploadError}
                </p>
              )}
              {images.length === 0 ? (
                <p className="text-xs text-neutral-400">Keine Bilder erkannt.</p>
              ) : (
                <div className="space-y-3">
                  {images.map((el) => {
                    const url = resolveImg(content.images[el.id] ?? el.default);
                    const showable = url && !url.startsWith(STORAGE_REF_PREFIX);
                    return (
                      <div key={el.id} className="flex items-center gap-3">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded border border-neutral-200 bg-neutral-50">
                          {showable ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={url}
                              alt={el.label}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <span className="text-[10px] text-neutral-400">
                              kein Bild
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-neutral-500" title={el.label}>
                            {el.label}
                          </p>
                          <label className="mt-1 inline-block cursor-pointer text-xs font-medium text-sdg-red hover:text-sdg-red-dark">
                            {uploadingId === el.id ? "Wird hochgeladen …" : "Bild ersetzen"}
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={uploadingId !== null}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleImageChange(el.id, file);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {links.length > 0 && (
              <section className="border-b border-neutral-200 p-4">
                <h2 className="mb-3 text-sm font-semibold text-neutral-900">
                  Links ({links.length})
                </h2>
                <div className="space-y-3">
                  {links.map((el) => (
                    <div key={`link-${el.id}`}>
                      <label className="block truncate text-xs text-neutral-500" title={el.label}>
                        {el.label}
                      </label>
                      <input
                        type="text"
                        value={content.links?.[el.id] ?? el.default}
                        onChange={(e) => handleLinkChange(el.id, e.target.value)}
                        placeholder="https://…"
                        className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-sdg-red"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="border-b border-neutral-200 p-4">
              <h2 className="mb-3 text-sm font-semibold text-neutral-900">
                Texte ({texts.length})
              </h2>
              {texts.length === 0 ? (
                <p className="text-xs text-neutral-400">Keine Texte erkannt.</p>
              ) : (
                <div className="space-y-3">
                  {texts.map((el) => (
                    <div key={el.id}>
                      <label className="block truncate text-xs text-neutral-500" title={el.label}>
                        {el.label}
                      </label>
                      <textarea
                        rows={2}
                        value={content.texts[el.id] ?? el.default}
                        onChange={(e) => handleTextChange(el.id, e.target.value)}
                        className="mt-1 w-full resize-y rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-sdg-red"
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-neutral-900">
                Snapshots
              </h2>
              <p className="mb-2 text-xs text-neutral-500">
                Speichere einen benannten Stand, um jederzeit dorthin
                zurückzukehren.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={snapshotLabel}
                  onChange={(e) => setSnapshotLabel(e.target.value)}
                  placeholder="z. B. Vor Farbanpassung"
                  className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-sdg-red"
                />
                <button
                  onClick={handleCreateSnapshot}
                  disabled={snapshotBusy || !snapshotLabel.trim()}
                  className="rounded bg-sdg-red px-2 py-1 text-xs font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50"
                >
                  Speichern
                </button>
              </div>
              {snapshotMsg && (
                <p className="mt-2 text-xs text-neutral-500">{snapshotMsg}</p>
              )}

              {snapshots.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {snapshots.map((snap) => (
                    <li
                      key={snap.id}
                      className="flex items-center gap-2 rounded border border-neutral-200 px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-neutral-800" title={snap.label}>
                          {snap.label}
                        </p>
                        <p className="text-[10px] text-neutral-400">
                          {new Date(snap.created_at).toLocaleString("de-DE", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRestore(snap.id)}
                        className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:border-sdg-red hover:text-sdg-red"
                      >
                        Wiederherstellen
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </aside>

      <div className="flex-1 bg-neutral-100 p-4">
        <div className="h-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <iframe
            ref={iframeRef}
            title="Live-Vorschau"
            srcDoc={initialHtml}
            onLoad={applyCurrentLang}
            className="h-full w-full"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}
