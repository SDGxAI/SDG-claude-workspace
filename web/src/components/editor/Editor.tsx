"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { applyColor, applyText } from "@/lib/html/liveApply";
import { savePageContent } from "@/lib/actions/pages";
import type { ContentState, DetectedElement } from "@/types/database";

type SaveState = "idle" | "saving" | "saved" | "error";

export interface EditorProps {
  projectId: string;
  pageId: string;
  projectTitle: string;
  brand: string;
  initialHtml: string;
  detectedElements: DetectedElement[];
  initialContentState: ContentState;
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
  canEdit,
}: EditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [content, setContent] = useState<ContentState>(initialContentState);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const isFirstRender = useRef(true);
  const docReady = useRef(false);

  const colors = useMemo(
    () => detectedElements.filter((el) => el.kind === "color"),
    [detectedElements],
  );
  const texts = useMemo(
    () => detectedElements.filter((el) => el.kind === "text"),
    [detectedElements],
  );

  const getDoc = useCallback(() => iframeRef.current?.contentDocument ?? null, []);

  // Autosave (debounced) bei Änderungen - nur für Editor/Admin
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
    }, 800);
    return () => clearTimeout(timer);
  }, [content, canEdit, pageId, projectId]);

  function handleColorChange(id: string, value: string) {
    const doc = getDoc();
    if (doc) applyColor(doc, id, value, content.colors[id] ?? "");
    setContent((prev) => ({
      ...prev,
      colors: { ...prev.colors, [id]: value },
    }));
  }

  function handleTextChange(id: string, value: string) {
    const doc = getDoc();
    if (doc) applyText(doc, id, value);
    setContent((prev) => ({
      ...prev,
      texts: { ...prev.texts, [id]: value },
    }));
  }

  const saveLabel: Record<SaveState, string> = {
    idle: "",
    saving: "Wird gespeichert …",
    saved: "Gespeichert",
    error: "Fehler beim Speichern",
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col lg:flex-row">
      {/* Seitenleiste */}
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
            <p className="mt-2 h-4 text-xs text-neutral-400">
              {saveLabel[saveState]}
            </p>
          ) : (
            <p className="mt-2 rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-500">
              Nur-Lese-Ansicht – du kannst Inhalte ansehen, aber nicht ändern.
            </p>
          )}
        </div>

        {canEdit && (
          <>
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

            <section className="p-4">
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
          </>
        )}
      </aside>

      {/* Live-Vorschau */}
      <div className="flex-1 bg-neutral-100 p-4">
        <div className="h-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <iframe
            ref={iframeRef}
            title="Live-Vorschau"
            srcDoc={initialHtml}
            onLoad={() => {
              docReady.current = true;
            }}
            className="h-full w-full"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}
