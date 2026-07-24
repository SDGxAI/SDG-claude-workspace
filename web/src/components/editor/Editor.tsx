"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  applyColor,
  applyImage,
  applyText,
  applyLink,
  applyWrapLink,
  applyCustomButtons,
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
import type {
  ContentState,
  CustomButton,
  DetectedElement,
} from "@/types/database";
import type { InsertionPoint } from "@/lib/html/structure";

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
  /** Mögliche Einfüge-Positionen für neue Buttons. */
  insertionPoints: InsertionPoint[];
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
  insertionPoints,
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

  const [newBtnLabel, setNewBtnLabel] = useState("");
  const [newBtnUrl, setNewBtnUrl] = useState("");
  const [newBtnPos, setNewBtnPos] = useState(insertionPoints[0]?.selector ?? "");
  const [newBtnPosLabel, setNewBtnPosLabel] = useState<string>(
    insertionPoints[0]?.label ?? "",
  );
  const [newBtnColor, setNewBtnColor] = useState("#E30613");

  // Anklicken in der Vorschau: "position" (Button-Position) oder "link".
  const [pickMode, setPickMode] = useState<null | "position" | "link">(null);
  const [linkTarget, setLinkTarget] = useState<{
    editId: string;
    isAnchor: boolean;
    label: string;
  } | null>(null);
  const [linkUrlInput, setLinkUrlInput] = useState("");
  const [pickHint, setPickHint] = useState<string | null>(null);
  const highlightedRef = useRef<HTMLElement | null>(null);

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
      // Verlinkte Textelemente wieder ein-/auspacken (Text setzen entfernt sie).
      for (const el of texts) {
        applyWrapLink(doc, el.id, state.wrapLinks?.[el.id] ?? "");
      }
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
      applyCustomButtons(doc, state.customButtons ?? []);
    },
    [getDoc, resolveImg, lang, texts],
  );

  // Beim Laden der Vorschau und beim Sprachwechsel die aktuelle Sprache
  // anwenden (die Vorschau selbst führt keine Skripte aus).
  const applyCurrentLang = useCallback(() => {
    const doc = getDoc();
    if (!doc) return;
    if (content.i18n && lang && content.i18n[lang]) {
      applyI18nLang(doc, content.i18n[lang]);
    }
    applyCustomButtons(doc, content.customButtons ?? []);
  }, [getDoc, content.i18n, content.customButtons, lang]);

  useEffect(() => {
    applyCurrentLang();
  }, [lang, applyCurrentLang]);

  function highlight(el: HTMLElement | null) {
    if (highlightedRef.current) {
      highlightedRef.current.style.outline = "";
      highlightedRef.current.style.outlineOffset = "";
    }
    highlightedRef.current = el;
    if (el) {
      el.style.outline = "2px solid #E30613";
      el.style.outlineOffset = "2px";
    }
  }

  // Klick in der Vorschau: Element auswählen (Position für neuen Button oder
  // bestehendes Element verlinken). Die Vorschau führt keine Skripte aus,
  // daher fangen wir Klicks vom Elternfenster ab.
  useEffect(() => {
    if (!pickMode || !canEdit) return;
    const doc = getDoc();
    if (!doc) return;

    function identifiable(start: HTMLElement | null): HTMLElement | null {
      let cur: HTMLElement | null = start;
      while (cur && cur !== doc!.body) {
        if (cur.getAttribute("data-edit-id") || cur.getAttribute("data-i18n")) {
          return cur;
        }
        cur = cur.parentElement;
      }
      return null;
    }

    function onClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      const el = identifiable(e.target as HTMLElement);
      if (!el) {
        setPickHint("Bitte auf einen Text, ein Bild oder einen Button klicken.");
        return;
      }
      const editId = el.getAttribute("data-edit-id");
      const i18nKey = el.getAttribute("data-i18n");
      const selector = editId
        ? `[data-edit-id="${editId}"]`
        : `[data-i18n="${i18nKey}"]`;
      const labelText =
        `${el.tagName}: ${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}`;
      highlight(el);

      if (pickMode === "position") {
        setNewBtnPos(selector);
        setNewBtnPosLabel(labelText);
        setPickMode(null);
        setPickHint(null);
      } else {
        // Link-Modus
        if (!editId) {
          setPickHint(
            "Übersetzte Texte hier bitte über die Sprach-Bearbeitung verlinken.",
          );
          setPickMode(null);
          return;
        }
        const isAnchor = el.tagName === "A";
        setLinkTarget({ editId, isAnchor, label: labelText });
        setLinkUrlInput(
          content.links?.[editId] ?? content.wrapLinks?.[editId] ?? "",
        );
        setPickMode(null);
        setPickHint(null);
      }
    }

    doc.addEventListener("click", onClick, true);
    if (doc.body) doc.body.style.cursor = "crosshair";
    return () => {
      doc.removeEventListener("click", onClick, true);
      if (doc.body) doc.body.style.cursor = "";
    };
  }, [pickMode, canEdit, getDoc, content.links, content.wrapLinks]);

  function applyLinkToTarget() {
    if (!linkTarget) return;
    const url = linkUrlInput.trim();
    if (linkTarget.isAnchor) {
      handleLinkChange(linkTarget.editId, url);
    } else {
      const doc = getDoc();
      if (doc) applyWrapLink(doc, linkTarget.editId, url);
      commit(
        {
          ...content,
          wrapLinks: { ...(content.wrapLinks ?? {}), [linkTarget.editId]: url },
        },
        `wrap:${linkTarget.editId}`,
      );
    }
    highlight(null);
    setLinkTarget(null);
    setLinkUrlInput("");
  }

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
    if (doc) {
      applyText(doc, id, value);
      // Falls dieses Element verlinkt ist: nach dem Textsetzen neu einpacken.
      if (content.wrapLinks?.[id]) applyWrapLink(doc, id, content.wrapLinks[id]);
    }
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

  function reconcileButtons(buttons: CustomButton[]) {
    const doc = getDoc();
    if (doc) applyCustomButtons(doc, buttons);
  }

  function addCustomButton(button: CustomButton) {
    const next = [...(content.customButtons ?? []), button];
    reconcileButtons(next);
    commit({ ...content, customButtons: next }, null);
  }

  function updateCustomButton(id: string, patch: Partial<CustomButton>) {
    const next = (content.customButtons ?? []).map((b) =>
      b.id === id ? { ...b, ...patch } : b,
    );
    reconcileButtons(next);
    commit({ ...content, customButtons: next }, `custombtn:${id}`);
  }

  function removeCustomButton(id: string) {
    const next = (content.customButtons ?? []).filter((b) => b.id !== id);
    reconcileButtons(next);
    commit({ ...content, customButtons: next }, null);
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
              <h2 className="mb-2 text-sm font-semibold text-neutral-900">
                Bestehendes Element verlinken
              </h2>
              <p className="mb-2 text-xs text-neutral-500">
                Klicke in der Vorschau auf einen Text oder Button und hinterlege
                eine Ziel-Adresse.
              </p>
              <button
                onClick={() => {
                  setLinkTarget(null);
                  setPickMode(pickMode === "link" ? null : "link");
                  setPickHint(
                    pickMode === "link"
                      ? null
                      : "Klicke in der Vorschau auf das Element, das verlinkt werden soll.",
                  );
                }}
                className={`w-full rounded border px-2 py-1.5 text-sm ${
                  pickMode === "link"
                    ? "border-sdg-red bg-sdg-red-light text-sdg-red-dark"
                    : "border-neutral-300 text-neutral-700 hover:border-sdg-red"
                }`}
              >
                {pickMode === "link"
                  ? "In der Vorschau anklicken … (zum Abbrechen erneut klicken)"
                  : "Element in Vorschau anklicken"}
              </button>

              {linkTarget && (
                <div className="mt-2 rounded-lg border border-neutral-200 bg-neutral-50 p-2">
                  <p className="truncate text-xs text-neutral-600" title={linkTarget.label}>
                    Gewählt: {linkTarget.label}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="text"
                      autoFocus
                      value={linkUrlInput}
                      onChange={(e) => setLinkUrlInput(e.target.value)}
                      placeholder="https://…"
                      className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-sdg-red"
                    />
                    <button
                      onClick={applyLinkToTarget}
                      className="rounded bg-sdg-red px-2 py-1 text-xs font-medium text-white hover:bg-sdg-red-dark"
                    >
                      Verlinken
                    </button>
                  </div>
                  {(content.links?.[linkTarget.editId] ||
                    content.wrapLinks?.[linkTarget.editId]) && (
                    <button
                      onClick={() => {
                        setLinkUrlInput("");
                        if (linkTarget.isAnchor) {
                          handleLinkChange(linkTarget.editId, "");
                        } else {
                          const doc = getDoc();
                          if (doc) applyWrapLink(doc, linkTarget.editId, "");
                          commit(
                            {
                              ...content,
                              wrapLinks: {
                                ...(content.wrapLinks ?? {}),
                                [linkTarget.editId]: "",
                              },
                            },
                            null,
                          );
                        }
                        highlight(null);
                        setLinkTarget(null);
                      }}
                      className="mt-1 text-xs text-neutral-500 hover:text-sdg-red"
                    >
                      Link entfernen
                    </button>
                  )}
                </div>
              )}
              {pickHint && (
                <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  {pickHint}
                </p>
              )}
            </section>

            <section className="border-b border-neutral-200 p-4">
              <h2 className="mb-3 text-sm font-semibold text-neutral-900">
                Button hinzufügen
              </h2>
              <div className="space-y-2">
                <input
                  type="text"
                  value={newBtnLabel}
                  onChange={(e) => setNewBtnLabel(e.target.value)}
                  placeholder="Beschriftung (z. B. Jetzt kaufen)"
                  className="w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-sdg-red"
                />
                <input
                  type="text"
                  value={newBtnUrl}
                  onChange={(e) => setNewBtnUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus:border-sdg-red"
                />
                <div>
                  <p className="text-xs text-neutral-500">Position</p>
                  <button
                    onClick={() => {
                      setPickMode(pickMode === "position" ? null : "position");
                      setPickHint(
                        pickMode === "position"
                          ? null
                          : "Klicke in der Vorschau auf die Stelle, hinter der der Button erscheinen soll.",
                      );
                    }}
                    className={`mt-1 w-full rounded border px-2 py-1.5 text-left text-sm ${
                      pickMode === "position"
                        ? "border-sdg-red bg-sdg-red-light text-sdg-red-dark"
                        : "border-neutral-300 text-neutral-700 hover:border-sdg-red"
                    }`}
                  >
                    {pickMode === "position"
                      ? "In der Vorschau anklicken … (zum Abbrechen erneut klicken)"
                      : newBtnPosLabel
                        ? `Nach: ${newBtnPosLabel}`
                        : "Position in Vorschau wählen"}
                  </button>
                  <label className="mt-1 block text-[11px] text-neutral-400">
                    oder aus Liste:
                    <select
                      value={newBtnPos}
                      onChange={(e) => {
                        setNewBtnPos(e.target.value);
                        const p = insertionPoints.find(
                          (x) => x.selector === e.target.value,
                        );
                        setNewBtnPosLabel(p?.label ?? "");
                      }}
                      className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-700 outline-none focus:border-sdg-red"
                    >
                      {insertionPoints.map((p) => (
                        <option key={p.selector} value={p.selector}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-neutral-500">
                    Farbe
                    <input
                      type="color"
                      value={newBtnColor}
                      onChange={(e) => setNewBtnColor(e.target.value)}
                      className="h-7 w-7 cursor-pointer rounded border border-neutral-300"
                    />
                  </label>
                  <button
                    onClick={() => {
                      if (!newBtnLabel.trim() || !newBtnUrl.trim() || !newBtnPos) return;
                      addCustomButton({
                        id: `custom-${Date.now()}`,
                        label: newBtnLabel.trim(),
                        url: newBtnUrl.trim(),
                        afterSelector: newBtnPos,
                        color: newBtnColor,
                      });
                      setNewBtnLabel("");
                      setNewBtnUrl("");
                    }}
                    disabled={!newBtnLabel.trim() || !newBtnUrl.trim() || !newBtnPos}
                    className="ml-auto rounded bg-sdg-red px-3 py-1 text-xs font-medium text-white hover:bg-sdg-red-dark disabled:opacity-50"
                  >
                    Button einfügen
                  </button>
                </div>
              </div>

              {(content.customButtons ?? []).length > 0 && (
                <ul className="mt-3 space-y-2">
                  {(content.customButtons ?? []).map((btn) => (
                    <li
                      key={btn.id}
                      className="rounded border border-neutral-200 p-2"
                    >
                      <input
                        type="text"
                        value={btn.label}
                        onChange={(e) =>
                          updateCustomButton(btn.id, { label: e.target.value })
                        }
                        className="w-full rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-sdg-red"
                      />
                      <input
                        type="text"
                        value={btn.url}
                        onChange={(e) =>
                          updateCustomButton(btn.id, { url: e.target.value })
                        }
                        className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-sdg-red"
                      />
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          type="color"
                          value={btn.color}
                          onChange={(e) =>
                            updateCustomButton(btn.id, { color: e.target.value })
                          }
                          className="h-6 w-6 cursor-pointer rounded border border-neutral-300"
                        />
                        <button
                          onClick={() => removeCustomButton(btn.id)}
                          className="ml-auto text-xs text-neutral-500 hover:text-sdg-red"
                        >
                          Entfernen
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

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
